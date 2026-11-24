import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import IconButton from './components/IconButton'
import Map from 'ol/Map.js'
import type MapBrowserEvent from 'ol/MapBrowserEvent.js'
import View from 'ol/View.js'
import Overlay from 'ol/Overlay.js'
import Zoom from 'ol/control/Zoom.js'
import Attribution from 'ol/control/Attribution.js'
import TileLayer from 'ol/layer/Tile.js'
import VectorLayer from 'ol/layer/Vector.js'
import VectorSource from 'ol/source/Vector.js'
import Feature from 'ol/Feature.js'
import LineString from 'ol/geom/LineString.js'
import MultiPoint from 'ol/geom/MultiPoint.js'
import Polygon from 'ol/geom/Polygon.js'
import { Circle, Fill, Stroke, Style } from 'ol/style.js'
import OSM from 'ol/source/OSM.js'
import { boundingExtent } from 'ol/extent.js'
import { unByKey } from 'ol/Observable.js'
import { fromLonLat } from 'ol/proj.js'
import { clamp } from 'ol/math.js'
import { ApiError } from './api'
import TableRefresh from './TableRefresh'
import MetadataDownload from './MetadataDownload'
import StationClassificationControls from './StationClassificationControls'
import { stationPinCenter, stationPinPath, stationPinTitle, stationPinViewBox } from './stationPinIcon'
import { showStationPopup, updateStationPopupText } from './stationPopup'
import StationSeriesPicker from './StationSeriesPicker'
import { seriesSelectionLimit } from './sampleViewer'
import { assignStation, classificationClasses, readAttributeClasses, readStationSummaries, summaryOptions } from './stationClassification'
import type { Assignment, Band, Classification, MapClassificationSnapshot, Summary } from './stationClassification'
import { catalogPath, decodeNode, decodePage, identity, name, reference } from './metadata'
import type { DetailSelection, MetadataClient, SelectedSeries } from './metadata'
import { mapPageSize, readMapStations, readStationSeries } from './metadataMap'
import { finishMapPolygon, MAX_POLYGON_VERTICES, wrapMapX } from './mapPolygon'
import type { MapPoint } from './mapPolygon'
import type { MapStation } from './metadataMap'
import type { DockviewPanelApi } from 'dockview'
import type { useMetadataSelection } from './useMetadataSelection'
import 'ol/ol.css'

interface StationMarker { button: HTMLButtonElement; position: number[]; id: string; name: string; valueBox?: HTMLSpanElement }

interface MapLayers {
  map: Map; markers: StationMarker[]; markerLayer: HTMLDivElement; tiles: OSM
  appliedPolygon: Feature<Polygon>; draftPolygon: Feature<Polygon | LineString>; draftVertices: Feature<MultiPoint>
  popup: Overlay; popupElement: HTMLDivElement; selected: HTMLButtonElement | null
  seriesRead?: AbortController
  viewInteracted: boolean
}

type StationRead = { key: string; scope: string; cutoff: string; stations?: MapStation[]; reference?: number; error?: string }
type MapReload = { epoch: number }
const mapCutoffPath = catalogPath({ filters: [], q: '', asOf: '' }, 'stations', { limit: '1' })
const decodeMapCutoff = (body: unknown) => decodePage(body, decodeNode).cutoff

function pixelDistance(a: number[], b: number[]) {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!)
}

function PolygonIcon({ drawing, applied }: { drawing: boolean; applied: boolean }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    {applied ? <path d="M10 3 3 8l2 10 6 3 4-4m1-5 5 5m0-5-5 5" />
      : drawing ? <path d="m6 6 12 12M18 6 6 18" />
        : <><path d="m11 4 8 5-2 9-9 2-4-7 7-9Z" /><circle cx="11" cy="4" r="1.5" />
          <circle cx="19" cy="9" r="1.5" /><circle cx="8" cy="20" r="1.5" /></>}
  </svg>
}

