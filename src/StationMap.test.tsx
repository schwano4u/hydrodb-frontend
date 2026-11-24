import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StationMap from './StationMap'
import { downloadMapGeoJson, mapPageSize, readMapStations } from './metadataMap'
import { catalogPath, MetadataClient } from './metadata'
import { useMetadataSelection } from './useMetadataSelection'

function station(id: string, latitude: number | null = 53, longitude = 8) {
  return { collection: 'stations', status: 'active', references: [], position_scope: 'current_only',
    item: { station_id: id, station_name: `Station ${id}`, station_metadata_version: '1',
      station_validity_start: '2026-11-20T12:00:00Z', station_location_status: latitude === null ? 'unknown' : 'known',
      station_location: latitude === null ? null : { latitude, longitude } } }
}
const response = (items: unknown[], next: string | null = null, cutoff = 'fixed') =>
  new Response(JSON.stringify({ items, next_after: next, read_cutoff: cutoff }))

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function TestMap({ client, onOpen }: { client: MetadataClient; onOpen: () => void }) {
  const onExpired = vi.fn()
  const state = useMetadataSelection({ client, onExpired })
  return <>
    <output aria-label="Shared Metadata cutoff">{state.cutoff}</output>
    <button onClick={() => state.setSelection({ ...state.selection,
      filters: [{ collection: 'stations', field: 'station_id', values: ['B'] }] })}>Select B</button>
    <button onClick={() => state.setSelection({ ...state.selection,
      filters: [{ collection: 'series', field: 'parameter_id', values: ['p:stage', 'p:rain'] }] })}>Filter two parameters</button>
    <button onClick={() => state.setSelection({ ...state.selection,
      filters: [{ collection: 'parameters', field: 'parameter_name', values: ['Water level'] }] })}>Filter water level by name</button>
    <button onClick={() => state.setSelection({ ...state.selection, filters: [] })}>Clear filters</button>
    <button onClick={() => state.setSelection({ ...state.selection, asOf: '2026-11-20T12:00:00Z' })}>Historical view</button>
    <StationMap state={state} client={client} onExpired={onExpired} onOpen={onOpen} onOpenSeries={vi.fn()} />
  </>
}

