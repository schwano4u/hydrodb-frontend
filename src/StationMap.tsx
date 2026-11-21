import { useEffect, useRef, useState } from 'react'
import Map from 'ol/Map.js'
import View from 'ol/View.js'
import Overlay from 'ol/Overlay.js'
import Zoom from 'ol/control/Zoom.js'
import Attribution from 'ol/control/Attribution.js'
import TileLayer from 'ol/layer/Tile.js'
import OSM from 'ol/source/OSM.js'
import { boundingExtent } from 'ol/extent.js'
import { unByKey } from 'ol/Observable.js'
import { fromLonLat } from 'ol/proj.js'
import { clamp } from 'ol/math.js'
import { ApiError } from './api'
import ReloadIcon from './ReloadIcon'
import { catalogPath, identity, name, reference } from './metadata'
import type { DetailSelection, MetadataClient } from './metadata'
import { readMapStations } from './metadataMap'
import type { MapStation } from './metadataMap'
import type { useMetadataSelection } from './useMetadataSelection'
import 'ol/ol.css'

interface MapLayers {
  map: Map; markers: Overlay[]; tiles: OSM
  popup: Overlay; popupElement: HTMLDivElement; selected: HTMLButtonElement | null
}

function fitStations({ map, markers }: MapLayers): boolean {
  map.updateSize()
  const points = markers.flatMap((marker) => {
    const point = marker.getPosition()
    return point ? [point] : []
  })
  const size = map.getSize()
  if (!points.length || !size || size[0] === 0 || size[1] === 0) return false
  map.getView().cancelAnimations()
  map.getView().fit(boundingExtent(points), { padding: [24, 24, 24, 24], maxZoom: 14, size })
  return true
}

function closePopup(current: MapLayers) {
  if (current.popupElement.contains(document.activeElement)) current.selected?.focus()
  current.selected?.classList.remove('is-selected')
  current.selected?.setAttribute('aria-pressed', 'false')
  current.selected = null
  current.popup.setPosition(undefined)
  current.popupElement.replaceChildren()
}

function stationPin(label: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'station-map-marker'
  button.title = label
  button.setAttribute('aria-label', label)
  button.setAttribute('aria-pressed', 'false')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 32')
  svg.setAttribute('aria-hidden', 'true')
  const pin = document.createElementNS(svg.namespaceURI, 'path')
  pin.setAttribute('d', 'M12 0C5.4 0 0 5.4 0 12c0 8.4 12 20 12 20s12-11.6 12-20C24 5.4 18.6 0 12 0Z')
  const center = document.createElementNS(svg.namespaceURI, 'circle')
  center.setAttribute('cx', '12')
  center.setAttribute('cy', '12')
  center.setAttribute('r', '4.5')
  svg.append(pin, center)
  button.append(svg)
  return button
}

