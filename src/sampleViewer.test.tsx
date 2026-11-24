import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { MetadataClient } from './metadata'
import type { DetailSelection } from './metadata'
import SampleViewer from './SampleViewer'
import SampleLegend from './SampleLegend'
import { useSampleViewer } from './useSampleViewer'
import { componentPlotPoints, intervalPlotPoints, occurrenceLabel, readScientificSamples, readSelectedSeries, sampleLimit, sampleValueLabel, timestampMicros, validateSampleQuery } from './sampleViewer'
import type { SampleLocation, SampleQuery, SampleResult } from './sampleViewer'
import { exportSelectedSamples } from './sampleExport'

vi.mock('./SampleChart', () => ({ default: ({ data, overlays, emptySeries, onSampleClick }: {
  data: SampleResult; overlays?: SampleResult[]; emptySeries?: readonly SampleResult['node'][]
  onSampleClick?: (location: SampleLocation) => void
}) => <><SampleLegend emptySeries={emptySeries} /><div role="img" aria-label="Scalar plot">{onSampleClick && <button onClick={() => {
  const sample = (overlays?.at(-1) ?? data).samples.at(-1)!
  onSampleClick({ seriesId: sample.definition.seriesId, micros: sample.micros })
}}>Click plotted sample</button>}</div></> }))
beforeEach(() => vi.stubGlobal('ResizeObserver', class {
  observe() {}
  disconnect() {}
}))
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

const selected: DetailSelection = { collection: 'series', id: 'A', version: '1', field: '', cutoff: 'fixed', asOf: '' }
const query: SampleQuery = { start: '2026-11-20T00:00:00Z', end: '2026-11-21T00:00:00Z', asOf: '' }
function original(id = 'A') {
  return {
    series_id: id, series_name: `Series ${id}`, series_description: 'River level observation', series_metadata_version: 1,
    series_value_shape: 'scalar', series_value_statistic: 'instantaneous', series_processing_level: 'raw',
    series_period_definition: null, series_timestamp_position: null,
    series_sampling_definition: { kind: 'equidistant' }, series_sampling_interval: 'PT1S',
    unit_id: 'm', unit_metadata_version: 9223372036854775807n,
    quality_codebook_id: 'quality', quality_codebook_metadata_version: 1,
    resolved_definitions: {
      unit: { unit_id: 'm', unit_metadata_version: 9223372036854775807n, unit_symbol: 'm' },
      quality_codebook: { quality_codebook_id: 'quality', quality_codebook_metadata_version: 1,
        quality_codebook_entries: [{ code: 255, meaning: 'Observed' }, { code: 0, meaning: 'No value' }] },
    },
    scientific_context: { processing: { inputs: [] } },
  }
}
function sample(timestamp: string, id = 'A', value: number | bigint | null = 1) {
  return {
    timestamp, revision_no: 1, series_metadata_version: 1,
    state: value === null ? 'missing' : 'valid', value, detection_bound: null,
    quality_code: value === null ? 0 : 255, quality_codebook_id: 'quality', quality_codebook_metadata_version: 1,
    period_start: null, period_end: null, occurrence: null,
    recorded_at: '2026-11-21T00:00:00.123456Z',
    recorded_by: id === 'A' ? 'aaaaaaaa-1111-4111-8111-111111111111' : 'bbbbbbbb-1111-4111-8111-111111111111',
    source: { record_id: 'provider', revision: 9223372036854775807n },
    interpretation: { original: original(id) },
  }
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, (_key, value: unknown) => typeof value === 'bigint' ? String(value) : value)
    .replaceAll('"9223372036854775807"', '9223372036854775807'), { status })
}
function metadata(id = 'A', cutoff = 'fixed', series: ReturnType<typeof original> & {
  series_sampling_alignment?: { origin: string }
} = original(id)) {
  return response({ items: [{ collection: 'series', item: {
    ...series, series_validity_start: '2026-11-20T00:00:00Z',
  }, references: [], position_scope: 'unavailable', status: 'active' }], next_after: null, read_cutoff: cutoff })
}
function page(items: unknown[], next: string | null = null, id = 'A', cutoff = 'fixed') {
  return response({ items, next_after: next, read_cutoff: cutoff, series_id: id,
    start: query.start, end: query.end, selection: 'primary' })
}
function Harness({ expired = vi.fn(), openSampleData }: { expired?: () => void; openSampleData?: () => void }) {
  const [client] = useState(() => new MetadataClient())
  const viewer = useSampleViewer(client, expired)
  return <>
    <button onClick={() => viewer.select(selected)}>Select A</button>
    <button onClick={() => viewer.select({ ...selected, id: 'B' })}>Select B</button>
    <button onClick={() => viewer.selectMany([selected, { ...selected, id: 'B' }])}>Select A and B</button>
    <button onClick={viewer.clear}>Close viewer</button>
    <button onClick={() => viewer.edit({ ...viewer.query, asOf: '2026-11-20T12:00:00Z' })}>Set historical context</button>
    <button onClick={() => void viewer.load()}>Read at retained cutoff</button>
    <SampleViewer viewer={viewer} mode="chart" openSampleData={openSampleData} />
    <SampleViewer viewer={viewer} mode="data" />
  </>
}
function fillQuery(panel = 'Time series graph') {
  const viewer = within(screen.getByRole('article', { name: panel }))
  fireEvent.change(viewer.getByLabelText('Start UTC (inclusive)'), { target: { value: query.start } })
  fireEvent.change(viewer.getByLabelText('End UTC (exclusive)'), { target: { value: query.end } })
  return viewer
}

