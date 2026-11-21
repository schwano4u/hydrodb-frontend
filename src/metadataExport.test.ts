// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { parquetReadObjects } from 'hyparquet'
import { exportMetadata } from './metadataExport'
import { MetadataClient } from './metadata'
import type { Selection } from './metadata'

const selection: Selection = { filters: [{ collection: 'stations', field: 'station_id', values: ['A', 'B'] }], q: '', asOf: '' }
function station(id: string, external = '=SUM(1,2)') {
  return {
    collection: 'stations', status: 'active', position_scope: 'current_only', references: [],
    item: { station_id: id, station_name: 'Name, "quoted"\nline', station_metadata_version: '9223372036854775807',
      station_validity_start: '2026-11-20T12:00:00.123456Z', station_external_id: external,
      station_location_status: 'known', station_location: { number: 9223372036854775807n.toString(), id: '0001' } },
  }
}
function fixture() {
  vi.stubGlobal('window', { location: { origin: 'https://test' } })
  const requests: URL[] = []
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    const url = new URL(path, 'https://test')
    requests.push(url)
    return new Response(JSON.stringify({ items: [station(url.searchParams.get('after') ? 'B' : 'A')],
      next_after: url.searchParams.get('after') ? null : 'next', read_cutoff: 'fixed' })
      .replace('"number":"9223372036854775807"', '"number":9223372036854775807'))
  }))
  return requests
}
const options = () => ({
  client: new MetadataClient(), selection, collection: 'stations' as const, cutoff: 'fixed',
  signal: new AbortController().signal, progress: vi.fn(),
})

describe('all matching metadata exports', () => {
  it('downloads all pages as structured JSON with exact values and one filter/cutoff context', async () => {
    const requests = fixture()
    const blob = await exportMetadata({ ...options(), format: 'json' })
    const result = JSON.parse(await blob.text())
    expect(result.rows.map((row: { id: string }) => row.id)).toEqual(['A', 'B'])
    expect(result.rows[0].station_location).toEqual({ number: '9223372036854775807', id: '0001' })
    expect(result.read_cutoff).toBe('fixed')
    expect(result.filters).toEqual(selection.filters)
    expect(requests.map((url) => url.searchParams.get('after'))).toEqual(['', 'next'])
    expect(requests.every((url) => url.searchParams.get('read_cutoff') === 'fixed' &&
      url.searchParams.get('filters') === JSON.stringify(selection.filters) && url.searchParams.get('limit') === '25')).toBe(true)
  })

  it('quotes CSV text and structured cells, preserves newlines, and neutralizes spreadsheet formulas', async () => {
    fixture()
    const csv = await (await exportMetadata({ ...options(), format: 'csv' })).text()
    expect(csv).toContain('"Name, ""quoted""\nline","A","\'=SUM(1,2)"')
    expect(csv).toContain('"{""number"":""9223372036854775807"",""id"":""0001""}"')
    expect(csv).toContain('"Name, ""quoted""\nline","B"')
  })

  it.each(['csv', 'json', 'parquet'] as const)('exports only enabled columns and passes global sort to every %s page', async (format) => {
    const requests = fixture()
    const blob = await exportMetadata({ ...options(), format, columns: ['id', 'station_location'], sort: { column: 'name', direction: 'desc' } })
    if (format === 'json') {
      const data = JSON.parse(await blob.text())
      expect(data.columns).toEqual(['id', 'station_location'])
      expect(Object.keys(data.rows[0])).toEqual(['id', 'station_location'])
      expect(data.sort).toEqual({ column: 'name', direction: 'desc' })
    } else if (format === 'csv') expect((await blob.text()).split('\r\n')[0]).toBe('"id","station_location"')
    else expect(Object.keys((await parquetReadObjects({ file: await blob.arrayBuffer() }))[0]!)).toEqual(['id', 'station_location'])
    expect(requests).toHaveLength(2)
    expect(requests.every((url) => url.searchParams.get('sort') === 'name' && url.searchParams.get('order') === 'desc')).toBe(true)
  })

  it('writes readable Parquet for all pages, including exact strings and an empty result', async () => {
    fixture()
    const blob = await exportMetadata({ ...options(), format: 'parquet' })
    const rows = await parquetReadObjects({ file: await blob.arrayBuffer() })
    expect(rows.map((row) => row.id)).toEqual(['A', 'B'])
    expect(rows[0]?.station_location).toBe('{"number":"9223372036854775807","id":"0001"}')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [], next_after: null, read_cutoff: 'fixed' }))))
    const empty = await exportMetadata({ ...options(), format: 'parquet' })
    expect(await parquetReadObjects({ file: await empty.arrayBuffer() })).toEqual([])
  })

  it('never substitutes historical coordinates and cancels before reading another page', async () => {
    const requests = fixture()
    const historical = await exportMetadata({ ...options(), selection: { ...selection, asOf: 'past' }, format: 'json' })
    expect(JSON.parse(await historical.text()).rows[0].station_location).toBeNull()
    requests.length = 0
    const controller = new AbortController()
    await expect(exportMetadata({ ...options(), format: 'csv', signal: controller.signal,
      progress: () => controller.abort() })).rejects.toMatchObject({ name: 'AbortError' })
    expect(requests).toHaveLength(1)
  })

  it.each(['changed cutoff', 'repeated cursor', 'HTTP failure'])('rejects %s without returning a partial file', async (failure) => {
    fixture()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      items: [station('A')], next_after: 'next', read_cutoff: failure === 'changed cutoff' ? 'other' : 'fixed',
    }), { status: failure === 'HTTP failure' ? 403 : 200 })))
    await expect(exportMetadata({ ...options(), format: 'csv' })).rejects.toThrow(
      failure === 'changed cutoff' ? /cutoff/ : failure === 'repeated cursor' ? /non-advancing/ : /403/)
  })

  it('rejects an export exceeding the actual 50 MiB threshold, without returning a partial file', async () => {
    fixture()
    let pages = 0
    const config = options()
    vi.spyOn(config.client, 'read').mockImplementation(async (_path, decode) => decode({
      items: [station(String(++pages), 'x'.repeat(1024 * 1024))], next_after: String(pages), read_cutoff: 'fixed',
    }))
    await expect(exportMetadata({ ...config, format: 'json' })).rejects.toThrow(/50 MiB/)
    expect(pages).toBe(50)
  })
})
