import { describe, expect, it } from 'vitest'
import { decodeWorkspaceSelections, encodeWorkspaceSelections } from './workspaceSelections'
import type { WorkspaceSelections } from './workspaceSelections'

const series = { id: 'A', collection: 'series', asOf: '', version: '2', field: 'series_id', cutoff: 'old-cutoff' } as const
const state: WorkspaceSelections = {
  selection: { asOf: '', q: 'gauge', filters: [{ collection: 'stations', field: 'station_id', values: ['A'] }],
    polygon: [[0, 0], [100, 0], [100, 100]] },
  checked: [{ ...series, name: 'Gauge A' }],
  graphs: { series: { selections: [series], period: { start: '2026-11-20T00:00:00Z', end: '2026-11-21T00:00:00Z' } } },
}

describe('saved workspace selections', () => {
  it('round-trips filters, polygon, checked series and graph queries without retaining read pins', () => {
    const saved = encodeWorkspaceSelections(state)
    expect(saved).not.toContain('old-cutoff')
    const restored = decodeWorkspaceSelections(saved)
    expect(restored.selection).toEqual(state.selection)
    expect(restored.checked[0]).toMatchObject({ id: 'A', name: 'Gauge A', cutoff: '', version: '' })
    expect(restored.graphs.series).toMatchObject({ period: state.graphs.series?.period, selections: [{ id: 'A', cutoff: '' }] })
  })

  it('rejects invalid time windows and unsupported stored versions', () => {
    const invalidPeriod = { start: '2026-11-22T00:00:00Z', end: '2026-11-21T00:00:00Z' }
    expect(() => decodeWorkspaceSelections(encodeWorkspaceSelections({
      ...state, graphs: { series: { selections: [series], period: invalidPeriod } },
    }))).toThrow('End must be after start')
    expect(() => decodeWorkspaceSelections('{"version":99}')).toThrow('Invalid saved workspace selections')
  })
})