describe('instantaneous scalar sample contracts', () => {
  it('pins all selected series to one cutoff and exports exact values to CSV and JSON', async () => {
    const requests: URL[] = []
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      const url = new URL(path, 'https://test'); requests.push(url)
      const id = url.searchParams.get('id')
      if (id) return metadata(id)
      const series = url.pathname.split('/')[4]!
      return page([sample(query.start, series, series === 'A' ? -1.25 : 9223372036854775807n)], null, series)
    }))
    const { signal } = new AbortController()
    const datasets = await readSelectedSeries(new MetadataClient(), [selected, { ...selected, id: 'B' }], query, signal)
    expect(requests.map((url) => url.searchParams.get('read_cutoff'))).toEqual([null, 'fixed', 'fixed', 'fixed'])
    const csv = await exportSelectedSamples(datasets, 'csv', signal)
    expect(await csv.text()).toContain(`"A","${query.start}","-1.25","valid"`)
    expect(await csv.text()).toContain(`"B","${query.start}","9223372036854775807","valid"`)
    const json = await exportSelectedSamples(datasets, 'json', signal)
    expect(JSON.parse(await json.text())).toMatchObject({
      read_context: { read_cutoff: 'fixed', series: [{ id: 'A', count: 1 }, { id: 'B', count: 1 }] },
      samples: [{ value: '-1.25', timestamp: query.start }, { value: '9223372036854775807', qualityMeaning: 'Observed' }],
    })
  })

  it('rejects a selection when the second series exceeds the shared row limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      const url = new URL(path, 'https://test')
      const id = url.searchParams.get('id')
      if (id) return metadata(id)
      const series = url.pathname.split('/')[4]!
      const start = Date.parse(query.start)
      const offset = url.searchParams.has('after') ? (Date.parse(url.searchParams.get('after')!) - start) / 1000 + 1 : 0
      const count = series === 'A' ? sampleLimit - 1 : 2
      const rows = Array.from({ length: Math.min(100, count - offset) }, (_, i) =>
        sample(new Date(start + (offset + i) * 1000).toISOString(), series))
      return page(rows, offset + rows.length < count ? rows.at(-1)!.timestamp : null, series)
    }))
    await expect(readSelectedSeries(new MetadataClient(), [selected, { ...selected, id: 'B' }], query,
      new AbortController().signal)).rejects.toThrow('20,000 samples')
  })

  it('compares microsecond timestamps exactly, honors offset instants, and rejects invalid UTC ranges', () => {
    expect(timestampMicros('2026-11-20T00:00:00.000001Z') - timestampMicros(query.start)).toBe(1n)
    expect(timestampMicros('2026-11-20T01:00:00.000001+01:00')).toBe(timestampMicros('2026-11-20T00:00:00.000001Z'))
    expect(() => validateSampleQuery({ ...query, end: query.start })).toThrow('End must be after start')
    expect(() => validateSampleQuery({ ...query, start: '2026-02-30T00:00:00Z' })).toThrow('invalid calendar date')
    expect(() => validateSampleQuery({ ...query, start: '2026-11-20T00:00:60Z' })).toThrow()
    expect(() => validateSampleQuery({ ...query, start: '2026-11-20T01:00:00+01:00' })).toThrow('UTC')
  })

  it('reads all bounded pages at one cutoff and preserves exact pins, zero, missingness, and cadence gaps', async () => {
    const requests: URL[] = []
    const first = sample('2026-11-20T00:00:00.000001Z', 'A', 0)
    const missing = sample('2026-11-20T00:00:01.000001Z', 'A', null)
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      const url = new URL(path, 'https://test'); requests.push(url)
      return url.pathname.startsWith('/api/v1/metadata/') ? metadata()
        : url.searchParams.has('after') ? page([sample('2026-11-20T00:00:04.000001Z')])
          : page([first, missing], missing.timestamp)
    }))
    const result = await readScientificSamples(new MetadataClient(), selected, query, new AbortController().signal, 'fixed')
    expect(result.samples).toHaveLength(3)
    expect(result.samples[0]).toMatchObject({ value: 0, qualityMeaning: 'Observed', definition: { unitVersion: '9223372036854775807' } })
    expect(result.samples[0]!.source).toMatchObject({ revision: 9223372036854775807n })
    expect(result.samples[1]!.value).toBeNull()
    expect(componentPlotPoints(result.samples, 0, result.chartDefinition?.intervalMicros).map((point) => point.value[1])).toEqual([0, null, null, 1])
    expect(result.samples[0]!.timestamp).toBe(first.timestamp)
    expect(requests.every((url) => url.searchParams.get('read_cutoff') === 'fixed')).toBe(true)
    expect(requests.slice(1).every((url) => url.searchParams.get('interpretation') === 'original' && url.searchParams.get('limit') === '100')).toBe(true)
  })

  it('preserves one vector extremum with actual 25-hour support, a shared occurrence and aggregate evidence', async () => {
    const timestamp = query.start
    const periodStart = '2026-11-18T23:00:00Z'
    const occurrence = '2026-11-19T08:00:00.000001Z'
    const item = {
      ...sample(timestamp), revision_no: 2, value: [0, 1, -2], period_start: periodStart, period_end: timestamp,
      occurrence,
      coverage: 0.75, usable_count: 18, expected_count: 24, status: 'partial', stale: true,
      interpretation: { original: { ...original(), series_value_shape: 'vector3', series_value_statistic: 'maximum',
        series_processing_level: 'aggregated', series_timestamp_position: 'end',
        series_period_definition: { kind: 'calendar', method: { kind: 'component_wise' } },
        series_calendar_definition: { time_zone: 'Europe/Berlin' },
        scientific_context: { vector: { reference_frame: 'ENU', axes: [
          { axis: 'x', meaning: 'East' }, { axis: 'y', meaning: 'North' }, { axis: 'z', meaning: 'Up' },
        ] }, processing: { inputs: [{ series_id: 'source', series_metadata_version: 1 }] } },
      } },
    }
    vi.stubGlobal('fetch', vi.fn(async (path: string) => path.includes('/metadata/') ? metadata() : page([item])))
    const result = await readScientificSamples(new MetadataClient(), selected, query, new AbortController().signal, 'fixed')
    expect(result.samples).toHaveLength(1)
    const [row] = result.samples
    expect(row).toMatchObject({ value: [0, 1, -2], qualityMeaning: 'Observed', definition: { frame: 'ENU', level: 'aggregated', position: 'end' },
      aggregate: { coverage: 0.75, usable_count: 18, expected_count: 24, status: 'partial', stale: true } })
    expect(occurrenceLabel(row!)).toBe(occurrence)
    expect(intervalPlotPoints(result.samples, 2)).toEqual([{ sampleIndex: 0, value: [Date.parse(periodStart), Date.parse(timestamp), -2] }])
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Select A' }))
    const chart = fillQuery()
    fireEvent.click(chart.getByRole('button', { name: 'Reload samples' }))
    const data = within(screen.getByRole('article', { name: 'Time series data' }))
    const revision = await data.findByRole('cell', { name: '2' })
    expect(revision).toHaveAttribute('title', expect.stringContaining('Sample revision 2 / Series v1'))
    expect(revision).toHaveAttribute('title', expect.stringContaining('Frame: ENU; x: East; y: North; z: Up'))
    expect(revision).toHaveAttribute('title', expect.stringMatching(/Source and lineage[\s\S]*"series_id": "source"[\s\S]*"series_metadata_version": 1/))
    expect(revision).toHaveAttribute('title', expect.stringMatching(/Reported aggregate evidence[\s\S]*"coverage": 0\.75[\s\S]*"usable_count": 18[\s\S]*"expected_count": 24[\s\S]*"status": "partial"[\s\S]*"stale": true/))
    vi.stubGlobal('fetch', vi.fn(async (path: string) => path.includes('/metadata/') ? metadata()
      : page([{ ...item, period_start: undefined, period_end: undefined }])))
    const labels = await readScientificSamples(new MetadataClient(), selected, query, new AbortController().signal, 'fixed')
    expect(labels.samples[0]?.period).toBeUndefined()
    expect(occurrenceLabel(labels.samples[0]!)).toBe(occurrence)
    item.occurrence = timestamp
    await expect(readScientificSamples(new MetadataClient(), selected, query, new AbortController().signal, 'fixed')).rejects.toThrow('outside the represented period')
  })

  it('derives fixed measurement bounds from the period duration and timestamp position', async () => {
    const item = {
      ...sample(query.start),
      interpretation: { original: { ...original(), series_value_statistic: 'average', series_timestamp_position: 'end',
        series_sampling_interval: 'PT5M', series_period_definition: { kind: 'fixed', duration: 'PT3600S' } } },
    }
    vi.stubGlobal('fetch', vi.fn(async (path: string) => path.includes('/metadata/') ? metadata() : page([item])))
    const result = await readScientificSamples(new MetadataClient(), selected, query, new AbortController().signal, 'fixed')
    const label = timestampMicros(query.start)
    expect(result.samples[0]?.period).toMatchObject({ startMicros: label - 3_600_000_000n, endMicros: label })
  })

  it('retains censored and rejected results, unsafe integers and exact decimals without plotting guessed values', async () => {
    const censored = { ...sample(query.start, 'A', 0), state: 'censored_below', detection_bound: 0.25 }
    const rejected = { ...sample('2026-11-20T00:00:01Z'), state: 'rejected' }
    const large = sample('2026-11-20T00:00:02Z', 'A', 9223372036854775807n)
    const decimal = sample('2026-11-20T00:00:03Z', 'A', 0.123)
    vi.stubGlobal('fetch', vi.fn(async (path: string) => path.includes('/metadata/') ? metadata()
      : new Response((await page([censored, rejected, large, decimal]).text()).replace('"value":0.123', '"value":0.1234567890123456789'))))
    const result = await readScientificSamples(new MetadataClient(), selected, query, new AbortController().signal, 'fixed')
    expect(result.samples.map((sample) => sampleValueLabel(sample))).toEqual(['< 0.25 (detection bound); reported: 0', '1', '9223372036854775807', '0.1234567890123456789'])
    expect(componentPlotPoints(result.samples, 0).map(({ value }) => value[1])).toEqual([null, null, null, null])
  })

  it('uses the one current cadence for older samples and leaves a gap at a missing minute', async () => {
    const requests: URL[] = []
    const previous = { ...original(), series_sampling_definition: { kind: 'unknown' } }
    const current = { ...original(), series_metadata_version: 2, series_sampling_interval: 'PT60S' }
    const rows = [query.start, '2026-11-20T00:01:00Z', '2026-11-20T00:03:00Z'].map((timestamp) =>
      ({ ...sample(timestamp), interpretation: { original: previous } }))
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      const url = new URL(path, 'https://test'); requests.push(url)
      const cutoff = url.searchParams.get('read_cutoff')!
      if (url.pathname.endsWith('/interpretation')) {
        return response({ original: { ...current, series_sampling_interval: 60 }, read_cutoff: 'fixed' })
      }
      if (url.pathname.endsWith('/browser')) return metadata('A', cutoff, cutoff === 'fixed' ? current : previous)
      return page(rows, null, 'A', cutoff)
    }))
    const result = await readScientificSamples(new MetadataClient(), selected, query, new AbortController().signal, 'fixed')
    expect(result.chartDefinition).toMatchObject({ version: '2', sampling: 'equidistant', interval: 'PT60S' })
    expect(result.samples.map(({ definition }) => definition.sampling)).toEqual(['unknown', 'unknown', 'unknown'])
    expect(componentPlotPoints(result.samples, 0, result.chartDefinition?.intervalMicros).map(({ sampleIndex }) => sampleIndex))
      .toEqual([0, 1, -1, 2])
    expect(requests.at(-1)?.searchParams.get('series_metadata_version')).toBe('2')
    expect(requests.every((url) => url.searchParams.get('read_cutoff') === 'fixed')).toBe(true)
    const historical = await readScientificSamples(new MetadataClient(), selected, query, new AbortController().signal, 'before')
    expect(historical.chartDefinition).toMatchObject({ version: '1', sampling: 'unknown' })
    expect(historical.chartDefinition?.intervalMicros).toBeUndefined()
    expect(requests.filter((url) => url.pathname.endsWith('/interpretation'))).toHaveLength(1)
  })

  it.each(['cutoff', 'cursor', 'end'])('rejects %s mismatches instead of producing a partial chart', async (kind) => {
    const item = sample(query.start)
    vi.stubGlobal('fetch', vi.fn(async (path: string) => path.includes('/metadata/') ? metadata() : kind === 'cutoff'
      ? page([item], null, 'A', 'changed') : kind === 'cursor' ? page([], query.start)
        : page([sample(query.end)])))
    await expect(readScientificSamples(new MetadataClient(), selected, query, new AbortController().signal, 'fixed')).rejects.toThrow()
  })

  it('allows 256 MiB of cumulative sample responses but rejects one byte more', async () => {
    const body = await page([]).text()
    const bytesAtLimit = 256 * 1024 * 1024
    const accumulated = bytesAtLimit - new TextEncoder().encode(body).byteLength
    vi.stubGlobal('fetch', vi.fn(async (path: string) => path.includes('/metadata/') ? metadata() : new Response(body)))
    const client = new MetadataClient()
    const { signal } = new AbortController()
    await expect(readScientificSamples(client, selected, query, signal, 'fixed', undefined, { bytes: accumulated, rows: 0 }))
      .resolves.toMatchObject({ samples: [] })
    await expect(readScientificSamples(client, selected, query, signal, 'fixed', undefined, { bytes: accumulated + 1, rows: 0 }))
      .rejects.toThrow('Sample reads exceed the 256 MiB viewer limit.')
  })

  it.each([2_001, 20_000, 20_001])('loads the complete range up to the new limit (%i available samples)', async (count) => {
    let offset = 0
    const first = Date.parse(query.start) + 3_600_000
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path.includes('/metadata/')) return metadata()
      const items = Array.from({ length: Math.min(100, count - offset) }, () => sample(new Date(first + offset++ * 1000).toISOString()))
      return page(items, offset < count ? items.at(-1)!.timestamp : null)
    }))
    const result = readScientificSamples(new MetadataClient(), selected, query, new AbortController().signal, 'fixed')
    if (count > 20_000) {
      await expect(result).rejects.toThrow('The range contains more than 20,000 samples')
      expect(offset).toBe(20_000)
    } else {
      const loaded = await result
      expect(loaded.query).toEqual(query)
      expect(loaded.samples).toHaveLength(count)
      expect(loaded.samples[0]?.timestamp).toBe(new Date(first).toISOString())
      expect(loaded.samples.at(-1)?.timestamp).toBe(new Date(first + (count - 1) * 1000).toISOString())
    }
  })
})