describe('station map', () => {
  it('reloads only the map at a fresh cutoff, with the same active filters', async () => {
    const fetch = vi.fn(async (path: string) => {
      const { searchParams } = new URL(path, 'https://test')
      const cutoff = searchParams.get('read_cutoff')
      if (searchParams.get('collection') === 'series') return response([])
      if (!cutoff) return response([], null, 'fresh')
      const filtered = searchParams.get('filters')?.includes('"B"')
      return response([station(filtered ? 'B' : 'A'), ...(cutoff === 'fresh' ? [station('C')] : [])], null, cutoff)
    })
    vi.stubGlobal('fetch', fetch)
    render(<TestMap client={new MetadataClient()} onOpen={vi.fn()} />)
    await screen.findByLabelText('Station A / A')
    fireEvent.click(screen.getByRole('button', { name: 'Select B' }))
    await screen.findByLabelText('Station B / B')
    fetch.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Reload map' }))
    await screen.findByLabelText('Station C / C')
    expect(screen.getByLabelText('Shared Metadata cutoff')).toHaveTextContent('fixed')
    const reads = fetch.mock.calls.map(([path]) => new URL(path, 'https://test').searchParams)
    expect(reads.every((params) => params.get('collection') === 'stations')).toBe(true)
    const mapRead = reads.find((params) => params.get('mode') === 'map')
    expect(mapRead?.get('read_cutoff')).toBe('fresh')
    expect(JSON.parse(mapRead!.get('filters')!)).toEqual([
      { collection: 'stations', field: 'station_id', values: ['B'] },
    ])
  })

  it('uses named catalog choices and defaults to Raw without filtering statistic, name, or period', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-24T01:23:00Z'))
    const fetch = vi.fn(async (path: string) => {
      const { pathname, searchParams } = new URL(path, 'https://test')
      if (pathname.endsWith('/station-summaries')) {
        expect(searchParams.has('unit_id') || searchParams.get('match_mode') === 'latest_timestamp').toBe(true)
        expect(Object.fromEntries(searchParams)).toEqual({
          parameter_id: 'p:stage', level: 'raw',
          ...(searchParams.has('unit_id') ? { unit_id: 'u:m' } : { match_mode: 'latest_timestamp' }),
          station_ids: '["A"]', read_cutoff: 'fixed',
        })
        return response([{ station_id: 'A', status: 'sample', series_id: 'interval', statistic: 'maximum',
          period: { kind: 'fixed' }, timestamp: '2026-11-24T00:00:00Z', value: 0, unit: 'm' }])
      }
      const collection = searchParams.get('collection')
      if (collection === 'stations') return response(searchParams.get('filters')?.includes('"B"') ? [] : [station('A')])
      if (collection !== 'units' && collection !== 'parameters') return response([])
      expect(searchParams.get('read_cutoff')).toBe('fixed')
      const choice = (prefix: string, id: string, name: string) => ({
        collection, status: 'active', references: [], position_scope: 'current_only',
        item: { [`${prefix}_id`]: id, [`${prefix}_name`]: name, [`${prefix}_metadata_version`]: '1',
          [`${prefix}_validity_start`]: '2026-11-20T12:00:00Z',
          ...(prefix === 'unit' ? { unit_symbol: id.slice(2) } : id === 'p:stage'
            ? { parameter_canonical_unit_id: 'u:m', parameter_allowed_unit_ids: ['u:m', 'u:cm'] }
            : { parameter_canonical_unit_id: 'u:mm', parameter_allowed_unit_ids: null }) },
      })
      if (collection === 'units') return response([
        choice('unit', 'u:cm', 'Centimetre'), choice('unit', 'u:m', 'Metre'), choice('unit', 'u:mm', 'Millimetre'),
      ])
      return searchParams.get('after') ? response([choice('parameter', 'p:stage', 'Water level')])
        : response([choice('parameter', 'p:rain', 'Rainfall'), choice('parameter', 'p:snow', 'Snow depth')], 'p:snow')
    })
    vi.stubGlobal('fetch', fetch)
    render(<TestMap client={new MetadataClient()} onOpen={vi.fn()} />)
    await screen.findByText('1 stations shown; 0 without coordinates.')
    expect(screen.getByRole('button', { name: 'Reload map' }).previousElementSibling)
      .toHaveTextContent('Last updated 2026-11-24T01:23:00.000Z')
    fireEvent.click(screen.getByText('Classify stations'))
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'value' } })
    await screen.findByRole('option', { name: 'Water level' })
    fireEvent.click(screen.getByRole('button', { name: 'Filter two parameters' }))
    expect(screen.getByRole('option', { name: 'Water level' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Rainfall' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Snow depth' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Parameter')).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: 'Filter water level by name' }))
    expect(screen.getByLabelText('Parameter')).toHaveValue('p:stage')
    expect(screen.queryByRole('option', { name: 'Rainfall' })).not.toBeInTheDocument()
    await screen.findByRole('option', { name: 'Metre (m)' })
    expect(screen.getByLabelText('Common unit')).toHaveValue('u:m')
    expect(fetch.mock.calls.some(([path]) => path.includes('/station-summaries'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByRole('option', { name: 'Snow depth' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Parameter'), { target: { value: 'p:stage' } })
    await screen.findByRole('option', { name: 'Metre (m)' })
    expect(screen.getByLabelText('Common unit')).toHaveValue('u:m')
    expect(screen.queryByRole('option', { name: 'Millimetre (mm)' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Common unit'), { target: { value: 'u:cm' } })
    expect(screen.getByLabelText('Common unit')).toHaveValue('u:cm')
    fireEvent.change(screen.getByLabelText('Parameter'), { target: { value: 'p:rain' } })
    expect(screen.getByLabelText('Common unit')).toHaveValue('u:mm')
    expect(screen.queryByRole('option', { name: 'Metre (m)' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Parameter'), { target: { value: 'p:stage' } })
    expect(screen.getByLabelText('Common unit')).toHaveValue('u:m')
    expect(screen.getByLabelText('Processing level')).toHaveValue('raw')
    for (const removed of [/statistic/i, /exact series name/i, /period definition/i]) {
      expect(screen.queryByLabelText(removed)).not.toBeInTheDocument()
    }
    expect(screen.getByLabelText('Not older than')).toHaveValue('off')
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    const marker = () => screen.getByRole('button', { name: 'Station A / A', hidden: true })
    await waitFor(() => expect(marker())
      .toHaveAttribute('aria-description', expect.stringContaining('≥ 0 and < 1 m')))
    const showValues = screen.getByRole('checkbox', { name: 'Show values on map' })
    const apply = screen.getByRole('button', { name: 'Apply' })
    expect(showValues).not.toBeChecked()
    expect(marker()).not.toHaveClass('has-value')
    const summaryReads = () => fetch.mock.calls.filter(([path]) => path.includes('/station-summaries')).length
    const readsBeforeToggle = summaryReads()
    fireEvent.click(showValues)
    fireEvent.click(apply)
    expect(marker()).toHaveClass('has-value')
    expect(marker()).toHaveTextContent(/^0$/)
    expect(marker()).toHaveAttribute('aria-description', expect.stringContaining('0 m'))
    fireEvent.click(showValues)
    fireEvent.click(apply)
    expect(marker()).not.toHaveClass('has-value')
    expect(marker()).not.toHaveTextContent('0')
    expect(summaryReads()).toBe(readsBeforeToggle)
    const legend = screen.getByRole('region', { name: 'Station classification legend' })
    const headers = within(legend).getAllByRole('columnheader')
    expect(headers.map((header) => header.textContent)).toEqual(['', '', 'Range', '#Stations'])
    for (const label of ['< 0 m', '≥ 1 m']) {
      expect(screen.getByLabelText(`Label for ${label}`).closest('tr')?.querySelector('.station-classification-count')).toHaveTextContent(/^0$/)
    }
    expect(legend).toHaveTextContent('No data0')
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'timestamp' } })
    const showAge = screen.getByRole('checkbox', { name: 'Show values on map' })
    expect(showAge).not.toBeChecked()
    fireEvent.click(showAge)
    fireEvent.click(apply)
    await waitFor(() => expect(marker()).toHaveTextContent(/^01:23$/))
    expect(marker()).toHaveClass('has-value')
    expect(marker()).toHaveAttribute('title', [
      'Station: Station A', 'Station ID: A', 'Classification: > 1 h to ≤ 24 h',
      'Series: interval', 'Latest timestamp: 2026-11-24T00:00:00Z',
    ].join('\n'))
    expect(within(legend).getAllByRole('checkbox').map((checkbox) => checkbox.getAttribute('aria-label'))).toEqual([
      'Show ≤ 1 h on map', 'Show > 1 h to ≤ 24 h on map', 'Show > 24 h on map',
      'Show No data on map',
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Select B' }))
    await screen.findByText('0 stations shown; 0 without coordinates.')
    expect(screen.getByLabelText('Label for > 1 h to ≤ 24 h').closest('tr')).toHaveTextContent('0')
  })

  it('classifies by provider without reading samples and keeps the color across filters', async () => {
    const fetch = vi.fn(async (path: string) => {
      const url = new URL(path, 'https://test')
      if (url.searchParams.get('collection') !== 'stations') return response([])
      if (url.searchParams.get('mode') === 'values') {
        expect(url.searchParams.get('filters')).toBe('[]')
        expect(url.searchParams.get('field')).toBe('station_provider')
        return url.searchParams.get('after') ? response([{ value: 'WSV', label: 'WSV' }])
          : response([{ value: 'DWD', label: 'DWD' }, { value: 'Other', label: 'Other' }], 'Other')
      }
      const a = station('A'), b = station('B')
      const rows = [
        { ...a, item: { ...a.item, station_provider: 'DWD' } },
        { ...b, item: { ...b.item, station_provider: 'WSV' } }, station('C'),
      ]
      return response(url.searchParams.get('filters')?.includes('"B"') ? [rows[1]] : rows)
    })
    vi.stubGlobal('fetch', fetch)
    render(<TestMap client={new MetadataClient()} onOpen={vi.fn()} />)
    const pin = (id: string) => screen.getByLabelText(`Station ${id} / ${id}`, { selector: 'button' })
    const color = (id: string) => pin(id).style.getPropertyValue('--station-pin-color')
    await screen.findByText('3 stations shown; 0 without coordinates.')
    fireEvent.click(screen.getByText('Classify stations'))
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'attribute' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(screen.getByText('Classify stations (active)', { selector: 'summary' })).toBeVisible()
    expect((await screen.findByLabelText('Label for Other')).closest('tr')).toHaveTextContent('0')
    expect(color('A')).not.toBe(color('B'))
    expect(pin('C')).toHaveAttribute('aria-description', expect.stringContaining('Not specified'))
    fireEvent.input(screen.getByLabelText('Color for WSV'), { target: { value: '#665544' } })
    await waitFor(() => expect(color('B')).toBe('#665544'))
    const showWSV = screen.getByRole('checkbox', { name: 'Show WSV on map' })
    expect(showWSV).toBeChecked()
    fireEvent.change(screen.getByLabelText('Station attribute'), { target: { value: 'station_owner' } })
    const settings = screen.getByRole('button', { name: 'Setting' })
    fireEvent.click(settings)
    expect(settings).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument()
    expect(showWSV).toBeVisible()
    expect(screen.getByRole('checkbox', { name: 'Show Other on map' })).toBeChecked()
    const readsBeforeToggle = fetch.mock.calls.length
    fireEvent.click(pin('B'))
    expect(screen.getByText('Open station details')).toBeInTheDocument()
    fireEvent.click(showWSV)
    expect(pin('B')).toHaveAttribute('hidden')
    expect(pin('A')).not.toHaveAttribute('hidden')
    expect(screen.queryByText('Open station details')).not.toBeInTheDocument()
    expect(showWSV.closest('tr')?.querySelector('.station-classification-count')).toHaveTextContent(/^1$/)
    expect(screen.getByText('2 stations shown; 0 without coordinates. 1 hidden by classification.')).toHaveRole('status')
    expect(fetch.mock.calls).toHaveLength(readsBeforeToggle)
    fireEvent.click(screen.getByRole('button', { name: 'Select B' }))
    await screen.findByText('0 stations shown; 0 without coordinates. 1 hidden by classification.')
    await waitFor(() => expect(pin('B')).toHaveAttribute('hidden'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show WSV on map' }))
    await screen.findByText('1 stations shown; 0 without coordinates.')
    expect(pin('B')).not.toHaveAttribute('hidden')
    expect(color('B')).toBe('#665544')
    fireEvent.click(settings)
    expect(settings).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('Station attribute')).toHaveValue('station_owner')
    expect(screen.getByLabelText('Label for DWD').closest('tr')).toHaveTextContent('0')
    expect(screen.getByText('Not specified').closest('tr')).toHaveTextContent('0')
    expect(fetch.mock.calls.every(([path]) => !path.includes('/station-summaries'))).toBe(true)
    expect(screen.queryByRole('button', { name: 'Turn off' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'off' } })
    expect(color('B')).not.toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(color('B')).toBe('')
    expect(screen.getByRole('button', { name: 'Station B / B', hidden: true }))
      .toHaveAttribute('title', 'Station: Station B\nStation ID: B')
  })

  it('shows the complete pin set together even when another page is still loading', async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    let requested!: () => void
    const secondPage = new Promise<void>((resolve) => { requested = resolve })
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      const query = new URL(path, 'https://test').searchParams
      if (query.get('collection') !== 'stations') return response([])
      if (!query.get('after')) return response([station('A')], 'A')
      requested()
      await pending
      return response([station('B')])
    }))
    render(<TestMap client={new MetadataClient()} onOpen={vi.fn()} />)
    await secondPage
    expect(screen.queryByRole('button', { name: 'Station A / A', hidden: true })).not.toBeInTheDocument()
    expect(screen.getByText('Loading stations...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download map' })).toBeDisabled()
    release()
    await screen.findByText('2 stations shown; 0 without coordinates.')
    expect(screen.getByRole('button', { name: 'Station A / A', hidden: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Station B / B', hidden: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download map' })).toBeEnabled()
  })

  it('exports all matching Stations as GeoJSON with longitude-first coordinates, null geometry, and exact metadata', async () => {
    const selection = { filters: [{ collection: 'stations' as const, field: 'station_id', values: ['A', 'B', 'C'] }], q: '', asOf: '' }
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      const query = new URL(path, 'https://test').searchParams
      expect(query.get('mode')).toBe('map_export')
      expect(query.get('read_cutoff')).toBe('fixed')
      if (query.get('after')) return response([station('B', 90, -180), station('C', null)])
      const first = station('A', 0, 0)
      first.item.station_metadata_version = '9223372036854775807'
      return response([first], 'A')
    }))
    const blob = await downloadMapGeoJson(new MetadataClient(), selection, 'fixed', new AbortController().signal)
    expect(blob.type).toBe('application/geo+json')
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(blob)
    })
    const result = JSON.parse(text)
    expect(result).toMatchObject({ type: 'FeatureCollection', read_cutoff: 'fixed', filters: selection.filters, coordinate_scope: 'current_only' })
    expect(result.features).toHaveLength(3)
    expect(result.features[0]).toMatchObject({
      type: 'Feature', id: 'A', geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { station_metadata_version: '9223372036854775807', station_name: 'Station A' },
    })
    expect(result.features[1].geometry).toEqual({ type: 'Point', coordinates: [-180, 90] })
    expect(result.features[2]).toMatchObject({ id: 'C', geometry: null })
  })

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
    expect(screen.getByRole('button', { name: 'Download map' })).toBeEnabled()
    // jsdom has no map viewport; browser tests verify visible overlays and sizing.
    expect(await screen.findByRole('button', { name: 'Station A / A', hidden: true })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Station C / C', hidden: true })).not.toBeInTheDocument()
    expect(requests.filter((url) => url.searchParams.get('collection') === 'stations')
      .every((url) => url.searchParams.get('read_cutoff') === 'fixed' && url.searchParams.get('mode') === 'map' &&
        url.searchParams.get('limit') === String(mapPageSize))).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Select B' }))
    await screen.findByText('1 stations shown; 0 without coordinates.')
    const selected = await screen.findByRole('button', { name: 'Station B / B', hidden: true })
    expect(screen.queryByRole('button', { name: 'Station A / A', hidden: true })).not.toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Download map' })).toBeDisabled()
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
