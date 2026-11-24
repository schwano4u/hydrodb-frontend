import { Orientation } from 'dockview'
import type { AddPanelOptions, SerializedDockview } from 'dockview'

export const panels = {
  welcome: { title: 'Welcome', text: 'Read-only workspace. Open Metadata to browse authorized instances. No samples or scientific operations are loaded.' },
  health: { title: 'Health', text: '' },
  jobs: { title: 'Jobs', text: '' },
  metadata: { title: 'Metadata', text: '' },
  map: { title: 'Map', text: '' },
  filters: { title: 'Filters', text: '' },
  'station-tree': { title: 'Tree view', text: '' },
  series: { title: 'Time series graph', text: 'Select a Time series in Metadata and choose Open visualization.' },
  'series-data': { title: 'Time series data', text: 'Exact samples share the Time series graph query. Selection and sample data are not persisted in the layout.' },
  'series-2': { title: 'Time series graph 2' },
  'series-data-2': { title: 'Time series data 2' },
  'series-3': { title: 'Time series graph 3' },
  'series-data-3': { title: 'Time series data 3' },
  'series-4': { title: 'Time series graph 4' },
  'series-data-4': { title: 'Time series data 4' },
  detail: { title: 'Details', text: 'Select a metadata instance to inspect its retained version. Instance selection is not persisted in the layout.' },
}
export const panelLimit = Object.keys(panels).length
export type PanelId = keyof typeof panels
export const graphPanels = {
  series: 'series-data',
  'series-2': 'series-data-2',
  'series-3': 'series-data-3',
  'series-4': 'series-data-4',
} as const
export type GraphId = keyof typeof graphPanels
export const graphIds = Object.keys(graphPanels).filter(isGraphId)
export function isGraphId(id: string): id is GraphId {
  return Object.hasOwn(graphPanels, id)
}
export function isSamplePanel(id: string) {
  return isGraphId(id) || Object.values(graphPanels).some((table) => table === id)
}
export type WorkspaceLayout = { version: 2; layout: SerializedDockview; closedPanels?: Partial<Record<PanelId, SerializedDockview>> }
type Group = NonNullable<NonNullable<SerializedDockview['floatingGroups']>[number]['data']>
export function isPanelId(value: unknown): value is PanelId {
  return typeof value === 'string' && Object.hasOwn(panels, value)
}
export function layoutKey(origin: string, principalId: string): string {
  return `hydrodb.workspace:${encodeURIComponent(origin)}:${encodeURIComponent(principalId)}`
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function invalid(): never {
  throw new Error('Invalid or obsolete workspace layout.')
}
function dimension(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10000) invalid()
  return value
}
function optionalDimension(value: unknown): number | undefined {
  return value === undefined ? undefined : dimension(value)
}
function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || typeof value === 'boolean') return value
  return invalid()
}

export function leftEdgeGroup(layout: SerializedDockview): Group | undefined {
  const data = layout.edgeGroups?.left?.group
  if (data === undefined) return
  if (!record(data) || typeof data.id !== 'string' || !Array.isArray(data.views)) invalid()
  const views = data.views.map((id: unknown) => { if (!isPanelId(id)) invalid(); return id })
  if (data.activeView !== undefined && (!isPanelId(data.activeView) || !views.includes(data.activeView))) invalid()
  return { id: data.id, views, activeView: data.activeView }
}

