import { describe, expect, it } from 'vitest'
import { Orientation } from 'dockview'
import { decodeLayout, layoutKey, panelPlacement } from './workspaceLayout'

function saved() {
  return {
    version: 2, height: 480,
    layout: {
      grid: {
        root: { type: 'branch', data: [
          { type: 'leaf', size: 600, data: { id: 'group-1', views: ['welcome', 'metadata'], activeView: 'metadata' } },
        ] },
        width: 900, height: 480, orientation: 'HORIZONTAL',
      },
      panels: {
        welcome: { id: 'welcome', contentComponent: 'placeholder', title: 'Untrusted title' },
        metadata: { id: 'metadata', contentComponent: 'placeholder' },
      },
      activeGroup: 'group-1',
    },
  }
}

describe('workspace presentation persistence', () => {
  it('restores Map as a trusted singleton panel without persisting station data', () => {
    const value = saved()
    const restored = decodeLayout(JSON.stringify({ ...value, layout: { ...value.layout,
      grid: { ...value.layout.grid, root: { type: 'leaf', data: { id: 'group-1', views: ['welcome', 'metadata', 'map'], activeView: 'map' } } },
      panels: { ...value.layout.panels, map: { id: 'map', contentComponent: 'placeholder', title: 'Untrusted map title' } },
    } }))
    expect(restored.layout.panels.map).toEqual({ id: 'map', contentComponent: 'placeholder', title: 'Map' })
    expect(decodeLayout(JSON.stringify(restored))).toEqual(restored)
  })

  function withEdge() {
    const value = saved()
    return {
      ...value,
      layout: {
        ...value.layout,
        panels: { ...value.layout.panels,
          filters: { id: 'filters', contentComponent: 'placeholder' },
          'station-tree': { id: 'station-tree', contentComponent: 'placeholder' },
        },
        edgeGroups: { left: {
          size: 300, visible: true, autoHide: false, autoReveal: true,
          minimumSize: 160, maximumSize: 600,
          group: { id: 'metadata-tools', views: ['filters', 'station-tree'], activeView: 'filters' },
        } },
      },
    }
  }

  it('round-trips the trusted pinned left edge and preserves its active tool and size', () => {
    const restored = decodeLayout(JSON.stringify(withEdge()))
    expect(restored.layout.edgeGroups?.left?.size).toBe(300)
    expect(restored.layout.edgeGroups?.left?.autoHide).toBe(false)
    expect(restored.layout.edgeGroups?.left?.group).toEqual({
      id: 'metadata-tools', views: ['filters', 'station-tree'], activeView: 'filters',
    })
    expect(decodeLayout(JSON.stringify(restored))).toEqual(restored)
    expect(restored.layout.panels['station-tree']?.title).toBe('Tree view')
    expect(panelPlacement('filters', restored.layout)).toEqual({
      position: { referenceGroup: 'metadata-tools', direction: 'within' },
    })
  })

  it('rejects malformed, duplicate, unbounded and unsupported edge groups', () => {
    const value = withEdge()
    const edge = value.layout.edgeGroups.left
    for (const change of [
      { ...edge, size: -1 },
      { ...edge, visible: 'yes' },
      { ...edge, minimumSize: 700 },
      { ...edge, group: { ...edge.group, views: ['welcome'] } },
      { ...edge, group: { ...edge.group, activeView: 'health' } },
      { ...edge, group: { ...edge.group, id: 'group-1' } },
    ]) {
      expect(() => decodeLayout(JSON.stringify({
        ...value, layout: { ...value.layout, edgeGroups: { left: change } },
      }))).toThrow()
    }
    expect(() => decodeLayout(JSON.stringify({
      ...value, layout: { ...value.layout, edgeGroups: { right: edge } },
    }))).toThrow()
  })

  it('reopens a closed tool at its previous left-edge tab index', () => {
    const previous = decodeLayout(JSON.stringify(withEdge())).layout
    const current = structuredClone(previous)
    current.edgeGroups!.left!.group = { id: 'metadata-tools', views: ['station-tree'], activeView: 'station-tree' }
    delete current.panels.filters
    const restored = decodeLayout(JSON.stringify({ version: 2, layout: current, closedPanels: { filters: previous } }))
    expect(panelPlacement('filters', restored.layout, restored.closedPanels?.filters)).toEqual({
      position: { referenceGroup: 'metadata-tools', direction: 'within', index: 0 },
    })
    current.edgeGroups!.left!.group = { id: 'metadata-tools', views: [] }
    delete current.panels['station-tree']
    expect(decodeLayout(JSON.stringify({ version: 2, layout: current })).layout.edgeGroups?.left).toBeDefined()
  })

  it('round-trips layout only and reconstructs trusted panel titles', () => {
    const restored = decodeLayout(JSON.stringify(saved()))
    expect(restored.layout.panels.welcome?.title).toBe('Welcome')
    expect(restored.layout.grid.width).toBe(900)
    expect(restored.layout.activeGroup).toBe('group-1')
    expect(decodeLayout(JSON.stringify(restored))).toEqual(restored)
    expect(layoutKey('https://one.test', 'reader')).not.toBe(layoutKey('https://two.test', 'reader'))
    expect(layoutKey('https://one.test', 'reader')).not.toBe(layoutKey('https://one.test', 'other'))
  })

  it('accepts the application-owned tab renderer but rejects arbitrary tab components', () => {
    const value = saved()
    expect(decodeLayout(JSON.stringify({
      ...value, layout: { ...value.layout, panels: {
        ...value.layout.panels, metadata: { ...value.layout.panels.metadata, tabComponent: 'workspace' },
      } },
    })).layout.panels.metadata?.tabComponent).toBeUndefined()
    expect(() => decodeLayout(JSON.stringify({
      ...value, layout: { ...value.layout, panels: {
        ...value.layout.panels, metadata: { ...value.layout.panels.metadata, tabComponent: 'untrusted' },
      } },
    }))).toThrow()
  })

  it.each([
    (value: ReturnType<typeof saved>) => { value.version = 1 },
    (value: ReturnType<typeof saved>) => { value.layout.grid.width = Infinity },
    (value: ReturnType<typeof saved>) => { value.layout.grid.root.data[0]!.data.views.push('unknown') },
    (value: ReturnType<typeof saved>) => { value.layout.grid.root.data[0]!.data.views.push('welcome') },
    (value: ReturnType<typeof saved>) => { value.layout.panels.welcome.contentComponent = 'unexpected' },
    (value: ReturnType<typeof saved>) => { value.layout.activeGroup = 'missing' },
  ])('rejects obsolete, unbounded and inconsistent state %#', (change) => {
    const value = saved()
    change(value)
    expect(() => decodeLayout(JSON.stringify(value))).toThrow()
  })

  it('restores Health alongside all other singleton panels without dropping older layouts', () => {
    const value = saved()
    value.layout.grid.root.data[0]!.data.views.push('health', 'series', 'detail')
    const restored = decodeLayout(JSON.stringify({
      ...value,
      layout: { ...value.layout, panels: {
        ...value.layout.panels,
        health: { id: 'health', contentComponent: 'placeholder', title: 'Untrusted' },
        series: { id: 'series', contentComponent: 'placeholder' },
        detail: { id: 'detail', contentComponent: 'placeholder' },
      } },
    }))
    expect(restored.layout.panels.health?.title).toBe('Health')
    expect(decodeLayout(JSON.stringify(restored))).toEqual(restored)
  })

  it('rejects credentials/query params or malformed floating state instead of restoring them', () => {
    const value = saved()
    expect(() => decodeLayout(JSON.stringify({
      ...value, layout: { ...value.layout, panels: {
        ...value.layout.panels, welcome: { ...value.layout.panels.welcome, params: { csrf_token: 'secret' } },
      } },
    }))).toThrow()
    expect(() => decodeLayout(JSON.stringify({
      ...value, layout: { ...value.layout, floatingGroups: [{}] },
    }))).toThrow()
    expect(() => decodeLayout('x'.repeat(16001))).toThrow()
  })

  it('round-trips floating panels and rejects duplicate or out-of-bounds floating state', () => {
    const value = saved()
    value.layout.grid.root.data[0]!.data.views = ['welcome']
    value.layout.grid.root.data[0]!.data.activeView = 'welcome'
    const floating = {
      data: { id: 'floating-1', views: ['metadata'], activeView: 'metadata' },
      position: { left: 20, top: 30, width: 320, height: 240 },
    }
    const restored = decodeLayout(JSON.stringify({
      ...value, layout: { ...value.layout, activeGroup: 'floating-1', floatingGroups: [floating] },
    }))
    expect(restored.layout.floatingGroups).toEqual([floating])
    expect(decodeLayout(JSON.stringify(restored))).toEqual(restored)
    for (const change of [
      { ...floating, data: { ...floating.data, views: ['welcome'] } },
      { ...floating, position: { ...floating.position, left: -1 } },
      { ...floating, position: { ...floating.position, width: 10001 } },
      { ...floating, position: { ...floating.position, height: 0 } },
    ]) {
      expect(() => decodeLayout(JSON.stringify({
        ...value, layout: { ...value.layout, floatingGroups: [change] },
      }))).toThrow()
    }
  })

  it('restores a closed tab into its surviving group at its previous index after reload', () => {
    const previous = decodeLayout(JSON.stringify(saved())).layout
    const current = structuredClone(previous)
    current.grid.root = { type: 'leaf', data: { id: 'group-1', views: ['welcome'], activeView: 'welcome' } }
    delete current.panels.metadata
    const restored = decodeLayout(JSON.stringify({ version: 2, height: 480, layout: current, closedPanels: { metadata: previous } }))
    expect(panelPlacement('metadata', restored.layout, restored.closedPanels?.metadata))
      .toEqual({ position: { referenceGroup: 'group-1', direction: 'within', index: 1 } })
    expect(() => decodeLayout(JSON.stringify({ ...restored, closedPanels: { unknown: previous } }))).toThrow()
  })

  it('recreates a removed split beside its surviving neighbor instead of changing other panels', () => {
    const previous = decodeLayout(JSON.stringify(saved())).layout
    previous.grid.root = { type: 'branch', data: [
      { type: 'leaf', data: { id: 'left', views: ['welcome'] } },
      { type: 'leaf', data: { id: 'right', views: ['metadata'] } },
    ] }
    const current = structuredClone(previous)
    current.grid.root = { type: 'leaf', data: { id: 'left', views: ['welcome'] } }
    delete current.panels.metadata
    expect(panelPlacement('metadata', current, previous)).toEqual({ position: { referencePanel: 'welcome', direction: 'right' } })
    previous.grid.orientation = current.grid.orientation = Orientation.VERTICAL
    expect(panelPlacement('metadata', current, previous)).toEqual({ position: { referencePanel: 'welcome', direction: 'below' } })
  })

  it('reopens a floating panel at its remembered bounds when its group no longer exists', () => {
    const current = decodeLayout(JSON.stringify(saved())).layout
    current.grid.root = { type: 'leaf', data: { id: 'group-1', views: ['welcome'] } }
    delete current.panels.metadata
    const previous = structuredClone(current)
    previous.panels.metadata = { id: 'metadata', contentComponent: 'placeholder' }
    const position = { left: 40, top: 60, width: 320, height: 240 }
    previous.floatingGroups = [{ data: { id: 'floating-1', views: ['metadata'] }, position }]
    expect(panelPlacement('metadata', current, previous)).toEqual({
      floating: { position, width: 320, height: 240 },
    })
  })

  it('validates nested floating splits and reopens beside the surviving floating neighbor', () => {
    const base = decodeLayout(JSON.stringify(saved())).layout
    base.grid.root = { type: 'leaf', data: { id: 'group-1', views: ['welcome'] } }
    const position = { left: 20, top: 30, width: 600, height: 400 }
    const previous = decodeLayout(JSON.stringify({
      version: 2,
      layout: { ...base, panels: { ...base.panels, series: { id: 'series', contentComponent: 'placeholder' } },
        floatingGroups: [{ position, grid: {
          width: 600, height: 400, orientation: Orientation.HORIZONTAL,
          root: { type: 'branch', data: [
            { type: 'leaf', data: { id: 'float-left', views: ['metadata'] } },
            { type: 'leaf', data: { id: 'float-right', views: ['series'] } },
          ] },
        } }],
      },
    })).layout
    const current = structuredClone(previous)
    current.floatingGroups = [{ position, data: { id: 'float-left', views: ['metadata'] } }]
    delete current.panels.series
    expect(panelPlacement('series', current, previous)).toEqual({
      position: { referencePanel: 'metadata', direction: 'right' },
    })
    expect(decodeLayout(JSON.stringify({ version: 2, layout: previous })).layout).toEqual(previous)
  })
})
