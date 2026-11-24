import { fromLonLat } from 'ol/proj.js'
import { expect, fixtureReader, selectView, test } from './fixtures'
import type { Filter } from '../src/metadata'
import type { MapPoint } from '../src/mapPolygon'

for (const count of [2, 9]) {
  test(`station pin opens the workspace graph with ${count > 8 ? 'chosen' : 'all'} time series`, async ({ page }) => {
    await fixtureReader(page)
    await page.route('https://tile.openstreetmap.org/**', (route) => route.abort())
    const station = { collection: 'stations', status: 'active', references: [], position_scope: 'current_only',
      item: { station_id: 'A', station_name: 'Station A', station_metadata_version: '1',
        station_validity_start: '2026-11-20T12:00:00Z', station_location_status: 'known',
        station_location: { latitude: 53, longitude: 8 } } }
    const series = Array.from({ length: count }, (_, index) => ({
      collection: 'series', status: 'active', references: [], position_scope: 'unavailable',
      item: { series_id: `S${index + 1}`, series_name: `Gauge ${index + 1}`, station_id: 'A',
        series_metadata_version: '1', series_validity_start: '2026-11-20T12:00:00Z' },
    }))
    const lookup: { cutoff: string | null; filters: string | null; after: string | null }[] = []
    await page.route('**/api/v1/metadata/browser?**', (route) => {
      const params = new URL(route.request().url()).searchParams
      let items: unknown[] = []
      let next_after: string | null = null
      if (params.get('mode') === 'map') items = [station]
      else if (params.get('mode') === 'detail') items = series.filter(({ item }) => item.series_id === params.get('id'))
      else if (params.get('collection') === 'series' && params.get('filters')?.includes('"A"')) {
        const after = params.get('after')
        lookup.push({ cutoff: params.get('read_cutoff'), filters: params.get('filters'), after })
        items = after ? series.slice(1) : series.slice(0, 1)
        next_after = after ? null : 'S1'
      }
      return route.fulfill({ json: { items, next_after, read_cutoff: 'map-cutoff' } })
    })
    const samples: { id: string; cutoff: string | null }[] = []
    await page.route('**/api/v1/series/*/samples?**', (route) => {
      const { pathname, searchParams } = new URL(route.request().url())
      const id = pathname.split('/').at(-2)!
      const cutoff = searchParams.get('read_cutoff')
      samples.push({ id, cutoff })
      return route.fulfill({ json: { items: [], next_after: null, selection: 'primary', series_id: id,
        read_cutoff: cutoff, start: searchParams.get('start'), end: searchParams.get('end') } })
    })
    await page.goto('/')
    await selectView(page, 'Map')
    const pin = page.getByRole('button', { name: 'Station A / A', exact: true })
    await pin.click()
    const details = page.getByRole('button', { name: 'Open station details' })
    const action = page.getByRole('button', { name: 'Open time series graph' })
    await expect(details).toHaveCSS('height', '36px')
    await expect(action).toHaveCSS('height', '36px')
    const popupText = page.locator('.station-popup-entries')
    expect(await popupText.innerText()).toBe(await pin.getAttribute('title'))
    await action.click()
    if (count > 8) {
      const picker = page.getByRole('dialog', { name: 'Choose time series for Station A' })
      const choices = picker.getByRole('checkbox')
      await expect(choices).toHaveCount(9)
      expect(samples).toEqual([])
      for (let index = 0; index < 8; index++) await choices.nth(index).check()
      await expect(choices.nth(8)).toBeDisabled()
      for (let index = 1; index < 8; index++) await choices.nth(index).uncheck()
      await choices.nth(8).check()
      await picker.getByRole('button', { name: 'Open time series graph' }).click()
      await expect(picker).toBeHidden()
    }
    await expect(page.getByRole('article', { name: 'Time series graph' })).toBeVisible()
    const filters = JSON.stringify([{ collection: 'stations', field: 'station_id', values: ['A'] }])
    expect(lookup).toEqual([{ cutoff: 'map-cutoff', filters, after: '' }, { cutoff: 'map-cutoff', filters, after: 'S1' }])
    await expect.poll(() => samples).toEqual([{ id: 'S1', cutoff: 'map-cutoff' },
      { id: `S${count}`, cutoff: 'map-cutoff' }])
  })
}