export default function StationMap({ state, client, onExpired, onOpen }: {
  state: ReturnType<typeof useMetadataSelection>; client: MetadataClient
  onExpired: () => void; onOpen: (selection: DetailSelection) => void
}) {
  const { selection, cutoff, initial } = state
  const path = cutoff && !selection.asOf ? catalogPath(selection, 'stations', { limit: '50', after: '' }, cutoff) : null
  const [result, setResult] = useState<{ path: string | null; stations?: MapStation[]; error?: string }>({ path: null })
  const [attempt, setAttempt] = useState(0)
  const [tileError, setTileError] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  const layers = useRef<MapLayers | null>(null)
  const fitted = useRef(false)
  const open = useRef(onOpen)
  useEffect(() => { open.current = onOpen }, [onOpen])
  useEffect(() => {
    if (!path) return
    const controller = new AbortController()
    void readMapStations(client, path, controller.signal).then(
      (stations) => { if (!controller.signal.aborted) setResult({ path, stations }) },
      (error: unknown) => {
        if (controller.signal.aborted) return
        if (error instanceof ApiError && error.status === 401) { client.clear(); onExpired() }
        setResult({ path, error: error instanceof ApiError ? error.message : 'Stations could not be read. Retry the map read.' })
      },
    )
    return () => controller.abort()
  }, [path, client, onExpired, attempt])
  useEffect(() => {
    const element = host.current
    if (!element) return
    const tiles = new OSM({ referrerPolicy: 'origin' })
    const tileListener = tiles.on('tileloaderror', () => setTileError(true))
    const map = new Map({
      target: element,
      layers: [new TileLayer({ source: tiles })],
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
    const current: MapLayers = { map, markers: [], tiles, popup, popupElement, selected: null }
    layers.current = current
    map.on('singleclick', () => closePopup(current))
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closePopup(current)
    }
    element.addEventListener('keydown', onKeyDown)
    const observer = new ResizeObserver(() => {
      map.updateSize()
      if (!fitted.current) fitted.current = fitStations(current)
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      element.removeEventListener('keydown', onKeyDown)
      unByKey(tileListener)
      map.dispose()
      tiles.dispose()
      layers.current = null
    }
  }, [])
  const stations = result.path === path ? result.stations : undefined
  const error = result.path === path ? result.error : undefined
  useEffect(() => {
    const current = layers.current
    if (!current) return
    closePopup(current)
    for (const marker of current.markers) current.map.removeOverlay(marker)
    current.markers = []
    fitted.current = false
    for (const { node, point } of stations ?? []) {
      if (!point || !cutoff || selection.asOf) continue
      const label = `${name(node)} / ${identity(node)}`
      const button = stationPin(label)
      const position = fromLonLat([point[1], point[0]])
      // As with the previous map, valid polar coordinates stay at Web Mercator's edge.
      const extent = current.map.getView().getProjection().getExtent()
      position[1] = clamp(position[1]!, extent[1]!, extent[3]!)
      const marker = new Overlay({ element: button, position, positioning: 'bottom-center',
        className: 'station-map-marker-overlay' })
      current.map.addOverlay(marker)
      current.markers.push(marker)
      button.onclick = () => {
        const wasSelected = current.selected === button
        closePopup(current)
        if (wasSelected) return
        current.selected = button
        button.classList.add('is-selected')
        button.setAttribute('aria-pressed', 'true')
        const close = document.createElement('button')
        close.type = 'button'
        close.className = 'metadata-reload station-map-popup-close'
        close.setAttribute('aria-label', 'Close station popup')
        close.textContent = '\u00d7'
        close.onclick = () => closePopup(current)
        const title = document.createElement('p')
        title.textContent = label
        const details = document.createElement('button')
        details.type = 'button'
        details.textContent = 'Open station details'
        details.onclick = () => open.current({ ...reference(node), cutoff, asOf: selection.asOf })
        current.popupElement.append(close, title, details)
        current.popup.setPosition(position)
      }
    }
    fitted.current = fitStations(current)
  }, [stations, cutoff, selection.asOf])
  const shown = stations?.filter((station) => station.point).length ?? 0
  const failure = error ?? (!cutoff ? initial.error : undefined)
  return <section className="station-map-panel" aria-label="Map">
    <div className="metadata-toolbar">
      {selection.asOf ? <p role="status">Historical station coordinates are unavailable. No current coordinates have been substituted.</p>
        : !stations && !failure ? <p role="status">Loading stations...</p>
          : stations && <p role="status">{shown.toLocaleString('en')} stations shown; {(stations.length - shown).toLocaleString('en')} without coordinates.</p>}
      <button type="button" className="metadata-reload" aria-label="Reload map" title="Reload map" onClick={state.refresh}>
        <ReloadIcon />
      </button>
    </div>
    <div ref={host} className="station-map" role="region" aria-label="Station map" tabIndex={0} />
    {failure && <div role="alert">{failure}<button type="button" onClick={() => {
      if (!cutoff) initial.retry()
      else { setResult({ path: null }); setAttempt((value) => value + 1) }
    }}>Retry map read</button></div>}
    {tileError && <div role="alert">OpenStreetMap tiles could not be loaded.<button type="button"
      onClick={() => { setTileError(false); layers.current?.tiles.refresh() }}>Retry map tiles</button></div>}
  </section>
}