function fitStations({ map, markers, appliedPolygon }: MapLayers): boolean {
  map.updateSize()
  const size = map.getSize()
  const extent = appliedPolygon.getGeometry()?.getExtent() ?? (markers.length ? boundingExtent(markers.map(({ position }) => position)) : undefined)
  if (!extent || !size || size[0] === 0 || size[1] === 0) return false
  map.getView().cancelAnimations()
  map.getView().fit(extent, { padding: [24, 24, 24, 24], maxZoom: 14, size })
  return true
}

function closePopup(current: MapLayers) {
  current.seriesRead?.abort()
  current.seriesRead = undefined
  if (current.popupElement.contains(current.popupElement.ownerDocument.activeElement)) current.selected?.focus()
  current.selected?.classList.remove('is-selected')
  current.selected?.setAttribute('aria-pressed', 'false')
  current.selected = null
  current.popup.setPosition(undefined)
  current.popupElement.replaceChildren()
}

function setPinsDisabled(markers: StationMarker[], disabled: boolean) {
  for (const { button } of markers) button.disabled = disabled
}

function stylePins(current: MapLayers, assignments: ReadonlyMap<string, Assignment>, hiddenClasses: ReadonlySet<string>) {
  for (const marker of current.markers) {
    const { id, button, name } = marker
    const assigned = assignments.get(id)
    const hidden = !!assigned && hiddenClasses.has(assigned.key)
    if (hidden && current.selected === button) closePopup(current)
    button.hidden = hidden
    button.style.setProperty('--station-pin-color', assigned?.color ?? '')
    const value = assigned?.markerValue
    if (value !== undefined) {
      if (!marker.valueBox) {
        marker.valueBox = document.createElement('span')
        marker.valueBox.className = 'station-map-marker-value'
        marker.valueBox.setAttribute('aria-hidden', 'true')
        button.append(marker.valueBox)
      }
      marker.valueBox.textContent = String(value)
    } else if (marker.valueBox) {
      marker.valueBox.remove()
      marker.valueBox = undefined
    }
    button.classList.toggle('has-value', value !== undefined)
    button.title = stationPinTitle(name, id, assigned?.label, assigned?.mouseover)
    const text = assigned ? `${assigned.label} — ${assigned.detail}` : ''
    if (text) button.setAttribute('aria-description', text)
    else button.removeAttribute('aria-description')
    if (current.selected === button) updateStationPopupText(current.popupElement, button.title)
  }
}

function stationPin(label: string, title: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'station-map-marker'
  button.title = title
  button.setAttribute('aria-label', label)
  button.setAttribute('aria-pressed', 'false')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.classList.add('station-pin-icon')
  svg.setAttribute('viewBox', stationPinViewBox)
  svg.setAttribute('aria-hidden', 'true')
  const pin = document.createElementNS(svg.namespaceURI, 'path')
  pin.setAttribute('d', stationPinPath)
  const center = document.createElementNS(svg.namespaceURI, 'circle')
  for (const [attribute, value] of Object.entries(stationPinCenter)) center.setAttribute(attribute, value)
  svg.append(pin, center)
  button.append(svg)
  return button
}

