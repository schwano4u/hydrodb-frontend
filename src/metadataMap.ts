import { ApiError } from './api'
import type { MetadataPath } from './api'
import { catalogPath, decodeNode, decodePage, identity, name, reference } from './metadata'
import type { DetailSelection, MetadataClient, MetadataNode, SelectedSeries, Selection } from './metadata'

export interface MapStation { node: MetadataNode; point?: [number, number] }
export const mapPageSize = 3000
const mapExportPageSize = 250

export async function readStationSeries(client: MetadataClient, station: DetailSelection,
  signal: AbortSignal): Promise<SelectedSeries[]> {
  const selection = { q: '', asOf: station.asOf, filters: [{ collection: 'stations' as const, field: 'station_id', values: [station.id] }] }
  const series = new Map<string, SelectedSeries>()
  const cursors = new Set<string>()
  let after = ''
  do {
    const page = await client.read(catalogPath(selection, 'series', { limit: '50', after }, station.cutoff),
      (body) => decodePage(body, decodeNode), signal)
    signal.throwIfAborted()
    for (const node of page.items) {
      if (node.collection !== 'series' || node.item.station_id !== station.id || series.has(identity(node))) {
        throw new ApiError('malformed', 'The station catalog returned unexpected or repeated time series.')
      }
      const selected = { ...reference(node), name: name(node), cutoff: station.cutoff, asOf: station.asOf }
      series.set(selected.id, selected)
    }
    after = page.next ?? ''
    if (after && (cursors.has(after) || !page.items.length)) {
      throw new ApiError('malformed', 'The station catalog returned a non-advancing page.')
    }
    cursors.add(after)
  } while (after)
  return [...series.values()]
}

export function exportMapGeoJson(stations: MapStation[], selection: Selection, cutoff: string): Blob {
  const body = JSON.stringify({
    type: 'FeatureCollection',
    read_cutoff: cutoff, filters: selection.filters, q: selection.q,
    coordinate_scope: 'current_only',
    polygon: selection.polygon && { projection: 'EPSG:3857', vertices: selection.polygon },
    features: stations.map(({ node, point }) => ({
      type: 'Feature', id: identity(node),
      geometry: point ? { type: 'Point', coordinates: [point[1], point[0]] } : null,
      properties: { ...node.item, status: node.status, position_scope: node.position_scope },
    })),
  }, (_key, value: unknown) => typeof value === 'bigint' ? value.toString() : value)
  const blob = new Blob([body], { type: 'application/geo+json' })
  if (blob.size > 50 * 1024 * 1024) {
    throw new ApiError('invalid-input', 'Download exceeds the 50 MiB browser export limit. Narrow the filters and try again. No partial file was downloaded.')
  }
  return blob
}

function decodeStation(value: unknown): MapStation {
  const node = decodeNode(value)
  if (node.collection !== 'stations') throw new ApiError('malformed', 'The map returned an unexpected metadata collection.')
  if (node.position_scope !== 'current_only' || node.item.station_location_status !== 'known') return { node }
  const location = node.item.station_location
  if (typeof location !== 'object' || location === null || Array.isArray(location) ||
    typeof location.latitude !== 'number' || !Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90 ||
    typeof location.longitude !== 'number' || !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180) {
    throw new ApiError('malformed', 'The map returned invalid station coordinates.')
  }
  return { node, point: [location.latitude, location.longitude] }
}
export async function downloadMapGeoJson(client: MetadataClient, selection: Selection, cutoff: string,
  signal: AbortSignal): Promise<Blob> {
  const path = catalogPath(selection, 'stations', { mode: 'map_export', limit: String(mapExportPageSize) }, cutoff)
  const stations = await readMapStations(client, path, signal)
  signal.throwIfAborted()
  return exportMapGeoJson(stations, selection, cutoff)
}

export async function readMapStations(client: MetadataClient, path: MetadataPath, signal: AbortSignal): Promise<MapStation[]> {
  const query = new URL(path, window.location.origin).searchParams
  const mode = query.get('mode')
  const maxItems = mode === 'map' ? mapPageSize : mode === 'map_export' ? mapExportPageSize : 50
  const stations: MapStation[] = []
  const cursors = new Set<string>()
  const ids = new Set<string>()
  let after = ''
  do {
    signal.throwIfAborted()
    query.set('after', after)
    const page = await client.read(`/api/v1/metadata/browser?${query}`, (body) => decodePage(body, decodeStation, maxItems), signal)
    signal.throwIfAborted()
    const next = page.next ?? ''
    if (next && (cursors.has(next) || !page.items.length)) {
      throw new ApiError('malformed', 'The map returned a non-advancing station page.')
    }
    for (const station of page.items) {
      const id = identity(station.node)
      if (ids.has(id)) throw new ApiError('malformed', 'The map returned a repeated station.')
      ids.add(id)
      stations.push(station)
    }
    after = next
    cursors.add(after)
  } while (after)
  return stations
}