function decodeDockview(layout: unknown, skipped?: Set<string>): SerializedDockview {
  if (!record(layout) || !record(layout.grid) || !record(layout.panels)) invalid()
  if (layout.popoutGroups !== undefined && (!Array.isArray(layout.popoutGroups) || layout.popoutGroups.length)) invalid()
  const seen = new Set<string>()
  const groups = new Set<string>()
  let count = 0
  function group(data: unknown, allowEmpty = false): Group {
    if (!record(data)) invalid()
    if (typeof data.id !== 'string' || !/^[\w-]{1,64}$/.test(data.id) || groups.has(data.id) ||
      !Array.isArray(data.views) || (!allowEmpty && data.views.length === 0) || data.views.length > panelLimit) invalid()
    groups.add(data.id)
    const originalViews: unknown[] = data.views
    const views = originalViews.flatMap((id) => {
      if (typeof id !== 'string' || seen.has(id)) invalid()
      seen.add(id)
      if (isPanelId(id)) return [id]
      if (!skipped || !/^[a-z][a-z0-9-]{0,63}$/.test(id)) invalid()
      skipped.add(id)
      return []
    })
    if (data.activeView !== undefined && !originalViews.includes(data.activeView)) invalid()
    return { id: data.id, views, activeView: data.activeView === undefined ? undefined : isPanelId(data.activeView) ? data.activeView : views[0] }
  }
  function node(value: unknown, depth = 0): SerializedDockview['grid']['root'] {
    if (!record(value) || depth > 8 || ++count > 24) invalid()
    const size = value.size === undefined ? undefined : dimension(value.size)
    if (value.type === 'branch') {
      if (!Array.isArray(value.data) || value.data.length > panelLimit) invalid()
      return { type: 'branch', data: value.data.map((child) => node(child, depth + 1)), size }
    }
    if (value.type !== 'leaf') invalid()
    return { type: 'leaf', size, data: group(value.data) }
  }
  function grid(value: unknown): SerializedDockview['grid'] {
    if (!record(value) || (value.orientation !== Orientation.HORIZONTAL && value.orientation !== Orientation.VERTICAL)) invalid()
    return { root: node(value.root), width: dimension(value.width), height: dimension(value.height), orientation: value.orientation }
  }
  const mainGrid = grid(layout.grid)
  const floatingGroups: NonNullable<SerializedDockview['floatingGroups']> = []
  if (layout.floatingGroups !== undefined) {
    if (!Array.isArray(layout.floatingGroups) || layout.floatingGroups.length > panelLimit) invalid()
    for (const floating of layout.floatingGroups) {
      if (!record(floating) || !record(floating.position) || (floating.data === undefined) === (floating.grid === undefined)) invalid()
      const box = floating.position
      if ((box.left === undefined) === (box.right === undefined) || (box.top === undefined) === (box.bottom === undefined)) invalid()
      const horizontal = box.left !== undefined ? { left: dimension(box.left) } : { right: dimension(box.right) }
      const vertical = box.top !== undefined ? { top: dimension(box.top) } : { bottom: dimension(box.bottom) }
      const position = { ...horizontal, ...vertical, width: dimension(box.width), height: dimension(box.height) }
      if (position.width < 1 || position.height < 1) invalid()
      if (floating.grid !== undefined) {
        floatingGroups.push({ grid: grid(floating.grid), position })
      } else {
        const leaf = node({ type: 'leaf', data: floating.data })
        if (Array.isArray(leaf.data)) invalid()
        floatingGroups.push({ data: leaf.data, position })
      }
    }
  }
  const edgeGroups: NonNullable<SerializedDockview['edgeGroups']> = {}
  if (layout.edgeGroups !== undefined) {
    if (!record(layout.edgeGroups) || Object.keys(layout.edgeGroups).some((position) => position !== 'left')) invalid()
    const edge = layout.edgeGroups.left
    if (edge !== undefined) {
      if (!record(edge) || typeof edge.visible !== 'boolean') invalid()
      const minimumSize = optionalDimension(edge.minimumSize)
      const maximumSize = optionalDimension(edge.maximumSize)
      if (minimumSize !== undefined && maximumSize !== undefined && minimumSize > maximumSize) invalid()
      edgeGroups.left = {
        size: dimension(edge.size), visible: edge.visible, group: group(edge.group, true),
        collapsed: optionalBoolean(edge.collapsed), autoHide: optionalBoolean(edge.autoHide),
        autoReveal: optionalBoolean(edge.autoReveal), minimumSize, maximumSize,
        collapsedSize: optionalDimension(edge.collapsedSize),
      }
    }
  }
  const serializedPanels: SerializedDockview['panels'] = {}
  if (Object.keys(layout.panels).length !== seen.size) invalid()
  for (const id of seen) {
    const panel: unknown = layout.panels[id]
    if (!record(panel) || panel.id !== id || panel.contentComponent !== 'placeholder' ||
      panel.params !== undefined || (panel.tabComponent !== undefined && panel.tabComponent !== 'workspace')) invalid()
    if (!isPanelId(id)) continue
    serializedPanels[id] = { id, contentComponent: 'placeholder', title: panels[id].title }
  }

  if (layout.activeGroup !== undefined && (typeof layout.activeGroup !== 'string' || !groups.has(layout.activeGroup))) invalid()
  return { grid: mainGrid, panels: serializedPanels, activeGroup: layout.activeGroup,
    ...(floatingGroups.length ? { floatingGroups } : {}), ...(edgeGroups.left ? { edgeGroups } : {}) }
}

export function decodeLayout(text: string): WorkspaceLayout {
  if (text.length > 16000) invalid()
  const saved: unknown = JSON.parse(text)
  if (!record(saved) || saved.version !== 2 ||
    (saved.height !== undefined && saved.height !== 480 && saved.height !== 720)) invalid()
  const layout = decodeDockview(saved.layout)
  const closedPanels: Partial<Record<PanelId, SerializedDockview>> = {}
  if (saved.closedPanels !== undefined) {
    if (!record(saved.closedPanels) || Object.keys(saved.closedPanels).length > panelLimit) invalid()
    for (const [id, snapshot] of Object.entries(saved.closedPanels)) {
      if (!isPanelId(id) || layout.panels[id]) invalid()
      const previous = decodeDockview(snapshot)
      if (!previous.panels[id]) invalid()
      closedPanels[id] = previous
    }
  }
  return {
    version: 2, layout,
    ...(Object.keys(closedPanels).length ? { closedPanels } : {}),
  }
}

