import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createDockview, themeLight } from 'dockview'
import type { AddPanelOptions, ContextMenuItem, DockviewApi, PopoutGroup, SerializedDockview } from 'dockview'
import { createPortal } from 'react-dom'
import MetadataBrowser from './MetadataBrowser'
import { useMetadataSelection } from './useMetadataSelection'
import MetadataDetail from './MetadataDetail'
import JobsPanel from './JobsPanel'
import StationMap from './StationMap'
import GraphPanels from './GraphPanels'
import IndependentMap from './IndependentMap'
import type { MapCopySeed } from './IndependentMap'
import type { MapClassificationSnapshot } from './stationClassification'
import SeriesSelectionToolbar from './SeriesSelectionToolbar'
import { seriesSelectionLimit } from './sampleViewer'
import { MetadataClient } from './metadata'
import type { DetailSelection, SelectedSeries } from './metadata'
import { decodeLayout, decodeNamedWorkspaceLayout, graphIds, graphPanels, isPanelId, isSamplePanel, layoutKey, panelPlacement, panels } from './workspaceLayout'
import type { GraphId, PanelId } from './workspaceLayout'
import { decodeWorkspaceSelections, encodeWorkspaceSelections, selectionsKey } from './workspaceSelections'
import type { GraphRequests, WorkspaceSelections } from './workspaceSelections'
import { WorkspaceMenus } from './ApplicationMenu'
import NamedLayouts from './NamedLayouts'
import 'dockview/dist/styles/dockview.css'

function isMetadataTool(id: string) {
  return id === 'filters' || id === 'station-tree'
}

const mapCopyIds = ['map-copy-1', 'map-copy-2', 'map-copy-3', 'map-copy-4'] as const
type MapCopyId = typeof mapCopyIds[number]
function isMapCopy(id: string): id is MapCopyId {
  return mapCopyIds.some((copy) => copy === id)
}
const mapCopyTitle = (id: MapCopyId) => `Map copy ${mapCopyIds.indexOf(id) + 1}`

function metadataEdge(dock: DockviewApi) {
  const existing = dock.getEdgeGroup('left')
  if (existing) return existing
  let groupId = 'metadata-tools'
  for (let index = 1; dock.groups.some((group) => group.id === groupId); index++) groupId = `metadata-tools-${index}`
  return dock.addEdgeGroup('left', {
    id: groupId, initialSize: Math.max(160, Math.min(600, dock.getPanel('filters')?.api.width ?? 300)),
    minimumSize: 160, maximumSize: 600, autoHide: false, autoReveal: true,
  })
}

function supplyMetadataTools(dock: DockviewApi) {
  const active = dock.activePanel
  const newTools = !dock.getPanel('filters') && !dock.getPanel('station-tree')
  const newEdge = !dock.getEdgeGroup('left')
  const edge = metadataEdge(dock)
  for (const [index, id] of (['filters', 'station-tree'] as const).entries()) {
    const panel = dock.getPanel(id)
    if (!panel) {
      dock.addPanel({ id, component: 'placeholder', title: panels[id].title,
        position: { referenceGroup: edge.id, direction: 'within', index } })
    } else if (panel.group.id !== edge.id && panel.group.panels.length === 1 && panel.api.location.type === 'grid') {
      const group = dock.groups.find((group) => group.id === edge.id)
      if (!group) throw new Error('Metadata edge group is unavailable.')
      panel.api.moveTo({ group, position: 'center', index })
    }
  }
  if (newTools || newEdge) dock.getPanel('filters')?.api.setActive()
  active?.api.setActive()
}