describe('sample viewer workflow', () => {
  it('keeps the graph and its table mounted until a complete reload is ready', async () => {
    vi.setSystemTime(new Date(query.end))
    let finishCatalog: ((result: Response) => void) | undefined
    let finishSamples: ((result: Response) => void) | undefined
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      const { pathname, searchParams } = new URL(path, 'https://test')
      if (pathname.endsWith('/browser')) return searchParams.has('read_cutoff') ? metadata()
        : new Promise<Response>((resolve) => { finishCatalog = resolve })
      if (searchParams.get('read_cutoff') === 'fixed') return page([sample(query.start, 'A', 11)])
      return new Promise<Response>((resolve) => { finishSamples = resolve })
    }))
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Select A' }))
    const chart = within(screen.getByRole('article', { name: 'Time series graph' }))
    const reload = chart.getByRole('button', { name: 'Reload samples' })
    const plot = await chart.findByRole('img', { name: 'Scalar plot' })
    const table = await screen.findByRole('table')
    expect(table).toHaveTextContent('11 m')
    fireEvent.click(reload)
    await waitFor(() => expect(finishCatalog).toBeDefined())
    expect(chart.getByRole('img', { name: 'Scalar plot' })).toBe(plot)
    expect(screen.getByRole('table')).toBe(table)
    await act(async () => finishCatalog?.(metadata('A', 'new-cutoff')))
    await waitFor(() => expect(finishSamples).toBeDefined())
    expect(reload).toBeDisabled()
    expect(chart.getByRole('img', { name: 'Scalar plot' })).toBe(plot)
    expect(screen.getByRole('table')).toBe(table)
    expect(table).toHaveTextContent('11 m')
    await act(async () => finishSamples?.(page([sample(query.start, 'A', 22)], null, 'A', 'new-cutoff')))
    expect(reload).toBeEnabled()
    expect(chart.getByRole('img', { name: 'Scalar plot' })).toBe(plot)
    expect(screen.getByRole('table')).toHaveTextContent('22 m')
    expect(screen.getByRole('table')).not.toHaveTextContent('11 m')
  })

  it('updates the graph refresh timestamp only after a successful read', async () => {
    const first = '2026-11-24T12:00:00.000Z'
    const next = '2026-11-24T12:05:00.000Z'
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(first))
    let fail = false
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path.includes('/metadata/')) return metadata()
      const { searchParams } = new URL(path, 'https://test')
      return fail ? new Response(null, { status: 500 }) : response({
        items: [], next_after: null, read_cutoff: 'fixed', series_id: 'A', selection: 'primary',
        start: searchParams.get('start'), end: searchParams.get('end'),
      })
    }))
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Select A' }))
    const chart = within(screen.getByRole('article', { name: 'Time series graph' }))
    const reload = chart.getByRole('button', { name: 'Reload samples' })
    await chart.findByText(first)
    expect(reload.previousElementSibling).toHaveTextContent(`Last updated ${first}`)
    clock.mockReturnValue(Date.parse(next))
    fail = true
    fireEvent.click(reload)
    await chart.findByRole('alert')
    expect(reload.previousElementSibling).toHaveTextContent(`Last updated ${first}`)
    fail = false
    fireEvent.click(reload)
    await chart.findByText(next)
    expect(reload.previousElementSibling).toHaveTextContent(`Last updated ${next}`)
  })

  it('loads on open and reloads each preset range without changing as-of', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(query.end))
    const requests: URL[] = []
    const fetch = vi.fn(async (path: string) => {
      const url = new URL(path, 'https://test'); requests.push(url)
      if (path.includes('/metadata/')) return metadata()
      return response({ items: [], next_after: null, read_cutoff: 'fixed', series_id: 'A',
        start: url.searchParams.get('start'), end: url.searchParams.get('end'), selection: 'primary' })
    })
    vi.stubGlobal('fetch', fetch)
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Select A' }))
    const chart = within(screen.getByRole('article', { name: 'Time series graph' }))
    await chart.findByText('No samples in the requested UTC range.')
    expect(requests.at(-1)?.searchParams.get('start')).toBe('2026-11-20T00:00:00.000Z')
    expect(requests.at(-1)?.searchParams.get('end')).toBe('2026-11-21T00:00:00.000Z')
    fireEvent.click(screen.getByRole('button', { name: 'Set historical context' }))
    for (const [label, end, start] of [
      ['Moving month', '2026-11-01T12:34:56.789Z', '2026-10-02T12:34:56.789Z'],
      ['Moving week', '2026-11-02T12:34:56.789Z', '2026-10-26T12:34:56.789Z'],
      ['Moving day', '2026-11-03T12:34:56.789Z', '2026-11-02T12:34:56.789Z'],
    ] as const) {
      vi.setSystemTime(new Date(end))
      fireEvent.click(chart.getByRole('button', { name: label }))
      expect(chart.getByLabelText('Start UTC (inclusive)')).toHaveValue(start)
      expect(chart.getByLabelText('End UTC (exclusive)')).toHaveValue(end)
      await chart.findByText('No samples in the requested UTC range.')
      expect(requests.at(-1)?.searchParams.get('start')).toBe(start)
      expect(requests.at(-1)?.searchParams.get('end')).toBe(end)
    }
    const input = chart.getByLabelText('Start UTC (inclusive)')
    fireEvent.change(input, { target: { value: '2026-11-02T00:00:00Z' } })
    expect(requests.at(-1)?.searchParams.get('start')).toBe('2026-11-02T12:34:56.789Z')
    fireEvent.blur(input)
    await chart.findByText('No samples in the requested UTC range.')
    expect(requests.at(-1)?.searchParams.get('start')).toBe('2026-11-02T00:00:00Z')
  })

  it.each([true, false])('lists empty overlay series only inside the legend (with plot: %s)', async (withPlot) => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      const url = new URL(path, 'https://test')
      const id = url.searchParams.get('id')
      if (id) return metadata(id)
      const series = url.pathname.split('/')[4]!
      return page(withPlot && series === 'A' ? [sample(query.start, series)] : [], null, series)
    }))
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Select A and B' }))
    const chart = fillQuery()
    fireEvent.click(chart.getByRole('button', { name: 'Reload samples' }))

    const summary = await chart.findByText('Time series legend')
    const legend = summary.closest('details')!
    expect(legend).toHaveAttribute('open')
    expect(within(legend).getAllByRole('status').map((entry) => entry.textContent)).toEqual(
      (withPlot ? ['B'] : ['A', 'B']).map((id) => `Series ${id} (${id}): No samples in the requested UTC range.`),
    )
    expect(chart.getAllByText('No samples in the requested UTC range.')).toEqual(
      within(legend).getAllByText('No samples in the requested UTC range.'),
    )
    expect(Boolean(chart.queryByRole('img', { name: 'Scalar plot' }))).toBe(withPlot)
  })

  it('does not fall back to the old cutoff when refresh fails before resolving a new view', async () => {
    const requests: URL[] = []
    let fail = true
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      requests.push(new URL(path, 'https://test'))
      if (path.includes('/metadata/')) return fail
        ? response({ code: 'DEPENDENCY_UNAVAILABLE', message: 'Unavailable', request_id: null }, 503)
        : metadata('A', 'new-cutoff')
      return page([sample(query.start)], null, 'A', 'new-cutoff')
    }))
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Select A' }))
    const chart = fillQuery()
    fireEvent.click(chart.getByRole('button', { name: 'Reload samples' }))
    await chart.findByRole('alert')
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Read at retained cutoff' }))
    await screen.findByRole('table')
    expect(requests.slice(1, 3).every((url) => !url.searchParams.has('read_cutoff'))).toBe(true)
    expect(requests[3]!.searchParams.get('read_cutoff')).toBe('new-cutoff')
  })

  it('reuses a freshly resolved cutoff on retry after a sample read fails', async () => {
    const requests: URL[] = []
    let fail = true
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      requests.push(new URL(path, 'https://test'))
      return path.includes('/metadata/') ? metadata('A', 'fresh-cutoff')
        : fail ? response({ code: 'DEPENDENCY_UNAVAILABLE', message: 'Unavailable', request_id: null }, 503)
          : page([sample(query.start)], null, 'A', 'fresh-cutoff')
    }))
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Select A' }))
    const chart = fillQuery()
    fireEvent.click(chart.getByRole('button', { name: 'Reload samples' }))
    await chart.findByRole('alert')
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Read at retained cutoff' }))
    await screen.findByRole('table')
    expect(requests.filter((url) => url.pathname.includes('/metadata/'))).toHaveLength(2)
    expect(requests.filter((url) => url.pathname.includes('/samples'))
      .map((url) => url.searchParams.get('read_cutoff'))).toEqual(['fresh-cutoff', 'fresh-cutoff'])
  })

  it('expires the workspace on a sample 401 rather than showing empty data', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => path.includes('/metadata/') ? metadata()
      : response({ code: 'AUTHENTICATION_REQUIRED', message: 'Expired', request_id: null }, 401)))
    const expired = vi.fn()
    render(<Harness expired={expired} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select A' }))
    const chart = fillQuery()
    fireEvent.click(chart.getByRole('button', { name: 'Reload samples' }))
    await waitFor(() => expect(expired).toHaveBeenCalledOnce())
    expect(chart.getByRole('alert')).toHaveTextContent('session has expired')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shares loaded queries between chart/data and paginates without fetching again', async () => {
    const fetch = vi.fn(async (path: string) => path.includes('/metadata/') ? metadata()
      : page(Array.from({ length: 26 }, (_, index) => sample(new Date(Date.parse(query.start) + index * 1000).toISOString()))))
    vi.stubGlobal('fetch', fetch)
    render(<Harness />)
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Select A' }))
    const chart = fillQuery()
    expect(chart.getByRole('group', { name: 'View period' })).toHaveTextContent('View period')
    expect(chart.queryByLabelText(/As-of UTC/)).not.toBeInTheDocument()
    expect(chart.getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent))
      .toEqual(['Moving month', 'Moving week', 'Moving day', 'Reload samples'])
    fireEvent.click(chart.getByRole('button', { name: 'Reload samples' }))
    await screen.findByRole('img', { name: 'Scalar plot' })
    expect(chart.getByRole('figure')).toHaveAccessibleName('Series A — River level observation')
    expect(chart.queryByText('Sample read context')).not.toBeInTheDocument()
    const panel = screen.getByRole('article', { name: 'Time series data' })
    const data = within(panel)
    const table = await data.findByRole('table')
    expect(data.getByLabelText('Data series')).toHaveValue('A')
    expect(Array.from(panel.children, (element) => element.tagName)).toEqual(['DIV', 'NAV', 'DIV'])
    expect(data.getByLabelText('Rows per page')).toHaveValue('25')
    expect(table.querySelectorAll('tbody tr')).toHaveLength(25)
    const quality = within(table.querySelector('tbody tr')!).getByRole('cell', { name: '255' })
    expect(quality).toHaveAttribute('title', 'Observed\nquality / v1')
    const revisionHeader = within(table).getByRole('columnheader', { name: 'Revision' })
    const revisionIndex = Array.from(revisionHeader.parentElement!.children).indexOf(revisionHeader)
    const revision = table.querySelector('tbody tr')!.children[revisionIndex]
    expect(revision).toHaveTextContent(/^1$/)
    expect(revision).toHaveAttribute('title', expect.stringContaining('Sample revision 1 / Series v1'))
    fireEvent.click(data.getByRole('button', { name: 'Next page' }))
    expect(table.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(table).toHaveTextContent('2026-11-20T00:00:25.000Z')
    expect(data.queryByRole('columnheader', { name: /Unit/ })).not.toBeInTheDocument()
    expect(within(table).getByRole('cell', { name: '1 m' })).toHaveAttribute('title', 'm / m / v9223372036854775807')
    const timestamp = data.getByRole('button', { name: 'Timestamp (UTC)' })
    fireEvent.click(timestamp)
    fireEvent.click(timestamp)
    expect(data.getByRole('columnheader', { name: 'Timestamp (UTC)' })).toHaveAttribute('aria-sort', 'descending')
    expect(table.querySelector('tbody tr')).toHaveTextContent('2026-11-20T00:00:25.000Z')
    fireEvent.click(data.getByRole('button', { name: 'Columns' }))
    expect(data.getByLabelText('Timestamp (UTC)', { selector: 'input' })).toBeDisabled()
    for (const label of ['Occurrence time (UTC)', 'Recorded by', 'Recorded at (UTC)']) {
      expect(data.queryByRole('columnheader', { name: label })).not.toBeInTheDocument()
      const option = data.getByLabelText(label, { selector: 'input' })
      expect(option).not.toBeChecked()
      fireEvent.click(option)
      expect(data.getByRole('columnheader', { name: label })).toBeInTheDocument()
    }
    fireEvent.click(data.getByLabelText('State', { selector: 'input' }))
    fireEvent.click(data.getByRole('button', { name: 'Next page' }))
    expect(table.querySelector('tbody tr')).toHaveTextContent('2026-11-20T00:00:00.000Z')
    expect(table.querySelector('tbody tr')).toHaveTextContent('2026-11-21T00:00:00.123456Z')
    expect(table.querySelector('tbody tr')).toHaveTextContent('aaaaaaaa-1111-4111-8111-111111111111')
    expect(data.queryByRole('columnheader', { name: 'State' })).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(3)
    fireEvent.change(chart.getByLabelText('End UTC (exclusive)'), { target: { value: query.start } })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    fireEvent.click(chart.getByRole('button', { name: 'Reload samples' }))
    expect(chart.getByRole('alert')).toHaveTextContent('End must be after start')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it.each([
    ['00:00', '09:40', '09:44', '09:50'],
    ['00:04', '09:44', '09:50', '09:54'],
  ])('uses the declared UTC grid origin at %s to classify absent samples', async (origin, missing, off, on) => {
    const timestamp = (time: string) => `2026-11-20T${time}:00Z`
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      const url = new URL(path, 'https://test')
      const id = url.searchParams.get('id')
      if (id) return metadata(id, 'fixed', {
        ...original(id), series_sampling_interval: id === 'A' ? 'PT1M' : 'PT10M',
        series_sampling_alignment: { origin: `1970-01-01T${id === 'A' ? '00:00' : origin}:00Z` },
      })
      return url.pathname.includes('/A/') ? page([
        sample(timestamp(missing), 'A'),
        sample(timestamp(off), 'A'),
        sample(timestamp(on), 'A'),
      ]) : page([sample(timestamp(missing), 'B', null)], null, 'B')
    }))
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Select A and B' }))
    const chart = fillQuery()
    fireEvent.click(chart.getByRole('button', { name: 'Reload samples' }))
    const data = within(screen.getByRole('article', { name: 'Time series data' }))
    await data.findByRole('table')
    fireEvent.change(data.getByLabelText('Table mode'), { target: { value: 'aligned' } })

    const row = (time: string) => within(data.getByRole('rowheader', { name: timestamp(time) }).closest('tr')!)
    expect(row(missing).getByRole('cell', { name: 'Missing' })).not.toHaveClass('sample-not-expected')
    const offGrid = row(off).getByRole('cell', { name: 'No sample expected' })
    expect(offGrid).toHaveClass('sample-not-expected')
    expect(offGrid.querySelector('[aria-hidden]')).toBeNull()
    const onGrid = row(on).getByRole('cell', { name: 'Expected sample unavailable' })
    expect(onGrid).not.toHaveClass('sample-not-expected')
    expect(onGrid.querySelector('[aria-hidden="true"]')).toHaveTextContent('-')
    expect(data.queryByRole('columnheader', { name: 'Series B: Recorded by' })).not.toBeInTheDocument()
    fireEvent.click(data.getByRole('button', { name: 'Columns' }))
    fireEvent.click(data.getByLabelText('Series B: Recorded by', { selector: 'input' }))
    expect(row(missing).getByRole('cell', { name: 'bbbbbbbb-1111-4111-8111-111111111111' })).toBeInTheDocument()
    expect(row(off).queryByText('bbbbbbbb-1111-4111-8111-111111111111')).not.toBeInTheDocument()
  })

  it('opens the clicked sample’s page in either table mode without rereading', async () => {
    const time = '2026-11-20T00:00:24.000002Z'
    const fetch = vi.fn(async (path: string) => {
      const url = new URL(path, 'https://test')
      const id = url.searchParams.get('id')
      if (id) return metadata(id)
      const series = url.pathname.split('/')[4]!
      return page([
        ...Array.from({ length: 25 }, (_, index) => sample(`2026-11-20T00:00:${String(index).padStart(2, '0')}.000001Z`, series)),
        ...(series === 'B' ? [sample(time, 'B')] : []),
      ], null, series)
    })
    const openSampleData = vi.fn()
    vi.stubGlobal('fetch', fetch)
    render(<Harness openSampleData={openSampleData} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select A and B' }))
    const chart = fillQuery()
    fireEvent.click(chart.getByRole('button', { name: 'Reload samples' }))
    const click = await chart.findByRole('button', { name: 'Click plotted sample' })
    const data = within(screen.getByRole('article', { name: 'Time series data' }))
    const reads = fetch.mock.calls.length
    fireEvent.change(data.getByLabelText('Rows per page'), { target: { value: '10' } })
    fireEvent.click(click)
    expect(openSampleData).toHaveBeenCalledTimes(1)
    expect(data.getByLabelText('Data series')).toHaveValue('B')
    expect(data.getByRole('status')).toHaveTextContent('Page 3 / 3')
    const highlighted = () => data.getByRole('row', { current: true })
    expect(highlighted()).toHaveTextContent(time)
    fireEvent.change(data.getByLabelText('Table mode'), { target: { value: 'aligned' } })
    const sort = data.getByRole('button', { name: 'Timestamp (UTC)' })
    fireEvent.click(sort)
    fireEvent.click(sort)
    fireEvent.click(data.getByRole('button', { name: 'Last page' }))
    fireEvent.click(click)
    expect(data.getByLabelText('Table mode')).toHaveValue('aligned')
    expect(data.getByRole('status')).toHaveTextContent('Page 1 / 2')
    expect(within(highlighted()).getByRole('rowheader')).toHaveTextContent(time)
    expect(data.getByRole('columnheader', { name: 'Timestamp (UTC)' })).toHaveAttribute('aria-sort', 'descending')
    expect(fetch).toHaveBeenCalledTimes(reads)
  })

  it('switches between single-series and exact UTC alignment without rereading samples', async () => {
    const fetch = vi.fn(async (path: string) => {
      const url = new URL(path, 'https://test')
      const id = url.searchParams.get('id')
      if (id) return metadata(id)
      const series = url.pathname.split('/')[4]!
      return series === 'A' ? page([
        sample('2026-11-20T00:00:00.000001Z', 'A', 0),
        ...Array.from({ length: 24 }, (_, index) => sample(`2026-11-20T00:00:${String(index + 1).padStart(2, '0')}Z`)),
      ]) : page([
        sample('2026-11-20T01:00:00.000001+01:00', 'B', 9223372036854775807n),
        sample('2026-11-20T01:00:00.000002+01:00', 'B', null),
      ], null, 'B')
    })
    vi.stubGlobal('fetch', fetch)
    render(<Harness />)
    const data = within(screen.getByRole('article', { name: 'Time series data' }))
    expect(data.getByRole('option', { name: 'Aligned series' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Select A and B' }))
    const chart = fillQuery()
    fireEvent.click(chart.getByRole('button', { name: 'Reload samples' }))
    await data.findByRole('table')
    const mode = data.getByLabelText('Table mode')
    expect(mode).toHaveValue('single')
    const reads = fetch.mock.calls.length
    mode.focus()
    fireEvent.change(mode, { target: { value: 'aligned' } })
    expect(mode).toHaveFocus()
    expect(data.queryByLabelText('Data series')).not.toBeInTheDocument()
    expect(data.getAllByRole('columnheader').map((header) => header.getAttribute('aria-label')))
      .toEqual(['Timestamp (UTC)', 'Series A', 'Series B'])
    const table = data.getByRole('table')
    const rows = () => [...table.querySelectorAll('tbody tr')].map((row) => [...row.children].map((cell) => cell.textContent))
    expect(data.getByLabelText('Rows per page')).toHaveValue('25')
    expect(rows()).toHaveLength(25)
    expect(rows().slice(0, 3)).toEqual([
      ['2026-11-20T00:00:00.000001Z', '0 m', '9223372036854775807 m'],
      ['2026-11-20T00:00:00.000002Z', 'No sample', 'Missing'],
      ['2026-11-20T00:00:01Z', '1 m', 'No sample'],
    ])
    fireEvent.click(data.getByRole('button', { name: 'Next page' }))
    expect(rows()).toEqual([['2026-11-20T00:00:24Z', '1 m', 'No sample']])
    const timestamp = data.getByRole('button', { name: 'Timestamp (UTC)' })
    fireEvent.click(timestamp)
    fireEvent.click(timestamp)
    expect(rows()[0]?.[0]).toBe('2026-11-20T00:00:24Z')
    expect(rows()).toHaveLength(25)
    fireEvent.change(mode, { target: { value: 'single' } })
    fireEvent.change(data.getByLabelText('Data series'), { target: { value: 'B' } })
    expect(data.getByRole('table')).toHaveTextContent('2026-11-20T01:00:00.000001+01:00')
    expect(data.getByRole('cell', { name: '9223372036854775807 m' })).toBeInTheDocument()
    expect(data.getByRole('cell', { name: 'Missing' })).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(reads)
  })

  it('aborts old reads and discards late results after selecting another series or closing the viewer', async () => {
    let resolve: ((response: Response) => void) | undefined
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      if (path.includes('/metadata/')) return metadata()
      signal = init?.signal ?? undefined
      return new Promise<Response>((done) => { resolve = done })
    }))
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Select A' }))
    const chart = fillQuery()
    fireEvent.click(chart.getByRole('button', { name: 'Reload samples' }))
    await waitFor(() => expect(resolve).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: 'Select B' }))
    expect(signal?.aborted).toBe(true)
    await act(async () => { resolve!(page([sample(query.start)])) })
    expect(chart.queryByRole('figure')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))
    expect(chart.queryByRole('button', { name: 'Reload samples' })).not.toBeInTheDocument()
  })

  it('resolves as-of once, reuses its cutoff, and only refreshes explicitly', async () => {
    const requests: URL[] = []
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      const url = new URL(path, 'https://test'); requests.push(url)
      const cutoff = url.searchParams.get('read_cutoff') ?? 'asof-cutoff'
      return path.includes('/metadata/') ? metadata('A', cutoff) : page([sample(query.start)], null, 'A', cutoff)
    }))
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Select A' }))
    fillQuery()
    fireEvent.click(screen.getByRole('button', { name: 'Set historical context' }))
    const read = screen.getByRole('button', { name: 'Read at retained cutoff' })
    fireEvent.click(read)
    await screen.findByRole('table')
    expect(requests[1]!.searchParams.get('as_of')).toBe('2026-11-20T12:00:00Z')
    expect(requests[2]!.searchParams.get('read_cutoff')).toBe('asof-cutoff')
    fireEvent.click(read)
    await waitFor(() => expect(requests).toHaveLength(4))
    expect(requests[3]!.searchParams.get('read_cutoff')).toBe('asof-cutoff')
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Reload samples' }))
    await waitFor(() => expect(requests).toHaveLength(6))
    expect(requests[4]!.searchParams.get('as_of')).toBe('2026-11-20T12:00:00Z')
  })
})
