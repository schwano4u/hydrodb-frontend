import { finishMapPolygon, MAX_POLYGON_VERTICES } from './mapPolygon'
import type { MapPoint } from './mapPolygon'
import { isCollection, object } from './metadata'
import type { DetailSelection, SelectedSeries, Selection } from './metadata'
import { seriesSelectionLimit, timestampMicros, validateSampleQuery } from './sampleViewer'
import type { SampleQuery } from './sampleViewer'
import { graphIds, layoutKey } from './workspaceLayout'
import type { GraphId } from './workspaceLayout'

export type GraphPeriod = Pick<SampleQuery, 'start' | 'end'>
export type GraphRequest = { selections: DetailSelection[]; period?: GraphPeriod; initialCutoff?: string }
export type GraphRequests = Partial<Record<GraphId, GraphRequest>>
export type WorkspaceSelections = { selection: Selection; checked: SelectedSeries[]; graphs: GraphRequests }

const storageLimit = 128 * 1024
const invalid = () => new Error('Invalid saved workspace selections.')
const bounded = (value: unknown, length = 1024): value is string => typeof value === 'string' && value.length <= length
const coordinate = (value: unknown): value is MapPoint => Array.isArray(value) && value.length === 2 &&
  value.every((n: unknown) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 61_000_000)

export const selectionsKey = (origin: string, principalId: string) => `${layoutKey(origin, principalId)}:selections`

function asOf(value: unknown): string {
  if (!bounded(value, 40)) throw invalid()
  if (value) timestampMicros(value)
  return value
}

function decodeSelection(value: unknown): Selection {
  if (!object(value) || !bounded(value.q, 200) || !Array.isArray(value.filters) || value.filters.length > 12) throw invalid()
  const filters = value.filters.map((filter: unknown) => {
    if (!object(filter) || !isCollection(filter.collection) || !bounded(filter.field, 128) || !filter.field ||
      !Array.isArray(filter.values) || !filter.values.length || filter.values.length > 20 ||
      !filter.values.every((item: unknown) => bounded(item))) throw invalid()
    return { collection: filter.collection, field: filter.field, values: filter.values }
  })
  const instanceStatus = value.instanceStatus
  if (instanceStatus !== undefined && instanceStatus !== 'active' && instanceStatus !== 'retired') throw invalid()
  const polygon = value.polygon
  if (polygon !== undefined && (!Array.isArray(polygon) || polygon.length > MAX_POLYGON_VERTICES ||
    !polygon.every(coordinate))) throw invalid()
  return { q: value.q, asOf: asOf(value.asOf), filters, instanceStatus, polygon: polygon && finishMapPolygon(polygon) }
}

function decodeSeries(value: unknown): DetailSelection {
  if (!object(value) || !bounded(value.id) || !value.id) throw invalid()
  return { collection: 'series', id: value.id, asOf: asOf(value.asOf), cutoff: '', field: '', version: '' }
}

function decodeList<T extends DetailSelection>(value: unknown, decode: (entry: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > seriesSelectionLimit) throw invalid()
  const list = value.map(decode)
  if (list.some((item) => item.asOf !== list[0]?.asOf) || new Set(list.map(({ id }) => id)).size !== list.length) throw invalid()
  return list
}

export function decodeWorkspaceSelections(raw: string): WorkspaceSelections {
  if (raw.length > storageLimit) throw invalid()
  const value: unknown = JSON.parse(raw)
  if (!object(value) || value.version !== 1 || !object(value.graphs)) throw invalid()
  const selection = decodeSelection(value.selection)
  const checked = decodeList(value.checked, (entry) => {
    if (!object(entry) || !bounded(entry.name)) throw invalid()
    return { ...decodeSeries(entry), name: entry.name }
  })
  if (checked.length && checked[0]?.asOf !== selection.asOf) throw invalid()
  const graphs: GraphRequests = {}
  for (const id of graphIds) {
    const graph = value.graphs[id]
    if (graph === undefined) continue
    if (!object(graph)) throw invalid()
    const selections = decodeList(graph.selections, decodeSeries)
    if (!selections[0]) throw invalid()
    let period: GraphPeriod | undefined
    if (graph.period !== undefined) {
      if (!object(graph.period) || !bounded(graph.period.start, 40) || !bounded(graph.period.end, 40)) throw invalid()
      period = { start: graph.period.start, end: graph.period.end }
      validateSampleQuery({ ...period, asOf: selections[0].asOf })
    }
    graphs[id] = { selections, period }
  }
  return { selection, checked, graphs }
}

export function encodeWorkspaceSelections({ selection, checked, graphs }: WorkspaceSelections): string {
  const saved = JSON.stringify({
    version: 1, selection, checked: checked.map(({ id, asOf, name }) => ({ id, asOf, name })),
    graphs: Object.fromEntries(graphIds.flatMap((id) => {
      const graph = graphs[id]
      return graph ? [[id, { period: graph.period, selections: graph.selections.map(({ id, asOf }) => ({ id, asOf })) }]] : []
    })),
  })
  if (saved.length > storageLimit) throw invalid()
  return saved
}
