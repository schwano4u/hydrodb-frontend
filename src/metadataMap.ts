import { ApiError } from './api'
import type { MetadataPath } from './api'
import { decodeNode, decodePage, identity } from './metadata'
import type { MetadataClient, MetadataNode } from './metadata'

export interface MapStation { node: MetadataNode; point?: [number, number] }

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
const decodeStations = (body: unknown) => decodePage(body, decodeStation)

export async function readMapStations(client: MetadataClient, path: MetadataPath, signal: AbortSignal): Promise<MapStation[]> {
  const query = new URL(path, window.location.origin).searchParams
  const stations: MapStation[] = []
  const cursors = new Set<string>()
  const ids = new Set<string>()
  let after = ''
  do {
    signal.throwIfAborted()
    query.set('after', after)
    const page = await client.read(`/api/v1/metadata/browser?${query}`, decodeStations, signal)
    signal.throwIfAborted()
    for (const station of page.items) {
      const id = identity(station.node)
      if (ids.has(id)) throw new ApiError('malformed', 'The map returned a repeated station.')
      ids.add(id)
      stations.push(station)
    }
    after = page.next ?? ''
    if (after && (cursors.has(after) || !page.items.length)) {
      throw new ApiError('malformed', 'The map returned a non-advancing station page.')
    }
    cursors.add(after)
  } while (after)
  return stations
}