test('map reload keeps the old pins until the full replacement arrives', async ({ page }) => {
  await fixtureReader(page)
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({
    headers: { 'access-control-allow-origin': '*' }, contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>',
  }))
  let captures = 0
  let finishCutoff: (() => void) | undefined
  let finishStations: (() => void) | undefined
  await page.route('**/api/v1/metadata/browser?**', async (route) => {
    const params = new URL(route.request().url()).searchParams
    let cutoff = params.get('read_cutoff')
    if (!cutoff) {
      cutoff = `cutoff-${++captures}`
      if (captures === 2) await new Promise<void>((resolve) => { finishCutoff = resolve })
    }
    const map = params.get('mode') === 'map'
    if (map && cutoff === 'cutoff-2') await new Promise<void>((resolve) => { finishStations = resolve })
    const items = map && cutoff === 'cutoff-1' ? [{
      collection: 'stations', status: 'active', references: [], position_scope: 'current_only',
      item: { station_id: 'A', station_name: 'Station A', station_metadata_version: '1',
        station_validity_start: '2026-11-20T12:00:00Z', station_location_status: 'known',
        station_location: { latitude: 53, longitude: 8 } },
    }] : []
    await route.fulfill({ json: { items, read_cutoff: cutoff, next_after: null, total: items.length } })
  })
  try {
    await page.goto('/')
    await selectView(page, 'Map')
    const pin = page.getByRole('button', { name: 'Station A / A', exact: true })
    const reload = page.getByRole('button', { name: 'Reload map' })
    const interval = page.getByRole('region', { name: 'Map', exact: true })
      .getByRole('combobox', { name: 'Auto reload' })
    await expect(interval).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(pin).toBeVisible()
    const oldPin = await pin.elementHandle()
    await reload.click()
    await expect.poll(() => Boolean(finishCutoff)).toBe(true)
    await expect(reload).toBeDisabled()
    await expect(pin).toBeVisible()
    finishCutoff?.()
    await expect.poll(() => Boolean(finishStations)).toBe(true)
    await expect(pin).toBeVisible()
    expect(await oldPin?.evaluate((node) => node.isConnected)).toBe(true)
    finishStations?.()
    await expect(pin).toHaveCount(0)
    await expect(page.getByText('0 stations shown; 0 without coordinates.')).toBeVisible()
  } finally {
    finishCutoff?.()
    finishStations?.()
  }
})