export default function Workspace({ principalId, csrfToken, onSessionExpired, health, menuHost }: { principalId: string; csrfToken: string; onSessionExpired: () => void; health: ReactNode; menuHost?: HTMLElement | null }) {
  const api = useRef<DockviewApi | null>(null)
  const closedPanels = useRef<Partial<Record<PanelId, SerializedDockview>>>({})
  const [open, setOpen] = useState<string[]>([])
  const [selected, setSelected] = useState('')
  const [jobsVisible, setJobsVisible] = useState(false)
  const [notice, setNotice] = useState('')
  const [storageError, setStorageError] = useState('')
  const [hosts, setHosts] = useState<{ id: PanelId | MapCopyId; element: HTMLElement }[]>([])
  const [detail, setDetail] = useState<DetailSelection>()
  const selectionKey = selectionsKey(window.location.origin, principalId)
  const [restored] = useState<{ value?: WorkspaceSelections; error?: string }>(() => {
    try {
      const saved = window.localStorage.getItem(selectionKey)
      return saved === null ? {} : { value: decodeWorkspaceSelections(saved) }
    } catch {
      return { error: 'Saved workspace selections could not be restored. Default selections are in use.' }
    }
  })
  const [selectionError, setSelectionError] = useState('')
  const [checkedSeries, setCheckedSeries] = useState<SelectedSeries[]>(restored.value?.checked ?? [])
  const [client] = useState(() => new MetadataClient())
  const applyingLayout = useRef(false)
  const [graphRequests, setGraphRequests] = useState<GraphRequests>(restored.value?.graphs ?? {})
  const recentGraphs = useRef<GraphId[]>([])
  const metadataState = useMetadataSelection({ client, onExpired: onSessionExpired },
    open.some((id) => id === 'metadata' || id === 'map' || id === 'filters' || id === 'station-tree'), restored.value)
  const mapCopies = useRef(new Map<MapCopyId, MapCopySeed>())
  const mapClassification = useRef<MapClassificationSnapshot | undefined>(undefined)
  const recordMapClassification = useCallback((snapshot: MapClassificationSnapshot | undefined) => {
    mapClassification.current = snapshot
  }, [])
  const [mapCount, setMapCount] = useState(0)
  const [readyCopies, setReadyCopies] = useState<ReadonlySet<MapCopyId>>(() => new Set())
  function openMapWindow(target?: PopoutGroup) {
    const dock = api.current
    if (!dock) return
    const id = mapCopyIds.find((copy) => !mapCopies.current.has(copy))
    if (!id) { setNotice(`Up to ${mapCopyIds.length} independent map copies can be open.`); return }
    mapCopies.current.set(id, structuredClone({
      selection: metadataState.selection, cutoff: metadataState.cutoff, classification: mapClassification.current,
    }))
    setMapCount(mapCopies.current.size)
    const panel = dock.addPanel({
      id, title: mapCopyTitle(id), component: 'placeholder', inactive: true,
      position: target ? { referenceGroup: target.group.id, direction: 'within' } : { direction: 'right' },
    })
    const ready = () => setReadyCopies((current) => new Set([...current, id]))
    if (target) {
      ready()
      panel.api.setActive()
      target.window.focus()
      return
    }
    const removal = () => {
      if (api.current === dock && dock.getPanel(id) === panel) dock.removePanel(panel)
    }
    void dock.addPopoutGroup(panel, {
      position: { left: window.screenX + 30, top: window.screenY + 45, width: 1000, height: 740 },
    }).then((opened) => {
      if (!opened) removal()
      else if (api.current === dock && dock.getPanel(id) === panel) ready()
    })
  }
  const openMapWindowRef = useRef(openMapWindow)
  useEffect(() => { openMapWindowRef.current = openMapWindow })
  const sameAsOf = !checkedSeries.length || checkedSeries[0]?.asOf === metadataState.selection.asOf
  if (!sameAsOf) setCheckedSeries([])
  const checked = sameAsOf ? checkedSeries : []
  const metadataSelection = metadataState.selection
  useEffect(() => {
    let error = ''
    try {
      window.localStorage.setItem(selectionKey, encodeWorkspaceSelections({
        selection: metadataSelection, checked: sameAsOf ? checkedSeries : [], graphs: graphRequests,
      }))
    } catch {
      error = 'Workspace selections could not be saved. Changes remain in memory only.'
    }
    // Report the result of synchronizing with browser storage.
    // oxlint-disable-next-line react/set-state-in-effect
    setSelectionError(error)
  }, [selectionKey, metadataSelection, sameAsOf, checkedSeries, graphRequests])

  function toggleSeries(selection: SelectedSeries) {
    setCheckedSeries((previous) => {
      const current = previous[0]?.asOf === selection.asOf ? previous : []
      if (current.some(({ id }) => id === selection.id)) return current.filter(({ id }) => id !== selection.id)
      return current.length < seriesSelectionLimit ? [...current, selection] : current
    })
  }
  const key = layoutKey(window.location.origin, principalId)

  const save = useCallback((dock: DockviewApi) => {
    // Keep the last docked snapshot until all temporary windows return.
    const layout = dock.toJSON()
    if (layout.popoutGroups?.length || mapCopies.current.size) return
    try {
      const saved = decodeLayout(JSON.stringify({ version: 2, layout, closedPanels: closedPanels.current }))
      window.localStorage.setItem(key, JSON.stringify(saved))
      setStorageError('')
    } catch {
      setStorageError('The workspace layout could not be saved. Changes remain in memory only.')
    }
  }, [key])

  const mount = useCallback((element: HTMLDivElement | null) => {
    if (!element) return
    let disposed = false
    const dock = createDockview(element, {
      theme: themeLight,
      floatingGroupBounds: 'boundedWithinViewport',
      getTabContextMenuItems: ({ panel, group, api: dock }) => {
        if (isMetadataTool(panel.id)) return []
        const location = panel.api.location
        const source = location.type === 'popout' ? location.getWindow() : window
        const items: ContextMenuItem[] = location.type === 'popout' ? [] : ['popout']
        const primaryMap = panel.id === 'map'
        const copy = isMapCopy(panel.id)
        if (primaryMap) items.splice(0, items.length, {
          label: 'Open in New Window', disabled: mapCopies.current.size >= mapCopyIds.length,
          action: () => openMapWindowRef.current(),
        })
        if (location.type === 'popout') items.push({ label: 'Rename Panel', action: () => {
          const title = source.prompt('Panel name', panel.title ?? '')?.trim()
          if (title) panel.api.setTitle(title.slice(0, 80))
        } })
        if (!primaryMap && !copy && !isSamplePanel(panel.id)) return items
        if (location.type === 'popout') {
          if (!copy) items.push({ label: 'Move to Main Window', action: () => {
            const target = dock.groups.find((candidate) => candidate.api.location.type === 'grid' && candidate.panels.length)
              ?? dock.addGroup()
            panel.api.moveTo({ group: target, position: 'center' })
            window.focus()
          } })
          items.push({ label: 'Split Right', disabled: group.panels.length < 2,
            action: () => panel.api.moveTo({ group, position: 'right' }) })
        }
        for (const [index, target] of dock.getPopouts().entries()) {
          if (target.window === source) continue
          const label = [...mapCopies.current.keys()].find((id) => {
            const location = dock.getPanel(id)?.api.location
            return location?.type === 'popout' && location.getWindow() === target.window
          })
          const title = label ? dock.getPanel(label)?.title ?? mapCopyTitle(label) : `Window ${index + 1}`
          if (primaryMap) items.push({
            label: `Copy to ${title}`, disabled: mapCopies.current.size >= mapCopyIds.length,
            action: () => openMapWindowRef.current(target),
          })
          else items.push({ label: `Move to ${title}`, action: () => {
            panel.api.moveTo({ group: target.group, position: 'center' })
            panel.api.setActive()
            target.window.focus()
          } })
        }
        return items
      },
      defaultTabComponent: 'workspace',
      createTabComponent: ({ id }) => {
        if (!isMetadataTool(id)) return
        const tab = document.createElement('div')
        tab.className = 'dv-default-tab'
        tab.dataset.metadataTool = id
        const title = document.createElement('span')
        title.className = 'dv-default-tab-content'
        tab.append(title)
        return { element: tab, init: (params) => { title.textContent = params.title } }
      },
      createComponent: ({ id, name }) => {
        if (name !== 'placeholder' || (!isPanelId(id) && !(isMapCopy(id) && mapCopies.current.has(id)))) {
          throw new Error('Unknown workspace panel.')
        }
        const content = document.createElement('article')
        if (id !== 'welcome') {
          setHosts((current) => [...current.filter((host) => host.id !== id), { id, element: content }])
          return { element: content, init() {}, dispose() {
            if (id === 'detail') setDetail(undefined)
            if (isMapCopy(id)) {
              mapCopies.current.delete(id)
              if (!disposed) {
                setMapCount(mapCopies.current.size)
                setReadyCopies((current) => new Set([...current].filter((copy) => copy !== id)))
              }
            }
            if (!disposed) setHosts((current) => current.filter((host) => host.element !== content))
          } }
        }
        content.className = 'placeholder-panel'
        content.tabIndex = 0
        content.setAttribute('aria-label', `${panels[id].title} placeholder`)
        const title = document.createElement('h4')
        title.textContent = panels[id].title
        const text = document.createElement('p')
        text.textContent = panels[id].text
        content.append(title, text)
        return { element: content, init() {}, dispose() { content.replaceChildren() } }
      },
    })
    api.current = dock
    function defaults() {
      dock.clear()
      dock.addPanel({ id: 'welcome', component: 'placeholder', title: panels.welcome.title })
    }
    try {
      const saved = window.localStorage.getItem(key)
      if (saved !== null) {
        try {
          const restored = decodeLayout(saved)
          dock.fromJSON(restored.layout)
          closedPanels.current = restored.closedPanels ?? {}
        } catch {
          defaults()
          setNotice('Saved layout was invalid or obsolete. The default workspace has been restored.')
        }
      } else {
        defaults()
      }
    } catch {
      defaults()
      setNotice('Saved layout could not be read. The default workspace has been restored.')
    }
    const absentGraphs = graphIds.filter((id) => !dock.getPanel(id) && !dock.getPanel(graphPanels[id]))
    setGraphRequests((current) => {
      if (!absentGraphs.some((id) => current[id])) return current
      const next = { ...current }
      for (const id of absentGraphs) delete next[id]
      return next
    })
    if (dock.getPanel('metadata') || dock.getPanel('map')) {
      supplyMetadataTools(dock)
      delete closedPanels.current.filters
      delete closedPanels.current['station-tree']
    }
    else for (const panel of dock.panels.filter((panel) => isMetadataTool(panel.id))) dock.removePanel(panel)
    function protectToolTabs(event: KeyboardEvent) {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const target = event.target
      if (!(target instanceof Element) || !target.closest('[role="tab"]')?.querySelector('[data-metadata-tool]')) return
      event.preventDefault()
      event.stopPropagation()
    }
    element.addEventListener('keydown', protectToolTabs, true)
    function updateActivePanels() {
      const activeId = dock.activePanel?.id ?? ''
      const owner = graphIds.find((id) => id === activeId || graphPanels[id] === activeId)
      if (owner && recentGraphs.current[0] !== owner) {
        recentGraphs.current = [owner, ...recentGraphs.current.filter((id) => id !== owner)]
      }
      setSelected(activeId)
      setJobsVisible(dock.getPanel('jobs')?.api.isVisible ?? false)
    }
    function changed() {
      if (applyingLayout.current) return
      setOpen(dock.panels.map((panel) => panel.id))
      updateActivePanels()
      save(dock)
    }
    const layoutListener = dock.onDidLayoutChange(changed)
    const activeListener = dock.onDidActivePanelChange(updateActivePanels)
    const popoutFailureListener = dock.onDidOpenPopoutWindowFail(({ reason }) => {
      setNotice(reason === 'blocked'
        ? 'The browser blocked the new window. Allow pop-ups for HydroDB and try again.'
        : 'The panel could not open in a new window.')
    })
    const popoutListener = dock.onDidAddPopoutGroup(() => { setNotice('') })
    const moveListener = dock.onDidMovePanel(({ panel }) => {
      if (!isMapCopy(panel.id) || panel.api.location.type === 'popout') return
      // Dockview redocks all panels on window close; copies are temporary.
      queueMicrotask(() => {
        if (!disposed && dock.getPanel(panel.id) === panel && panel.api.location.type !== 'popout') {
          dock.removePanel(panel)
        }
      })
    })
    const dropListener = dock.onWillDrop((event) => {
      const source = event.getData()
      if (!source) return
      const moved = source.panelId ? [dock.getPanel(source.panelId)] : dock.getGroup(source.groupId)?.panels ?? []
      const location = event.group?.api.location
      const targetIsPopout = location?.type === 'popout'
      if (moved.some((panel) => panel && (panel.id === 'map' ? targetIsPopout : isMapCopy(panel.id) && !targetIsPopout))) {
        event.preventDefault()
      }
    })
    let beforeMutation = dock.toJSON()
    const beforeListener = dock.onWillMutateLayout(() => { beforeMutation = dock.toJSON() })
    let syncingTools = false
    const afterListener = dock.onDidMutateLayout((event) => {
      if (applyingLayout.current) return
      if (event.kind === 'remove' && !beforeMutation.popoutGroups?.length
        && !Object.keys(beforeMutation.panels).some(isMapCopy)) {
        for (const id of Object.keys(beforeMutation.panels).filter(isPanelId)) {
          if (!dock.getPanel(id) && (!isSamplePanel(id) || id === 'series' || id === 'series-data')) {
            closedPanels.current[id] = beforeMutation
          }
        }
      }
      if (event.kind === 'remove' || event.kind === 'clear') {
        const closed = graphIds.filter((id) => !dock.getPanel(id) && !dock.getPanel(graphPanels[id]))
        recentGraphs.current = recentGraphs.current.filter((id) => !closed.includes(id))
        setGraphRequests((current) => {
          if (!closed.some((id) => current[id])) return current
          const next = { ...current }
          for (const id of closed) delete next[id]
          return next
        })
      }
      for (const panel of dock.panels) {
        if (isPanelId(panel.id)) delete closedPanels.current[panel.id]
      }
      if (!syncingTools && event.kind === 'remove') {
        syncingTools = true
        try {
          if (dock.getPanel('metadata') || dock.getPanel('map')) supplyMetadataTools(dock)
          else for (const panel of dock.panels.filter((panel) => isMetadataTool(panel.id))) dock.removePanel(panel)
        } finally { syncingTools = false }
      }
    })
    changed()
    return () => {
      disposed = true
      layoutListener.dispose()
      activeListener.dispose()
      popoutFailureListener.dispose()
      popoutListener.dispose()
      moveListener.dispose()
      dropListener.dispose()
      beforeListener.dispose()
      afterListener.dispose()
      element.removeEventListener('keydown', protectToolTabs, true)
      api.current = null
      dock.dispose()
      client.clear()
    }
  }, [key, save, client])

  function add(id: PanelId) {
    const dock = api.current
    if (!dock) return
    const existing = dock.getPanel(id)
    if (existing) return existing
    if (isMetadataTool(id)) {
      supplyMetadataTools(dock)
      return dock.getPanel(id)
    }
    const previous = closedPanels.current[id]
    const placement = panelPlacement(id, dock.toJSON(), previous)
    return dock.addPanel({
      id, component: 'placeholder', title: panels[id].title,
      ...placement,
    })
  }

  function show(id: PanelId, tableOwner?: GraphId) {
    const dock = api.current
    if (!dock) return
    if ((id === 'filters' || id === 'station-tree') && !dock.getPanel('metadata')) show('metadata')
    const newMetadata = (id === 'metadata' || id === 'map') && !dock.getPanel(id)
    const panel = tableOwner && !dock.getPanel(id) && dock.getPanel(tableOwner)
      ? dock.addPanel({ id, component: 'placeholder', title: panels[id].title,
        position: { referencePanel: tableOwner, direction: 'within' } })
      : add(id)
    if (!panel) return
    if (newMetadata) {
      supplyMetadataTools(dock)
    }
    panel.api.setActive()
    dock.focus()
  }

  function viewSamples(selections: DetailSelection[], initialCutoff?: string) {
    const dock = api.current
    if (!dock) return
    const openGraph = (id: GraphId) => dock.getPanel(id) || dock.getPanel(graphPanels[id])
    const id = recentGraphs.current.find(openGraph) ?? graphIds.find(openGraph) ?? 'series'
    show(id)
    if (!dock.getPanel(graphPanels[id])) {
      dock.addPanel({ id: graphPanels[id], component: 'placeholder', title: panels[graphPanels[id]].title,
        position: { referencePanel: id, direction: 'within' }, inactive: true })
    }
    setGraphRequests((current) => ({ ...current, [id]: { selections: [...selections], initialCutoff } }))
  }

  function togglePanel(id: PanelId) {
    const active = api.current?.activePanel
    if (active?.id === id) active.api.close()
    else show(id)
  }

  function arrange(split: boolean) {
    const dock = api.current
    if (!dock) return
    const central = dock.panels.filter((panel) => !isMetadataTool(panel.id) && panel.api.location.type !== 'popout')
    const first = central[0]
    if (!first) return
    for (const panel of central.slice(1)) {
      panel.api.moveTo({ group: first.group, position: split ? 'right' : 'center' })
    }

    dock.focus()
  }

  const openDetail = (selection: DetailSelection, source?: string) => {
    const dock = api.current
    if (!dock) return
    if (!dock.getPanel('detail')) {
      const anchor = source && dock.getPanel(source)
      let position: AddPanelOptions['position'] = anchor ? { referencePanel: anchor.id, direction: 'right' } : undefined
      if (anchor && anchor.group.id === dock.getEdgeGroup('left')?.id) {
        // Native edge groups cannot split; use the adjacent leftmost central group.
        let root = dock.toJSON().grid.root
        while (Array.isArray(root.data) && root.data[0]) root = root.data[0]
        position = Array.isArray(root.data) ? undefined : { referenceGroup: root.data.id, direction: 'left' }
      }
      dock.addPanel({
        id: 'detail', component: 'placeholder', title: panels.detail.title,
        position,
      })
    }
    setDetail(selection)
    show('detail')
  }

  function captureLayout() {
    const dock = api.current
    if (!dock) throw new Error('The workspace is not ready.')
    if (dock.getPopouts().length || mapCopies.current.size) throw new Error('Close panel windows before saving a named layout.')
    const { layout } = decodeLayout(JSON.stringify({ version: 2, layout: dock.toJSON() }))
    return { version: 2, layout: { ...layout, panels: Object.fromEntries(Object.entries(layout.panels)
      .map(([id, panel]) => [id, { id, contentComponent: panel.contentComponent }])) } }
  }

  function applyLayout(snapshot: unknown) {
    const dock = api.current
    if (!dock) throw new Error('The workspace is not ready.')
    if (dock.getPopouts().length || mapCopies.current.size) throw new Error('Close panel windows before applying a named layout.')
    const { layout, skipped } = decodeNamedWorkspaceLayout(snapshot)
    const previous = dock.toJSON()
    const previousDetail = detail
    applyingLayout.current = true
    try {
      dock.fromJSON(layout)
      closedPanels.current = {}
      setGraphRequests({})
      setDetail(dock.getPanel('detail') ? previousDetail : undefined)
      setNotice(skipped.size ? `Unavailable panels skipped: ${[...skipped].join(', ')}.` : '')
    } catch {
      dock.fromJSON(previous)
      setDetail(previousDetail)
      throw new Error('The named layout could not be restored. The previous workspace was kept.')
    } finally {
      applyingLayout.current = false
      setOpen(dock.panels.map((panel) => panel.id))
      setSelected(dock.activePanel?.id ?? '')
      setJobsVisible(dock.getPanel('jobs')?.api.isVisible ?? false)
      save(dock)
    }
  }

  const view = <WorkspaceMenus onHealth={() => togglePanel('health')} healthOpen={open.includes('health')}
    layoutMenu={<NamedLayouts csrfToken={csrfToken} onExpired={onSessionExpired} capture={captureLayout} apply={applyLayout} />}
    onJobs={() => togglePanel('jobs')} jobsOpen={open.includes('jobs')} items={[
    ...(['welcome', 'metadata', 'map'] as const).map((id) => ({
      label: panels[id].title, checked: open.includes(id), action: () => togglePanel(id),
    })),
    { label: 'New Map', disabled: mapCount >= mapCopyIds.length, action: () => openMapWindow() },
    { label: panels.series.title, checked: open.includes('series'), action: () => togglePanel('series') },
    { label: 'New Time Series Graph', disabled: graphIds.every((id) => open.includes(id) || open.includes(graphPanels[id])), action: () => {
      const dock = api.current
      const id = graphIds.find((id) => !dock?.getPanel(id) && !dock?.getPanel(graphPanels[id]))
      if (id) show(id)
    } },
    { separator: true },
    { label: 'Close Active Panel', disabled: !selected || isMetadataTool(selected), action: () => {
      if (!isMetadataTool(selected)) api.current?.getPanel(selected)?.api.close()
    } },
    { label: 'Float Active Panel', disabled: !selected || selected === 'map' || isMapCopy(selected)
      || api.current?.getPanel(selected)?.api.location.type === 'popout', action: () => {
      const dock = api.current
      const panel = dock?.getPanel(selected)
      if (dock && panel) {
        dock.addFloatingGroup(panel, { width: Math.min(480, dock.width), height: Math.min(360, dock.height) })
        panel.api.setActive()
        dock.focus()
      }
    } },
    { label: 'Arrange as Tabs', disabled: open.filter((id) => id !== 'filters' && id !== 'station-tree').length < 2, action: () => arrange(false) },
    { label: 'Arrange Side by Side', disabled: open.filter((id) => id !== 'filters' && id !== 'station-tree').length < 2, action: () => arrange(true) },
    { separator: true },
    { label: 'Reset Layout', action: () => {
      const dock = api.current
      if (!dock) return
      dock.clear()
      setGraphRequests({})
      closedPanels.current = {}
      dock.addPanel({ id: 'welcome', component: 'placeholder', title: panels.welcome.title })
      setNotice('')
    } },
  ]} />

  return (
    <section className="workspace-card" aria-label="Read-only workspace">
      {menuHost ? createPortal(view, menuHost) : view}
      {notice && <p role="status">{notice}</p>}
      {storageError && <p role="alert">{storageError}</p>}
      {(selectionError || restored.error) && <p role="alert">{selectionError || restored.error}</p>}
      <div className="dock-host" ref={mount} />
      {hosts.filter(({ id }) => !isSamplePanel(id)).map((host) => createPortal(isMapCopy(host.id)
        ? readyCopies.has(host.id) && <IndependentMap seed={mapCopies.current.get(host.id)!} onExpired={onSessionExpired}
          panelApi={api.current?.getPanel(host.id)?.api}
          onOpen={(selection) => openDetail(selection, 'map')} onOpenSeries={viewSamples} />
        : host.id === 'metadata' || host.id === 'filters' || host.id === 'station-tree'
        ? <MetadataBrowser state={metadataState} view={host.id === 'filters' ? 'Filters' : host.id === 'station-tree' ? 'Tree view' : 'By instance type'}
          client={client} onExpired={onSessionExpired} onOpen={(selection) => openDetail(selection, host.id)}
          seriesSelection={host.id !== 'filters' ? {
            ids: checked.map(({ id }) => id), toggle: toggleSeries,
            toolbar: checked.length > 0 && <SeriesSelectionToolbar
              selections={checked} client={client} onExpired={onSessionExpired} onClear={() => setCheckedSeries([])}
              onRemove={(removedId) => setCheckedSeries((current) => current.filter(({ id }) => id !== removedId))}
              onOpen={() => viewSamples(checked)} />,
          } : undefined} />
        : host.id === 'map' ? <StationMap state={metadataState} client={client} onExpired={onSessionExpired}
          classificationSnapshot={recordMapClassification}
          onOpen={(selection) => openDetail(selection, 'map')} onOpenSeries={viewSamples} />
        : host.id === 'health' ? health
          : host.id === 'jobs' ? <JobsPanel active={jobsVisible} onExpired={onSessionExpired} />
          : detail ? <MetadataDetail key={JSON.stringify(detail)} selection={detail} client={client} onExpired={onSessionExpired}
            onOpen={(selection) => openDetail(selection, 'detail')} />
          : <p className="metadata-panel">{panels.detail.text}</p>, host.element, host.id))}
      {graphIds.map((id) => {
        const chart = hosts.find((host) => host.id === id)?.element
        const table = hosts.find((host) => host.id === graphPanels[id])?.element
        const tableInPopout = api.current?.getPanel(graphPanels[id])?.api.location.type === 'popout'
        const request = graphRequests[id]
        return (chart || table) && <GraphPanels key={id} id={id} chart={chart} table={table} tableInPopout={tableInPopout} request={request}
          onPeriod={({ start, end }) => setGraphRequests((current) => {
            const graph = current[id]
            if (!graph || graph.selections !== request?.selections ||
              (graph.period?.start === start && graph.period.end === end)) return current
            return { ...current, [id]: { ...graph, period: { start, end } } }
          })}
          chartPanelApi={api.current?.getPanel(id)?.api}
          client={client} onExpired={onSessionExpired} openTable={() => show(graphPanels[id], id)} />
      })}
    </section>
  )
}