type GridNode = SerializedDockview['grid']['root']

export function decodeNamedWorkspaceLayout(snapshot: unknown) {
  const skipped = new Set<string>()
  if (!record(snapshot) || snapshot.version !== 2 || JSON.stringify(snapshot).length > 16000) invalid()
  const layout = decodeDockview(snapshot.layout, skipped)
  if (!skipped.size) return { layout, skipped }
  function prune(node: GridNode): GridNode | undefined {
    if (!Array.isArray(node.data)) return node.data.views.length ? node : undefined
    const data = node.data.map(prune).filter((child) => child !== undefined)
    return data.length ? { ...node, data } : undefined
  }
  layout.grid.root = prune(layout.grid.root) ?? { type: 'branch', data: [] }
  layout.floatingGroups = layout.floatingGroups?.flatMap((floating) => {
    if (floating.data) return floating.data.views.length ? [floating] : []
    if (!floating.grid) return []
    const root = prune(floating.grid.root)
    return root ? [{ ...floating, grid: { ...floating.grid, root } }] : []
  })
  const edge = leftEdgeGroup(layout)
  const edgeId = edge?.views.length ? edge.id : undefined
  if (edge && !edgeId) delete layout.edgeGroups?.left
  const remaining = [edgeId, ...leaves(layout.grid.root).map(({ id }) => id),
    ...(layout.floatingGroups ?? []).flatMap((floating) => floating.grid ? leaves(floating.grid.root).map(({ id }) => id) : [floating.data?.id])]
  if (!remaining.includes(layout.activeGroup)) delete layout.activeGroup
  if (!Object.keys(layout.panels).length) invalid()
  return { layout, skipped }
}

type Placement = { position?: AddPanelOptions['position']; floating?: false }
  | { floating: Exclude<AddPanelOptions['floating'], false | undefined>; position?: never }
function leaves(node: GridNode): Group[] {
  return Array.isArray(node.data) ? node.data.flatMap(leaves) : [node.data]
}

export function panelPlacement(id: PanelId, current: SerializedDockview, previous?: SerializedDockview): Placement {
  const left = leftEdgeGroup(current)
  const currentGroups = [
    ...leaves(current.grid.root),
    ...(current.floatingGroups ?? []).flatMap((floating) => floating.data ? [floating.data] : floating.grid ? leaves(floating.grid.root) : []),
    ...(left ? [left] : []),
  ]
  if (previous) {
    const floating = previous.floatingGroups?.find((group) =>
      (group.data ? [group.data] : group.grid ? leaves(group.grid.root) : []).some((leaf) => leaf.views.includes(id)))
    const tree = floating?.grid ?? previous.grid
    const oldEdge = leftEdgeGroup(previous)
    const oldGroup = floating?.data ?? leaves(tree.root).find((group) => group.views.includes(id)) ??
      (oldEdge?.views.includes(id) ? oldEdge : undefined)
    if (oldGroup) {
      const surviving = currentGroups.find((group) => group.id === oldGroup.id || group.views.some((panel) => oldGroup.views.includes(panel)))
      if (surviving) return { position: { referenceGroup: surviving.id, direction: 'within', index: oldGroup.views.indexOf(id) } }
    }
    function neighbor(node: GridNode, orientation: Orientation): Pick<AddPanelOptions, 'position'> | undefined {
      if (!Array.isArray(node.data)) return
      const index = node.data.findIndex((child) => leaves(child).some((group) => group.views.includes(id)))
      if (index < 0) return
      const nested = neighbor(node.data[index]!, orientation === Orientation.HORIZONTAL ? Orientation.VERTICAL : Orientation.HORIZONTAL)
      if (nested) return nested
      for (let distance = 1; distance < node.data.length; distance++) {
        for (const candidate of [index - distance, index + distance]) {
          const sibling = node.data[candidate]
          if (!sibling) continue
          const anchor = leaves(sibling).flatMap((group) => group.views).find((panel) => current.panels[panel])
          if (anchor) return { position: {
            referencePanel: anchor,
            direction: orientation === Orientation.HORIZONTAL
              ? candidate < index ? 'right' : 'left' : candidate < index ? 'below' : 'above',
          } }
        }
      }
    }
    const position = neighbor(tree.root, tree.orientation)
    if (position) return position
    if (floating) return { floating: { position: floating.position, width: floating.position.width, height: floating.position.height } }
  }
  if ((id === 'filters' || id === 'station-tree') && left) {
    return { position: { referenceGroup: left.id, direction: 'within' } }
  }
  const central = leaves(current.grid.root).find((group) => group.views.includes('welcome')) ?? leaves(current.grid.root)[0]
  return central ? { position: { referenceGroup: central.id, direction: id === 'detail' ? 'right' : 'within' } } : {}
}