export default function StationMap({ state, client, onExpired, onOpen, onOpenSeries, lockedSelection = false, initialClassification, classificationSnapshot, panelApi }: {
  state: ReturnType<typeof useMetadataSelection>; client: MetadataClient
  onExpired: () => void; onOpen: (selection: DetailSelection) => void
  onOpenSeries: (series: SelectedSeries[], cutoff: string) => void
  lockedSelection?: boolean; initialClassification?: MapClassificationSnapshot
  classificationSnapshot?: (snapshot: MapClassificationSnapshot | undefined) => void
  panelApi?: DockviewPanelApi
}) {
  const { selection, initial } = state
  const [reload, setReload] = useState<MapReload>()
  const [capture, setCapture] = useState<{ request: MapReload; cutoff?: string; error?: string }>()
  const request = reload?.epoch === state.epoch && !selection.asOf ? reload : undefined
  const currentCapture = request && capture?.request === request ? capture : undefined
  const cutoff = request ? currentCapture?.cutoff : state.cutoff
  function reloadMap() { setReload({ epoch: state.epoch }) }
  const [classification, setClassification] = useState<Classification>(() => initialClassification?.classification ?? { mode: 'off' })
  const [hiddenClasses, setHiddenClasses] = useState<ReadonlySet<string>>(() => initialClassification?.hiddenClasses ?? new Set())
  const [bands, setBands] = useState<ReadonlyMap<string, Band>>(() => initialClassification?.bands ?? new globalThis.Map())
  useLayoutEffect(() => {
    if (!classificationSnapshot) return
    classificationSnapshot({ classification, hiddenClasses, bands })
    return () => classificationSnapshot(undefined)
  }, [classificationSnapshot, classification, hiddenClasses, bands])
  const [classificationAttempt, setClassificationAttempt] = useState(0)
  const [summaryResult, setSummaryResult] = useState<{ key: string; items?: ReadonlyMap<string, Summary>; error?: string }>()
  const [attributeResult, setAttributeResult] = useState<{ key: string; categories?: string[]; error?: string }>()
  const summaryExpired = useEffectEvent(onExpired)
  useEffect(() => {
    if (!request) return
    const controller = new AbortController()
    // Capture a new view for this map without invalidating the shared Metadata view.
    void client.read(mapCutoffPath, decodeMapCutoff, controller.signal, { fresh: true }).then((cutoff) => {
      if (!controller.signal.aborted) setCapture({ request, cutoff })
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) { client.clear(); summaryExpired() }
      setCapture({ request, error: failure instanceof ApiError ? failure.message : 'The map view could not be refreshed.' })
    })
    return () => controller.abort()
  }, [client, request])
  const scope = JSON.stringify(selection)
  const path = cutoff && !selection.asOf
    ? catalogPath(selection, 'stations', { mode: 'map', limit: String(mapPageSize), after: '' }, cutoff) : null
  const [attempt, setAttempt] = useState(0)
  const readKey = path && `${state.epoch}:${attempt}:${path}`
  const [result, setResult] = useState<StationRead>()
  const [updatedAt, setUpdatedAt] = useState<string>()
  const [tileError, setTileError] = useState(false)
  const [draft, setDraft] = useState<MapPoint[] | null>(null)
  const draftPoints = useRef<MapPoint[] | null>(null)
  const [polygonError, setPolygonError] = useState('')
  const drawing = !lockedSelection && draft !== null && !selection.asOf
  const drawButton = useRef<HTMLButtonElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const layers = useRef<MapLayers | null>(null)
  const fitted = useRef(false)
  const open = useRef(onOpen)
  const graph = useRef(onOpenSeries)
  useEffect(() => { open.current = onOpen; graph.current = onOpenSeries }, [onOpen, onOpenSeries])
  const [picker, setPicker] = useState<{ station: string; series: SelectedSeries[]; cutoff: string }>()

  const openStationGraph = useCallback(async (current: MapLayers, button: HTMLButtonElement, stationName: string, station: DetailSelection) => {
    const controller = new AbortController()
    current.seriesRead = controller
    button.disabled = true
    const status = current.popupElement.ownerDocument.createElement('p')
    current.popupElement.querySelector('.station-popup-status')?.remove()
    status.className = 'station-popup-status'
    status.setAttribute('role', 'status')
    status.textContent = 'Loading station time series…'
    current.popupElement.append(status)
    try {
      const series = await readStationSeries(client, station, controller.signal)
      if (controller.signal.aborted) return
      if (!series.length) status.textContent = 'No readable time series for this station.'
      else {
        status.remove()
        if (series.length > seriesSelectionLimit) setPicker({ station: stationName, series, cutoff: station.cutoff })
        else graph.current(series, station.cutoff)
      }
    } catch (failure: unknown) {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) { client.clear(); onExpired() }
      status.setAttribute('role', 'alert')
      status.textContent = failure instanceof ApiError ? failure.message : 'Station time series could not be read.'
    } finally {
      if (current.seriesRead === controller) current.seriesRead = undefined
      if (!controller.signal.aborted) button.disabled = false
    }
  }, [client, onExpired])

  function changeDraft(points: MapPoint[] | null) {
    draftPoints.current = points
    setDraft(points)
  }

  function addVertex(coordinate: number[]) {
    const points = draftPoints.current
    if (!points) return
    if (points.length >= MAX_POLYGON_VERTICES) {
      setPolygonError(`Use at most ${MAX_POLYGON_VERTICES} vertices. Finish the polygon or undo with Backspace.`)
      return
    }
    changeDraft([...points, [coordinate[0]!, coordinate[1]!]])
    setPolygonError('')
  }

  function stopDrawing() {
    changeDraft(null)
    setPolygonError('')
    drawButton.current?.focus()
  }

  function finishDrawing(points = draftPoints.current) {
    if (!points) return
    try {
      const vertices = finishMapPolygon(points)
      state.setSelection((current) => ({ ...current, polygon: vertices }))
      stopDrawing()
    } catch (error) {
      if (error instanceof Error) setPolygonError(error.message)
    }
  }

  const mapClick = useEffectEvent((current: MapLayers, event: MapBrowserEvent) => {
    if (draftPoints.current && !selection.asOf) {
      if (event.type === 'click') {
        const previous = draftPoints.current.at(-1)
        if (!previous || pixelDistance(current.map.getPixelFromCoordinate(previous), event.pixel) > 5) {
          addVertex(event.coordinate)
        }
      }
      // OpenLayers also emits dblclick for quick clicks at different pixels.
      if (event.type === 'dblclick') return false
    } else if (event.type === 'singleclick') closePopup(current)
    else if (event.type === 'dblclick') current.viewInteracted = true
  })
  function closeRing(current: MapLayers) {
    const points = draftPoints.current
    const first = points?.[0]
    const last = points?.at(-1)
    // A double-click on the starting vertex can close the ring without adding it again.
    if (points && points.length > 3 && first && last && pixelDistance(
      current.map.getPixelFromCoordinate(first), current.map.getPixelFromCoordinate(last),
    ) <= 5) finishDrawing(points.slice(0, -1))
    else finishDrawing(points)
  }
  const mapDoubleClick = useEffectEvent((current: MapLayers, event: MouseEvent) => {
    const target = event.target
    // OpenLayers can attach nodes created in the opener to a map in another window.
    if (!draftPoints.current || selection.asOf || !target || !('closest' in target) ||
      typeof target.closest !== 'function' || target.closest('.ol-overlaycontainer-stopevent')) return
    event.preventDefault()
    closeRing(current)
  })
  useEffect(() => {
    if (!path || !readKey || !cutoff) return
    const controller = new AbortController()
    const reference = Date.now()
    void readMapStations(client, path, controller.signal).then((stations) => {
      if (!controller.signal.aborted) {
        setResult({ key: readKey, scope, cutoff, stations, reference })
        setUpdatedAt(new Date(Date.now()).toISOString())
      }
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      if (error instanceof ApiError && error.status === 401) { client.clear(); onExpired() }
      setResult({ key: readKey, scope, cutoff,
        error: error instanceof ApiError ? error.message : 'Stations could not be read. Retry the map read.' })
    })
    return () => controller.abort()
  }, [path, readKey, scope, cutoff, client, onExpired])
  useEffect(() => {
    const element = host.current
    if (!element) return
    const tiles = new OSM({ referrerPolicy: 'origin' })
    const tileListener = tiles.on('tileloaderror', () => setTileError(true))
    const appliedPolygon = new Feature<Polygon>()
    appliedPolygon.setStyle(new Style({
      fill: new Fill({ color: 'rgba(20, 127, 168, 0.16)' }),
      stroke: new Stroke({ color: '#126488', width: 2 }),
    }))
    const draftPolygon = new Feature<Polygon | LineString>()
    draftPolygon.setStyle(new Style({
      fill: new Fill({ color: 'rgba(20, 127, 168, 0.08)' }),
      stroke: new Stroke({ color: '#126488', width: 2, lineDash: [5, 4] }),
    }))
    const draftVertices = new Feature<MultiPoint>()
    draftVertices.setStyle(new Style({
      image: new Circle({ radius: 4, fill: new Fill({ color: '#126488' }), stroke: new Stroke({ color: '#fff', width: 1 }) }),
    }))
    const shapes = new VectorLayer({ source: new VectorSource({ features: [appliedPolygon, draftPolygon, draftVertices] }) })
    const map = new Map({
      target: element,
      layers: [new TileLayer({ source: tiles }), shapes],
      view: new View({ center: fromLonLat([0, 20]), zoom: 2, maxZoom: 19, constrainResolution: true, multiWorld: true }),
      controls: [new Zoom({ duration: 0 }), new Attribution({ collapsible: false })],
    })
    element.querySelectorAll<HTMLButtonElement>('.ol-zoom button').forEach((button) => {
      button.setAttribute('aria-label', button.title)
    })
    const popupElement = document.createElement('div')
    popupElement.className = 'station-map-popup'
    const popup = new Overlay({ element: popupElement, positioning: 'bottom-center', offset: [0, -32],
      className: 'station-map-popup-overlay', autoPan: { margin: 24, animation: { duration: 0 } } })
    map.addOverlay(popup)
    const markerLayer = document.createElement('div')
    markerLayer.className = 'station-map-marker-layer'
    map.getOverlayContainerStopEvent()?.prepend(markerLayer)
    const current: MapLayers = { map, markers: [], markerLayer, tiles, appliedPolygon, draftPolygon, draftVertices,
      popup, popupElement, selected: null, viewInteracted: false }
    map.on('postrender', (event) => {
      const visible = !!event.frameState
      markerLayer.hidden = !visible
      if (!visible) return
      for (const { button, position } of current.markers) {
        const [x, y] = map.getPixelFromCoordinate(position)
        button.style.translate = `${x}px ${y}px`
      }
    })
    layers.current = current
    // Capture draft vertices before a tile redraw can replace the click target.
    map.on('click', (event) => mapClick(current, event))
    map.on('singleclick', (event) => mapClick(current, event))
    map.on('dblclick', (event) => mapClick(current, event))
    const viewport = map.getViewport()
    const interact = () => { current.viewInteracted = true }
    const onDoubleClick = (event: MouseEvent) => mapDoubleClick(current, event)
    viewport?.addEventListener('dblclick', onDoubleClick)
    viewport?.addEventListener('wheel', interact, { passive: true })
    map.on('pointerdrag', interact)
    for (const button of element.querySelectorAll('.ol-zoom button')) button.addEventListener('click', interact)
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closePopup(current)
      if (event.key.startsWith('Arrow') || event.key === '+' || event.key === '-') interact()
    }
    element.addEventListener('keydown', onKeyDown)
    function resize() {
      map.updateSize()
      if (!fitted.current && !current.viewInteracted) fitted.current = fitStations(current)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    let pending: { owner: Window; id: number } | undefined
    const dimensions = panelApi?.onDidDimensionsChange(() => {
      const owner = element.ownerDocument.defaultView
      if (!owner || owner === window || pending?.owner === owner) return
      pending?.owner.cancelAnimationFrame(pending.id)
      pending = { owner, id: owner.requestAnimationFrame(() => {
        pending = undefined
        if (element.ownerDocument.defaultView !== owner || !element.clientWidth || !element.clientHeight) return
        resize()
        // OpenLayers schedules its default render in the opener, which can be backgrounded.
        map.renderSync()
      }) }
    })
    return () => {
      dimensions?.dispose()
      pending?.owner.cancelAnimationFrame(pending.id)
      observer.disconnect()
      element.removeEventListener('keydown', onKeyDown)
      viewport?.removeEventListener('dblclick', onDoubleClick)
      viewport?.removeEventListener('wheel', interact)
      unByKey(tileListener)
      current.seriesRead?.abort()
      map.dispose()
      tiles.dispose()
      layers.current = null
    }
  }, [panelApi])
  const polygon = selection.asOf ? undefined : selection.polygon
  useEffect(() => {
    layers.current?.appliedPolygon.setGeometry(!lockedSelection && polygon ? new Polygon([[...polygon, polygon[0]!]]) : undefined)
  }, [polygon, lockedSelection])
  useEffect(() => {
    const current = layers.current
    if (!current) return
    const points = drawing ? draft : null
    current.draftPolygon.setGeometry(points && points.length >= 3 ? new Polygon([[...points, points[0]!]])
      : points && points.length === 2 ? new LineString(points) : undefined)
    current.draftVertices.setGeometry(points?.length ? new MultiPoint(points) : undefined)
  }, [drawing, draft])
  const activeRead = result?.key === readKey ? result : undefined
  const loading = !selection.asOf && (cutoff ? !activeRead : request ? !currentCapture : initial.loading)
  const displayedRead = activeRead ?? (loading && result?.scope === scope && result.stations ? result : undefined)
  const displayedCutoff = displayedRead?.cutoff
  const stations = displayedRead?.stations
  const error = activeRead?.error
  const options = summaryOptions(classification)
  const summaryKey = JSON.stringify([readKey, options, classificationAttempt])
  const summaries = summaryResult?.key === JSON.stringify([displayedRead?.key ?? null, options, classificationAttempt]) ? summaryResult : undefined
  const attribute = classification.mode === 'attribute' && !selection.asOf ? classification.attribute : undefined
  const attributeKey = JSON.stringify([cutoff, attribute, classificationAttempt])
  const attributeClasses = attributeResult?.key === JSON.stringify([displayedCutoff, attribute, classificationAttempt]) ? attributeResult : undefined
  useEffect(() => {
    if (!cutoff || !attribute) return
    const controller = new AbortController()
    void readAttributeClasses(client, attribute, cutoff, controller.signal).then((categories) => {
      if (!controller.signal.aborted) setAttributeResult({ key: attributeKey, categories })
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) { client.clear(); summaryExpired() }
      setAttributeResult({ key: attributeKey, error: failure instanceof ApiError ? failure.message : 'Station attribute classes could not be read.' })
    })
    return () => controller.abort()
  }, [client, cutoff, attribute, attributeKey])
  useEffect(() => {
    if (!activeRead?.stations || !cutoff || !options) return
    const controller = new AbortController()
    void readStationSummaries(client, activeRead.stations, options, cutoff, controller.signal).then((items) => {
      if (!controller.signal.aborted) setSummaryResult({ key: summaryKey, items })
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) { client.clear(); summaryExpired() }
      setSummaryResult({ key: summaryKey, error: failure instanceof ApiError ? failure.message : 'Station classification could not be read.' })
    })
    return () => controller.abort()
  }, [client, cutoff, options, activeRead, summaryKey])
  const referenceTime = displayedRead?.reference ?? 0
  const { assignments, legend } = useMemo(() => {
    const assignments = new globalThis.Map<string, Assignment>()
    const counts = new globalThis.Map<string, Assignment & { count: number }>()
    for (const entry of classificationClasses(classification, attributeClasses?.categories ?? [], bands)) {
      counts.set(entry.key, { ...entry, count: 0 })
    }
    for (const station of stations ?? []) {
      if (!station.point) continue
      const id = identity(station.node)
      const assignment = assignStation(classification, station, summaries?.items?.get(id), referenceTime, bands, !!summaries?.error)
      if (!assignment) continue
      assignments.set(id, assignment)
      const entry = counts.get(assignment.key)
      if (entry) entry.count++
      else counts.set(assignment.key, { ...assignment, count: 1 })
    }
    return { assignments, legend: [...counts.values()] }
  }, [stations, classification, summaries, attributeClasses, referenceTime, bands])
  const classificationError = summaries?.error ?? attributeClasses?.error
  useLayoutEffect(() => {
    const current = layers.current
    if (!current) return
    closePopup(current)
    current.markers = []
    fitted.current = false
    const pins = document.createDocumentFragment()
    const polygonExtent = polygon && boundingExtent(polygon)
    const referenceX = polygonExtent && (polygonExtent[0]! + polygonExtent[2]!) / 2
    const extent = current.map.getView().getProjection().getExtent()
    for (const { node, point } of stations ?? []) {
      if (!point || !displayedCutoff || selection.asOf) continue
      const stationName = name(node)
      const id = identity(node)
      const label = `${stationName} / ${id}`
      const button = stationPin(label, stationPinTitle(stationName, id))
      const position = fromLonLat([point[1], point[0]])
      if (referenceX !== undefined) position[0] = wrapMapX(position[0]!, referenceX)
      // As with the previous map, valid polar coordinates stay at Web Mercator's edge.
      position[1] = clamp(position[1]!, extent[1]!, extent[3]!)
      pins.append(button)
      current.markers.push({ button, position, id, name: stationName })
      button.onclick = () => {
        const wasSelected = current.selected === button
        closePopup(current)
        if (wasSelected) return
        current.selected = button
        button.classList.add('is-selected')
        button.setAttribute('aria-pressed', 'true')
        const station = { ...reference(node), cutoff: displayedCutoff, asOf: selection.asOf }
        const action = showStationPopup(current.popupElement, button.title, () => closePopup(current),
          () => open.current(station), () => {
            if (action) void openStationGraph(current, action, stationName, station)
          })
        current.popup.setPosition(position)
      }
    }
    current.markerLayer.hidden = true
    current.markerLayer.replaceChildren(pins)
    if (!current.viewInteracted && !draftPoints.current) {
      fitted.current = fitStations(current)
    }
    current.map.renderSync()
  }, [stations, displayedCutoff, selection.asOf, polygon, openStationGraph])
  useLayoutEffect(() => {
    const current = layers.current
    if (current) stylePins(current, assignments, hiddenClasses)
  }, [assignments, hiddenClasses, stations, displayedCutoff, polygon])
  useEffect(() => {
    const current = layers.current
    if (!current) return
    setPinsDisabled(current.markers, drawing)
  }, [drawing, stations, displayedCutoff, polygon])
  const mapped = stations?.filter((station) => station.point).length ?? 0
  const hiddenCount = legend.reduce((count, entry) => count + (hiddenClasses.has(entry.key) ? entry.count : 0), 0)
  const failure = error ?? (!cutoff ? request ? currentCapture?.error : initial.error : undefined)
  return <section className="station-map-panel" aria-label="Map" onKeyDown={(event) => {
    if (drawing && event.key === 'Escape') { event.preventDefault(); stopDrawing() }
  }}>
    <div className="metadata-toolbar">
      {selection.asOf ? <p role="status">Historical station coordinates are unavailable. No current coordinates have been substituted.</p>
        : !stations && !failure ? <p role="status">Loading stations...</p>
          : stations && <p role="status">{(mapped - hiddenCount).toLocaleString('en')} stations shown; {(stations.length - mapped).toLocaleString('en')} without coordinates.
            {hiddenCount > 0 && ` ${hiddenCount.toLocaleString('en')} hidden by classification.`}</p>}
      <div className="metadata-toolbar-right">
      <TableRefresh label="Reload map" updatedAt={updatedAt} onRefresh={reloadMap}
        busy={loading} disabled={!!selection.asOf}
        paused={drawing || Boolean(cutoff && ((attribute && !attributeClasses) ||
          (options && stations?.some(({ point }) => point) && !summaries)))} />
      <MetadataDownload key={JSON.stringify({ path, epoch: state.epoch })} kind="map" client={client}
        selection={selection} collection="stations" cutoff={cutoff} onExpired={onExpired} complete={!!activeRead?.stations} />
      </div>
    </div>
    {drawing && <div className="station-polygon-controls">
        <button type="button" disabled={!draft.length} onClick={() => {
          changeDraft(draft.slice(0, -1))
          setPolygonError('')
        }}>Undo vertex</button>
        <button type="button" onClick={() => finishDrawing()}>Finish polygon</button>
    </div>}
    {drawing && <p className="station-polygon-hint" role="status">
      Click to add vertices; double-click to finish and apply. Use the arrow keys to pan and Enter to add a vertex at the map center.
      {' '}{draft.length} {draft.length === 1 ? 'vertex' : 'vertices'}.
    </p>}
    {drawing && polygonError && <p className="station-polygon-hint" role="alert">{polygonError}</p>}
    <div className="station-map-frame">
      <StationClassificationControls disabled={!!selection.asOf || drawing} config={classification} apply={(next) => {
        if (next.mode !== classification.mode || (next.mode === 'attribute' && classification.mode === 'attribute' &&
          next.attribute !== classification.attribute)) setHiddenClasses(new Set())
        setClassification(next)
      }}
        filters={selection.filters}
        client={client} cutoff={selection.asOf ? undefined : displayedCutoff ?? cutoff} onExpired={onExpired}
        hiddenClasses={hiddenClasses} toggleClass={(key, visible) => setHiddenClasses((previous) => {
          const next = new Set(previous)
          if (visible) next.delete(key)
          else next.add(key)
          return next
        })}
        legend={legend} reference={referenceTime} error={classificationError} retry={classificationError ?
          () => setClassificationAttempt((value) => value + 1) : undefined}
        changeBand={(key, band) => setBands((previous) => new globalThis.Map(previous).set(key, band))} />
      {!lockedSelection && <IconButton ref={drawButton} className="station-polygon-icon"
        label={drawing ? 'Cancel drawing' : polygon ? 'Clear polygon selection' : 'Draw polygon'}
        disabled={!cutoff || !!selection.asOf} onClick={() => {
          if (drawing) stopDrawing()
          else if (polygon) state.setSelection((current) => ({ ...current, polygon: undefined }))
          else {
            if (layers.current) {
              closePopup(layers.current)
              layers.current.viewInteracted = true
            }
            changeDraft([])
            setPolygonError('')
            host.current?.focus()
          }
        }}><PolygonIcon drawing={drawing} applied={!!polygon} /></IconButton>}
      <div ref={host} className={drawing ? 'station-map is-drawing' : 'station-map'} role="region" aria-label="Station map" tabIndex={0}
      onKeyDown={(event) => {
        if (!drawing || event.target !== event.currentTarget) return
        if (event.key === 'Backspace') {
          event.preventDefault()
          changeDraft(draft.slice(0, -1))
          setPolygonError('')
          return
        }
        if (event.key !== 'Enter') return
        event.preventDefault()
        const center = layers.current?.map.getView().getCenter()
        if (center) addVertex(center)
      }} />
    </div>
    {failure && <div role="alert">{failure}<button type="button" onClick={() => {
      if (!cutoff) reloadMap()
      else setAttempt((value) => value + 1)
    }}>Retry map read</button></div>}
    {tileError && <div role="alert">OpenStreetMap tiles could not be loaded.<button type="button"
      onClick={() => { setTileError(false); layers.current?.tiles.refresh() }}>Retry map tiles</button></div>}
    {picker && <StationSeriesPicker station={picker.station} series={picker.series}
      onClose={() => setPicker(undefined)} onOpen={(series) => graph.current(series, picker.cutoff)} />}
  </section>
}
