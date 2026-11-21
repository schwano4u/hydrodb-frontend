import { describe, expect, it, vi } from 'vitest'
import { parseExactJson } from './api'
import { decodeNode, decodePage, format, MetadataClient, nodeVersion } from './metadata'

const node = {
  collection: 'stations', status: 'active', position_scope: 'unavailable', references: [],
  item: { station_id: '0001', station_name: 'Repeated name', station_metadata_version: 1, station_validity_start: '2026-11-20T12:00:00.123456Z' },
}
const decode = (body: unknown) => decodePage(body, decodeNode)
const page = { items: [node], next_after: null, read_cutoff: 'pinned-cutoff' }

describe('bounded metadata transport and revision pins', () => {
  it('preserves bigint owner versions, identity spelling, timestamps and nested JSON types', () => {
    const raw = JSON.stringify(page).replace('"station_metadata_version":1',
      '"station_metadata_version":9223372036854775807,"station_user_attributes":{"n":9223372036854775806,"flag":true,"values":[null,0,"0001"]}')
    const decoded = decode(parseExactJson(raw))
    expect(nodeVersion(decoded.items[0]!)).toBe('9223372036854775807')
    expect(decoded.items[0]!.item.station_id).toBe('0001')
    expect(decoded.items[0]!.item.station_validity_start).toBe('2026-11-20T12:00:00.123456Z')
    expect(format(decoded.items[0]!.item.station_user_attributes)).toContain('"values": [null, 0, "0001"]')
    expect(format(decoded.items[0]!.item.station_user_attributes)).toContain('"n": 9223372036854775806')
  })

  it('rejects invalid pins and unbounded/malformed pages instead of displaying rounded references', () => {
    for (const value of ['9223372036854775808', 0, 9007199254740992, 1.5]) {
      expect(() => decodeNode({ ...node, references: [{ field: 'station_id', collection: 'stations', id: '0001', version: value }] })).toThrow()
    }
    expect(() => decode({ ...page, items: Array.from({ length: 51 }, () => node) })).toThrow()
    expect(() => decode({ ...page, read_cutoff: null })).toThrow()
    expect(() => decodeNode({ ...node, collection: 'locations' })).toThrow()
  })

  it('validates exact numbered-page totals while preserving cursor responses', () => {
    expect(decode(page).total).toBeUndefined()
    expect(decode({ ...page, total: 0 }).total).toBe(0)
    expect(decode({ ...page, total: 12n }).total).toBe(12)
    for (const total of [-1, 1.5, '12', null, 9007199254740992n]) {
      expect(() => decode({ ...page, total })).toThrow()
    }
  })

  it('pins cache entries by complete query, caps retained pages, and rejects changed cutoffs', async () => {
    const fetch = vi.fn().mockImplementation(async (path: string) => {
      const cutoff = new URL(path, 'https://test').searchParams.get('read_cutoff') ?? 'pinned-cutoff'
      return new Response(JSON.stringify({ ...page, read_cutoff: cutoff }))
    })
    vi.stubGlobal('fetch', fetch)
    const client = new MetadataClient()
    const signal = new AbortController().signal
    const first = '/api/v1/metadata/browser?collection=stations&read_cutoff=pinned-cutoff' as const
    await client.read(first, decode, signal)
    await client.read(first, decode, signal)
    expect(fetch).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 12; i++) await client.read(`/api/v1/metadata/browser?collection=stations&after=${i}`, decode, signal)
    await client.read(first, decode, signal)
    expect(fetch).toHaveBeenCalledTimes(14)
    client.clear()
    fetch.mockResolvedValue(new Response(JSON.stringify(page)))
    await expect(client.read('/api/v1/metadata/browser?read_cutoff=different', decode, signal)).rejects.toMatchObject({ kind: 'malformed' })
  })

  it('refuses oversized responses and more than four simultaneous reads', async () => {
    const client = new MetadataClient()
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_path, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })))
    const pending = Array.from({ length: 4 }, (_, i) => client.read(`/api/v1/metadata/browser?after=${i}`, decode, controller.signal))
    const outcomes = Promise.allSettled(pending)
    await expect(client.read('/api/v1/metadata/browser?after=five', decode, controller.signal)).rejects.toMatchObject({ kind: 'invalid-input' })
    controller.abort()
    await outcomes
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(' '.repeat(2 * 1024 * 1024 + 1))))
    await expect(client.read('/api/v1/metadata/browser', decode, new AbortController().signal)).rejects.toMatchObject({ kind: 'malformed' })
  })

  it('reuses the initial as-of response after capturing its resolved cutoff', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(page)))
    vi.stubGlobal('fetch', fetch)
    const client = new MetadataClient()
    const signal = new AbortController().signal
    await client.read('/api/v1/metadata/browser?collection=stations&as_of=2026-11-20T12%3A00%3A00Z', decode, signal)
    await client.read('/api/v1/metadata/browser?collection=stations&read_cutoff=pinned-cutoff', decode, signal)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
