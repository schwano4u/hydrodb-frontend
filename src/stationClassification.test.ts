import { describe, expect, it } from 'vitest'
import { assignStation } from './stationClassification'
import type { Classification, Summary } from './stationClassification'
import type { MapStation } from './metadataMap'
import { decodeNode } from './metadata'

const station: MapStation = { node: decodeNode({
  collection: 'stations', status: 'active', references: [], position_scope: 'current_only',
  item: { station_id: 'a', station_name: 'A', station_metadata_version: '1', station_validity_start: '2026-11-24T00:00:00Z' },
}), point: [0, 0] }
const timestamp = '2026-11-24T00:00:00.000001Z'
const sample: Summary = { status: 'sample', series: 'a', timestamp, value: 0, unit: 'm' }
const source = { parameter: 'stage', level: 'raw' }
const reference = Date.parse('2026-11-24T01:00:00Z')
const value: Classification = { ...source, mode: 'value', breaks: [0, 1], freshness: 'off', unit: 'm', unitLabel: 'm' }

describe('Station marker sample classification', () => {
  it('only exposes marker values for usable, fresh samples with the option enabled', () => {
    const config: Classification = { ...value, showValues: true, freshness: '1' }
    const classify = (row: Summary) => assignStation(config, station, row, reference, new Map(), false)
    expect(classify(sample)?.markerValue).toBe(0)
    expect(classify({ ...sample, timestamp: '2020-01-01T00:00:00Z' })?.markerValue).toBeUndefined()
    expect(classify({ ...sample, value: undefined })?.markerValue).toBeUndefined()
    expect(classify({ status: 'no_data' })?.markerValue).toBeUndefined()
  })

  it('classifies old samples when freshness is off and puts zero in the higher band', () => {
    const classify = (row: Summary) => assignStation(value, station, row, reference, new Map(), false)
    expect(classify({ ...sample, timestamp: '2020-01-01T00:00:00Z' })?.label).toBe('≥ 0 and < 1 m')
    expect(classify({ ...sample, value: undefined })).toMatchObject({
      key: 'status:No data', label: 'No data', detail: expect.stringContaining('No usable value'),
    })
  })

  it.each([['1', '23'], ['3', '21'], ['7', '17']] as const)('includes the exact %s-day boundary and rejects older samples', (freshness, day) => {
    const classify = (timestamp: string) => assignStation({ ...value, freshness }, station,
      { ...sample, timestamp }, reference, new Map(), false)?.label
    expect(classify(`2026-11-${day}T01:00:00Z`)).toBe('≥ 0 and < 1 m')
    expect(classify(`2026-11-${day}T00:59:59.999999Z`)).toBe('Stale')
  })

  it('distinguishes no data and failed reads from a recorded missing sample', () => {
    const config: Classification = { ...source, mode: 'timestamp', breaks: [1, 24] }
    const classify = (row?: Summary, failed = false) => assignStation(config, station, row, reference, new Map(), failed)?.label
    expect(classify({ ...sample, value: undefined, timestamp: '2026-11-24T00:00:00Z' })).toBe('≤ 1 h')
    expect(classify({ ...sample, timestamp: '2026-11-23T23:59:59.999999Z' })).toBe('> 1 h to ≤ 24 h')
    expect(classify({ status: 'no_data' })).toBe('No data')
    expect(classify({ status: 'ambiguous' })).toBe('Read failed')
    expect(classify(undefined, true)).toBe('Read failed')
  })

  it('displays the timestamp age in whole hours and minutes without wrapping at midnight', () => {
    const config: Classification = { ...source, mode: 'timestamp', breaks: [1, 24], showValues: true }
    const classify = (row: Summary) => assignStation(config, station, row, reference, new Map(), false)?.markerValue
    expect(classify({ ...sample, timestamp: '2026-11-24T00:52:01Z' })).toBe('00:07')
    expect(classify({ ...sample, timestamp: '2026-11-22T23:40:00Z', value: undefined })).toBe('25:20')
    expect(classify({ ...sample, timestamp: '2026-11-24T01:03:00Z' })).toBe('-00:03')
    expect(classify({ status: 'no_data' })).toBeUndefined()
  })

  it('groups absent and unavailable series under one legend class while keeping their reasons', () => {
    const classify = (row: Summary) => assignStation(value, station, row, reference, new Map(), false)
    expect(classify({ status: 'no_series' })).toMatchObject({
      key: 'status:No data', label: 'No data', detail: 'No matching series',
    })
    expect(classify({ status: 'unavailable', series: 'a' })).toMatchObject({
      key: 'status:No data', label: 'No data', detail: 'Unavailable | Series: a',
    })
    expect(classify({ status: 'ambiguous' })?.key).toBe('status:Multiple matching series')
  })
})
