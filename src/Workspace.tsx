import { useCallback, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createDockview, themeLight } from 'dockview'
import type { AddPanelOptions, DockviewApi, SerializedDockview } from 'dockview'
import { createPortal } from 'react-dom'
import MetadataBrowser from './MetadataBrowser'
import { useMetadataSelection } from './useMetadataSelection'
import MetadataDetail from './MetadataDetail'
import StationMap from './StationMap'
import { MetadataClient } from './metadata'
import type { DetailSelection } from './metadata'
import { decodeLayout, isPanelId, layoutKey, panelPlacement, panels } from './workspaceLayout'
import type { PanelId } from './workspaceLayout'
import { WorkspaceMenus } from './ApplicationMenu'
import 'dockview/dist/styles/dockview.css'

function isMetadataTool(id: string) {
  return id === 'filters' || id === 'station-tree'
}

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

export default function Workspace({ principalId, onSessionExpired, health, menuHost }: { principalId: string; onSessionExpired: () => void; health: ReactNode; menuHost?: HTMLElement | null }) {
  const api = useRef<DockviewApi | null>(null)
  const closedPanels = useRef<Partial<Record<PanelId, SerializedDockview>>>({})
  const [open, setOpen] = useState<string[]>([])
  const [selected, setSelected] = useState('')
  const [notice, setNotice] = useState('')
  const [storageError, setStorageError] = useState('')
  const [hosts, setHosts] = useState<{ id: PanelId; element: HTMLElement }[]>([])
  const [detail, setDetail] = useState<DetailSelection>()
  const [client] = useState(() => new MetadataClient())
  const metadataState = useMetadataSelection({ client, onExpired: onSessionExpired },
    open.some((id) => id === 'metadata' || id === 'map' || id === 'filters' || id === 'station-tree'))
  const key = layoutKey(window.location.origin, principalId)

  const save = useCallback((dock: DockviewApi) => {
    try {
      const saved = decodeLayout(JSON.stringify({ version: 2, layout: dock.toJSON(), closedPanels: closedPanels.current }))
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
        if (name !== 'placeholder' || !isPanelId(id)) throw new Error('Unknown workspace panel.')
        const content = document.createElement('article')
        if (id === 'metadata' || id === 'map' || id === 'filters' || id === 'station-tree' || id === 'detail' || id === 'health') {
          setHosts((current) => [...current.filter((host) => host.id !== id), { id, element: content }])
          return { element: content, init() {}, dispose() {
            if (id === 'detail') setDetail(undefined)
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
    function changed() {
      setOpen(dock.panels.map((panel) => panel.id))
      setSelected(dock.activePanel?.id ?? '')
      save(dock)
    }
    const layoutListener = dock.onDidLayoutChange(changed)
    const activeListener = dock.onDidActivePanelChange(() => setSelected(dock.activePanel?.id ?? ''))
    let beforeMutation = dock.toJSON()
    const beforeListener = dock.onWillMutateLayout(() => { beforeMutation = dock.toJSON() })
    let syncingTools = false
    const afterListener = dock.onDidMutateLayout((event) => {
      if (event.kind === 'remove') {
        for (const id of Object.keys(beforeMutation.panels).filter(isPanelId)) {
          if (!dock.getPanel(id)) closedPanels.current[id] = beforeMutation
        }
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

  function show(id: PanelId) {
    const dock = api.current
    if (!dock) return
    if ((id === 'filters' || id === 'station-tree') && !dock.getPanel('metadata')) show('metadata')
    const newMetadata = (id === 'metadata' || id === 'map') && !dock.getPanel(id)
    const panel = add(id)
    if (!panel) return
    if (newMetadata) {
      supplyMetadataTools(dock)
    }
    panel.api.setActive()
    dock.focus()
  }

  function arrange(split: boolean) {
    const dock = api.current
    if (!dock) return
    const central = dock.panels.filter((panel) => panel.id !== 'filters' && panel.id !== 'station-tree')
    const first = central[0]
    if (!first) return
    for (const panel of central.slice(1)) {
      panel.api.moveTo({ group: first.group, position: split ? 'right' : 'center' })
    }

    dock.focus()
  }

  const openDetail = (selection: DetailSelection, source: PanelId) => {
    const dock = api.current
    if (!dock) return
    if (!dock.getPanel('detail')) {
      let position: AddPanelOptions['position'] = { referencePanel: source, direction: 'right' }
      if (dock.getPanel(source)?.group.id === dock.getEdgeGroup('left')?.id) {
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

  const view = <WorkspaceMenus onHealth={() => show('health')} healthOpen={open.includes('health')} items={[
    ...(['welcome', 'metadata', 'map', 'series'] as const).map((id) => ({
      label: panels[id].title, checked: open.includes(id), action: () => show(id),
    })),
    { separator: true },
    { label: 'Close Active Panel', disabled: !selected || isMetadataTool(selected), action: () => {
      if (!isMetadataTool(selected)) api.current?.getPanel(selected)?.api.close()
    } },
    { label: 'Float Active Panel', disabled: !selected, action: () => {
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
      <div className="dock-host" ref={mount} />
      {hosts.map((host) => createPortal(host.id === 'metadata' || host.id === 'filters' || host.id === 'station-tree'
        ? <MetadataBrowser state={metadataState} view={host.id === 'filters' ? 'Filters' : host.id === 'station-tree' ? 'Tree view' : 'By instance type'}
          client={client} onExpired={onSessionExpired} onOpen={(selection) => openDetail(selection, host.id)} />
        : host.id === 'map' ? <StationMap state={metadataState} client={client} onExpired={onSessionExpired}
          onOpen={(selection) => openDetail(selection, 'map')} />
        : host.id === 'health' ? health
          : detail ? <MetadataDetail key={JSON.stringify(detail)} selection={detail} client={client} onExpired={onSessionExpired} onOpen={(selection) => openDetail(selection, 'detail')} />
          : <p className="metadata-panel">{panels.detail.text}</p>, host.element, host.id))}
    </section>
  )
}
