import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StationMap from './StationMap'
import { readMapStations } from './metadataMap'
import { catalogPath, MetadataClient } from './metadata'
import { useMetadataSelection } from './useMetadataSelection'

function station(id: string, latitude: number | null = 53, longitude = 8) {
  return { collection: 'stations', status: 'active', references: [], position_scope: 'current_only',
    item: { station_id: id, station_name: `Station ${id}`, station_metadata_version: '1',
      station_validity_start: '2026-11-20T12:00:00Z', station_location_status: latitude === null ? 'unknown' : 'known',
      station_location: latitude === null ? null : { latitude, longitude } } }
}
const response = (items: unknown[], next: string | null = null) =>
  new Response(JSON.stringify({ items, next_after: next, read_cutoff: 'fixed' }))

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function TestMap({ client, onOpen }: { client: MetadataClient; onOpen: () => void }) {
  const onExpired = vi.fn()
  const state = useMetadataSelection({ client, onExpired })
  return <>
    <button onClick={() => state.setSelection({ ...state.selection,
      filters: [{ collection: 'stations', field: 'station_id', values: ['B'] }] })}>Select B</button>
    <button onClick={() => state.setSelection({ ...state.selection, asOf: '2026-11-20T12:00:00Z' })}>Historical view</button>
    <StationMap state={state} client={client} onExpired={onExpired} onOpen={onOpen} />
  </>
}

describe('station map', () => {
  it('loads all station pages, skips unknown coordinates, follows filters, and opens exact details without substituting historical coordinates', async () => {
    const requests: URL[] = []
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (path: string) => {
      const url = new URL(path, 'https://test'); requests.push(url)
      if (url.searchParams.get('collection') !== 'stations') return response([])
      if (url.searchParams.get('filters')!.includes('"B"')) return response([station('B', 0, 0)])
      return url.searchParams.get('after') ? response([station('B', 0, 0)]) : response([station('A'), station('C', null)], 'A')
    }))
    const onOpen = vi.fn()
    render(<TestMap client={new MetadataClient()} onOpen={onOpen} />)
    await screen.findByText('2 stations shown; 1 without coordinates.')
    // jsdom has no map viewport; browser tests verify visible overlays and sizing.
    expect(screen.getByRole('button', { name: 'Station A / A', hidden: true })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Station C / C', hidden: true })).not.toBeInTheDocument()
    expect(requests.filter((url) => url.searchParams.get('collection') === 'stations')
      .every((url) => url.searchParams.get('read_cutoff') === 'fixed' && url.searchParams.get('limit') === '50')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Select B' }))
    await screen.findByText('1 stations shown; 0 without coordinates.')
    expect(screen.queryByRole('button', { name: 'Station A / A', hidden: true })).not.toBeInTheDocument()
    const selected = screen.getByRole('button', { name: 'Station B / B', hidden: true })
    fireEvent.click(selected)
    expect(selected).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Close station popup', hidden: true }))
    expect(selected).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('button', { name: 'Open station details', hidden: true })).not.toBeInTheDocument()
    fireEvent.click(selected)
    fireEvent.click(screen.getByRole('button', { name: 'Open station details', hidden: true }))
    expect(onOpen).toHaveBeenCalledWith({ collection: 'stations', id: 'B', version: '1', field: '', cutoff: 'fixed', asOf: '' })
    fireEvent.click(screen.getByRole('button', { name: 'Historical view' }))
    await screen.findByText('Historical station coordinates are unavailable. No current coordinates have been substituted.')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Station B / B', hidden: true })).not.toBeInTheDocument())
  })

  it('rejects malformed known coordinates instead of displaying a success-shaped empty map', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => response([station('A', 91)])))
    await expect(readMapStations(new MetadataClient(),
      catalogPath({ filters: [], q: '', asOf: '' }, 'stations', { limit: '50' }, 'fixed'),
      new AbortController().signal)).rejects.toThrow('invalid station coordinates')
  })

  it('rejects repeated page cursors instead of silently showing a partial station collection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (path: string) =>
      response([station(new URL(path, 'https://test').searchParams.get('after') ? 'B' : 'A')], 'A')))
    await expect(readMapStations(new MetadataClient(),
      catalogPath({ filters: [], q: '', asOf: '' }, 'stations', { limit: '50' }, 'fixed'),
      new AbortController().signal)).rejects.toThrow('non-advancing station page')
  })
})