test('a full-size station response appears without intermediate pin batches and supports classification', async ({ page }) => {
  const items = Array.from({ length: 790 }, (_, i) => ({
    collection: 'stations', status: 'active', references: [], position_scope: 'current_only',
    item: { station_id: `S${i}`, station_name: `Station ${i}`, station_metadata_version: '1',
      station_validity_start: '2026-11-20T12:00:00Z', station_location_status: 'known',
      station_location: { latitude: 47 + i / 100, longitude: 8 + (i % 31) / 5 },
      station_provider: i === 0 ? 'DWD' : 'WSV' },
  }))
  let summaryReads = 0
  await fixtureReader(page)
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({
    headers: { 'access-control-allow-origin': '*' }, contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>',
  }))
  await page.route('**/api/v1/metadata/browser?**', (route) => {
    const params = new URL(route.request().url()).searchParams
    const collection = params.get('collection')
    const choices = collection === 'parameters' ? {
      parameter_id: 'parameter:level', parameter_name: 'Water level', parameter_metadata_version: '1',
      parameter_canonical_unit_id: 'unit:m',
      parameter_validity_start: '2026-11-20T12:00:00Z',
    } : collection === 'units' ? {
      unit_id: 'unit:m', unit_name: 'Metre', unit_symbol: 'm', unit_metadata_version: '1',
      unit_validity_start: '2026-11-20T12:00:00Z',
    } : undefined
    return route.fulfill({ json: {
      items: params.get('mode') === 'map' ? items : params.get('mode') === 'values' && collection === 'stations'
        ? [{ value: 'DWD', label: 'DWD' }, { value: 'WSV', label: 'WSV' }] : choices
        ? [{ collection, status: 'active', references: [], position_scope: 'current_only', item: choices }] : [],
      read_cutoff: 'map-cutoff', next_after: null,
    } })
  })
  await page.route('**/api/v1/metadata/station-summaries?**', (route) => {
    const params = new URL(route.request().url()).searchParams
    const ids: string[] = JSON.parse(params.get('station_ids')!)
    expect(ids.length).toBeLessThanOrEqual(50)
    expect(params.get('read_cutoff')).toBe('map-cutoff')
    expect(params.get('level')).toBe('raw')
    expect(params.has('statistic')).toBe(false)
    if (++summaryReads === 1) return route.fulfill({ status: 503, json: { message: 'Unavailable' } })
    return route.fulfill({ json: { read_cutoff: 'map-cutoff', items: ids.map((station_id) => station_id === 'S0'
      ? { station_id, status: 'sample', series_id: 'series:0', timestamp: '2026-11-24T00:00:00.000001Z', statistic: 'instantaneous', value: 0, unit: 'm', period: null }
      : { station_id, status: 'no_data' }) } })
  })
  await page.goto('/')
  const firstPinBatch = page.evaluate(() => new Promise<number>((resolve) => {
    const observer = new MutationObserver(() => {
      const count = document.querySelectorAll('.station-map-marker').length
      if (!count) return
      observer.disconnect()
      resolve(count)
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }))
  await selectView(page, 'Map')
  expect(await firstPinBatch).toBe(items.length)
  await expect(page.getByRole('button', { name: 'Station 789 / S789' })).toBeVisible()
  await page.getByText('Classify stations', { exact: true }).click()
  await page.getByLabel('Mode', { exact: true }).selectOption('attribute')
  const apply = page.getByRole('button', { name: 'Apply', exact: true })
  await expect(apply).toHaveCSS('height', '36px')
  await apply.click()
  const applyRight = await apply.evaluate((button) => button.getBoundingClientRect().right)
  const formRight = await apply.locator('..').evaluate((form) => form.getBoundingClientRect().right)
  expect(applyRight).toBeCloseTo(formRight, 0)
  await expect(page.getByRole('button', { name: 'Turn off', exact: true })).toHaveCount(0)
  const dwd = page.getByRole('button', { name: 'Station 0 / S0' })
  await expect(dwd).toHaveAttribute('aria-description', /DWD/)
  await expect(page.getByRole('button', { name: 'Station 789 / S789' })).toHaveAttribute('aria-description', /WSV/)
  const legend = page.getByRole('region', { name: 'Station classification legend' })
  const dwdLabel = legend.getByLabel('Label for DWD')
  const dwdPin = legend.getByRole('row').filter({ has: page.getByLabel('Label for DWD') }).locator('svg')
  await expect(dwdPin.locator('path')).toHaveAttribute('d', (await dwd.locator('path').getAttribute('d'))!)
  await expect(dwdPin).toHaveCSS('fill', await dwd.locator('svg').evaluate((svg) => getComputedStyle(svg).fill))
  await expect(dwdLabel).toHaveCSS('border-top-width', '0px')
  await expect(dwdLabel).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await dwdLabel.fill('Weather service')
  await dwdLabel.press('Tab')
  await expect(dwd).toHaveAttribute('aria-description', /Weather service/)
  expect(summaryReads).toBe(0)
  await page.getByLabel('Mode', { exact: true }).selectOption('value')
  const breakpoints = page.getByLabel('Value breakpoints')
  await expect(breakpoints).toHaveCSS('height', '36px')
  await page.getByLabel('Parameter', { exact: true }).selectOption({ label: 'Water level' })
  await expect(page.getByLabel('Common unit')).toHaveValue('unit:m')
  await page.getByLabel('Not older than').selectOption('off')
  await apply.click()
  await expect(dwd).toHaveAttribute('aria-description', /Read failed/)
  await page.getByRole('button', { name: 'Retry classification' }).click()
  await expect(dwd).toHaveAttribute('aria-description', /≥ 0 and < 1 m/)
  await expect(legend.getByRole('row').filter({ hasText: 'No data' }).locator('svg')).toBeVisible()
  await expect(legend.getByRole('columnheader', { name: '#Stations' })).toHaveCSS('text-align', 'right')
  const counts = await legend.locator('td.station-classification-count').evaluateAll((nodes) =>
    nodes.map((node) => ({ right: node.getBoundingClientRect().right, text: node.textContent })))
  expect(counts.map(({ text }) => text).sort()).toEqual(['0', '0', '0', '1', '789'])
  for (const count of counts) expect(count.right).toBeCloseTo(counts[0]!.right)
  expect(summaryReads).toBe(1 + Math.ceil(items.length / 50))
  await breakpoints.fill('0.5, 1')
  await apply.click()
  await expect(dwd).toHaveAttribute('aria-description', /< 0.5 m/)
  expect(summaryReads).toBe(1 + Math.ceil(items.length / 50))

  const mode = page.getByLabel('Mode', { exact: true })
  await mode.selectOption('timestamp')
  const thresholds = page.getByLabel('Age thresholds (hours)')
  await expect(thresholds).toHaveCSS('height', '36px')
  await thresholds.fill('1, 2, 3')
  await page.getByRole('checkbox', { name: 'Show values on map' }).check()
  const settings = page.getByRole('button', { name: 'Setting', exact: true })
  await expect(settings.locator('svg')).toBeVisible()
  await settings.click()
  await expect(settings).toHaveAttribute('aria-expanded', 'false')
  for (const control of [mode, page.getByLabel('Parameter', { exact: true }), page.getByLabel('Processing level'),
    thresholds, page.getByLabel('Show values on map'), apply]) {
    await expect(control).toBeHidden()
  }
  await expect(legend).toBeVisible()
  await expect(legend.getByRole('checkbox', { name: 'Show No data on map' })).toBeVisible()
  await settings.click()
  await expect(thresholds).toBeVisible()
  await expect(thresholds).toHaveValue('1, 2, 3')
  await expect(page.getByRole('checkbox', { name: 'Show values on map' })).toBeChecked()
})

test('polygon selection uses one shared filter and can be cleared from either view', async ({ page }) => {
  const stations = [
    { id: 'A', location: { longitude: 8, latitude: 53 } },
    { id: 'C', location: { longitude: 8.4, latitude: 53.3 } },
    { id: 'B', location: { longitude: 8.01, latitude: 53.01 } },
    { id: 'U', location: null },
  ]
  let appliedVertices: number | undefined
  await fixtureReader(page)
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({
    headers: { 'access-control-allow-origin': '*' }, contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e8f0e8"/></svg>',
  }))
  await page.route('**/api/v1/metadata/browser?**', (route) => {
    const params = new URL(route.request().url()).searchParams
    const polygon: MapPoint[] | null = JSON.parse(params.get('polygon') ?? 'null')
    if (polygon && params.get('collection') === 'stations' && params.has('after')) {
      appliedVertices = polygon.length
    }
    const filters: Filter[] = JSON.parse(params.get('filters') ?? '[]')
    const values = params.get('mode') === 'values'
    const matching = stations.filter(({ id, location }) => {
      if (!values && filters.some((filter) => !filter.values.includes(id))) return false
      if (!polygon) return true
      if (!location) return false
      const [x, y] = fromLonLat([location.longitude, location.latitude])
      // This fixture draws axis-aligned rectangles. The server integration
      // test exercises the real polygon predicate and authorization.
      const xs = polygon.map((point) => point[0])
      const ys = polygon.map((point) => point[1])
      return x! >= Math.min(...xs) && x! <= Math.max(...xs) && y! >= Math.min(...ys) && y! <= Math.max(...ys)
    })
    const rows = params.get('collection') === 'stations' ? matching : []
    const start = params.get('after') ? rows.findIndex(({ id }) => id === params.get('after')) + 1 : 0
    const batch = params.has('page') ? rows : rows.slice(start, start + 2)
    const items = values ? matching.map(({ id }) => ({ value: id, label: `Station ${id} / ${id}` }))
      : batch.map(({ id, location }) => ({
        collection: 'stations', status: 'active', references: [], position_scope: 'current_only',
        item: { station_id: id, station_name: `Station ${id}`, station_metadata_version: '1',
          station_validity_start: '2026-11-20T12:00:00Z', station_location_status: location ? 'known' : 'unknown',
          station_location: location },
      }))
    return route.fulfill({ json: { items, read_cutoff: 'polygon-cutoff', total: values ? matching.length : rows.length,
      next_after: !values && !params.has('page') && start + batch.length < rows.length ? batch.at(-1)?.id : null } })
  })
  await page.goto('/')
  await selectView(page, 'Map')
  const map = page.getByRole('region', { name: 'Map', exact: true }).and(page.locator('section'))
  const viewport = map.getByRole('region', { name: 'Station map' })
  const draw = map.getByRole('button', { name: 'Draw polygon' })
  const finish = map.getByRole('button', { name: 'Finish polygon' })
  const clear = map.getByRole('button', { name: 'Clear polygon selection' })
  const filters = page.getByRole('article', { name: 'Metadata filters', exact: true })
  const chip = filters.getByRole('button', { name: 'Remove polygon map selection' })
  const station = (id: string) => map.getByRole('button', { name: `Station ${id} / ${id}`, exact: true })

  async function drawRectangle(left: number, top: number, right: number, bottom: number) {
    for (const [i, [x, y]] of [[left, top], [right, top], [right, bottom]].entries()) {
      const bounds = (await viewport.boundingBox())!
      await viewport.click({ position: { x: x! - bounds.x, y: y! - bounds.y } })
      await expect(map.getByText(i ? `${i + 1} vertices.` : '1 vertex.', { exact: false })).toBeVisible()
    }
    const bounds = (await viewport.boundingBox())!
    await viewport.dblclick({ position: { x: left - bounds.x, y: bottom - bounds.y } })
  }

  async function drawAround(ids: string[]) {
    await draw.click()
    await viewport.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const pins = await Promise.all(ids.map((id) => station(id).boundingBox()))
    const xs = pins.map((pin) => pin!.x + pin!.width / 2)
    const ys = pins.map((pin) => pin!.y + pin!.height)
    await drawRectangle(Math.min(...xs) - 12, Math.min(...ys) - 12, Math.max(...xs) + 12, Math.max(...ys) + 12)
  }

  const stationCount = map.getByRole('status').filter({ hasText: /stations shown;/ })
  await expect(stationCount).toHaveText('3 stations shown; 1 without coordinates.')
  const drawShape = await draw.locator('svg').innerHTML()
  await draw.click()
  await expect(viewport).toBeFocused()
  await viewport.press('Enter')
  await finish.click()
  await expect(map.getByRole('alert')).toContainText('at least three')
  await viewport.press('Escape')
  await expect(draw).toBeFocused()
  await map.getByRole('button', { name: 'Zoom out', exact: true }).click()
  const before = (await station('A').boundingBox())!
  await drawAround(['A', 'B'])
  await expect(clear).toBeVisible()
  expect(await clear.locator('svg').innerHTML()).not.toBe(drawShape)
  await expect(stationCount).toHaveText('2 stations shown; 0 without coordinates.')
  expect(appliedVertices).toBe(4)
  const after = (await station('A').boundingBox())!
  expect(after.x).toBeCloseTo(before.x)
  expect(after.y).toBeCloseTo(before.y)
  await expect(station('B')).toBeVisible()
  await expect(station('C')).toHaveCount(0)
  await selectView(page, 'Filters')
  await filters.getByRole('checkbox', { name: 'Station A / A', exact: true }).check()
  await chip.click()
  await expect(filters.getByRole('button', { name: 'Clear all' })).toBeFocused()
  await expect(clear).toHaveCount(0)
  await expect(stationCount).toHaveText('1 stations shown; 0 without coordinates.')

  await drawAround(['A'])
  await expect(chip).toBeVisible()
  await clear.click()
  await expect(chip).toHaveCount(0)
  await expect(filters.getByRole('button', { name: 'Remove Stations: station id = A' })).toBeVisible()
  await expect(stationCount).toHaveText('1 stations shown; 0 without coordinates.')

  await draw.click()
  const bounds = (await viewport.boundingBox())!
  const x = bounds.x + bounds.width / 4
  const y = bounds.y + bounds.height / 4
  await drawRectangle(x, y, x + 12, y + 12)
  await expect(stationCount).toHaveText('0 stations shown; 0 without coordinates.')
  await expect(chip).toBeVisible()
  await filters.getByRole('button', { name: 'Clear all' }).click()
  await expect(chip).toHaveCount(0)
  await expect(stationCount).toHaveText('3 stations shown; 1 without coordinates.')
})
