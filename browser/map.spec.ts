import type { Page } from '@playwright/test'
import { test, expect, openIdentity, readerPassword, selectView } from './fixtures'
import type { Filter } from '../src/metadata'

async function login(page: Page) {
  await page.goto('/')
  await openIdentity(page)
  await page.getByLabel('Username', { exact: true }).fill('browser-test-reader')
  await page.getByLabel('Password', { exact: true }).fill(await readerPassword())
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Read-only workspace', exact: true })).toBeVisible()
}

test('Map reads beyond 50 stations, follows filter selections, retains edge tools, and exposes retryable failures', async ({ page }) => {
  const stations = Array.from({ length: 51 }, (_, index) => ({
    collection: 'stations', status: 'active', references: [], position_scope: 'current_only',
    item: { station_id: `S${String(index).padStart(2, '0')}`, station_name: `Station ${index}`,
      station_metadata_version: '1', station_validity_start: '2026-11-20T12:00:00Z',
      station_location_status: index === 49 ? 'unknown' : 'known',
      station_location: index === 49 ? null : { latitude: index === 48 ? 90 : 53 + index / 1000, longitude: 8 + index / 1000 } },
  }))
  let tileFailure = false
  let stationFailure = false
  const tileRequests: string[] = []
  await page.route('https://tile.openstreetmap.org/**', async (route) => {
    tileRequests.push(route.request().headers().referer ?? '')
    await route.fulfill(tileFailure ? { status: 503, body: 'Tile fixture unavailable' } : {
      headers: { 'access-control-allow-origin': '*' },
      contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e8f0e8"/></svg>',
    })
  })
  await page.route('**/api/v1/metadata/browser?**', async (route) => {
    const query = new URL(route.request().url()).searchParams
    const mode = query.get('mode') ?? 'instances'
    if (stationFailure && mode === 'instances' && query.get('collection') === 'stations') {
      await route.fulfill({ status: 403, json: { code: 'FORBIDDEN', message: 'Map station fixture unavailable', request_id: null } })
      return
    }
    let matching = stations
    const filters: Filter[] = JSON.parse(query.get('filters') ?? '[]')
    for (const filter of filters) {
      if (filter.collection === 'stations' && filter.field === 'station_id') {
        matching = matching.filter((station) => filter.values.includes(station.item.station_id))
      }
    }
    const size = Number(query.get('limit'))
    const start = query.has('page') ? (Number(query.get('page')) - 1) * size
      : query.get('after') ? matching.findIndex((station) => station.item.station_id === query.get('after')) + 1 : 0
    if (mode === 'values') {
      const search = (query.get('value_q') ?? '').toLowerCase()
      const values = matching.map((station) => ({ value: station.item.station_id, label: `${station.item.station_name} / ${station.item.station_id}` }))
        .filter((choice) => choice.label.toLowerCase().includes(search))
      await route.fulfill({ json: { items: values.slice(start, start + size), next_after: null, total: values.length, read_cutoff: 'map-cutoff' } })
    } else if (mode === 'detail') {
      await route.fulfill({ json: { items: stations.filter((station) => station.item.station_id === query.get('id')),
        next_after: null, read_cutoff: 'map-cutoff' } })
    } else {
      const items = query.get('collection') === 'stations' ? matching.slice(start, start + size) : []
      await route.fulfill({ json: { items, next_after: start + size < matching.length && items.length
        ? items.at(-1)!.item.station_id : null, total: matching.length, read_cutoff: 'map-cutoff' } })
    }
  })
  await login(page)
  await page.getByRole('menubar').getByRole('menuitem', { name: 'View', exact: true }).click()
  const view = page.getByRole('menu', { name: 'View', exact: true })
  await expect(view.getByRole('menuitemcheckbox', { name: 'Filters', exact: true })).toHaveCount(0)
  await expect(view.getByRole('menuitemcheckbox', { name: 'Tree view', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await selectView(page, 'Map')
  const map = page.getByRole('region', { name: 'Map', exact: true })
  await expect(map.getByRole('status')).toHaveText('50 stations shown; 1 without coordinates.')
  await expect(map.getByText('Current station coordinates only', { exact: true })).toHaveCount(0)
  const mapBounds = (await map.getByRole('region', { name: 'Station map', exact: true }).boundingBox())!
  const countBounds = (await map.getByRole('status').boundingBox())!
  expect(countBounds.y + countBounds.height).toBeLessThanOrEqual(mapBounds.y)
  await expect(map.locator('.ol-viewport')).toHaveCount(1)
  await expect(map.locator('.leaflet-container')).toHaveCount(0)
  await expect(map.getByRole('button', { name: 'Reload map', exact: true })).toHaveCSS('height', '36px')
  const reloadBounds = (await map.getByRole('button', { name: 'Reload map', exact: true }).boundingBox())!
  expect(countBounds.x + countBounds.width).toBeLessThanOrEqual(reloadBounds.x)
  expect(countBounds.y + countBounds.height / 2).toBeCloseTo(reloadBounds.y + reloadBounds.height / 2, 0)
  await expect(map.getByRole('button', { name: 'Reload map', exact: true }).locator('svg')).toHaveCSS('height', '24px')
  const reload = map.getByRole('button', { name: 'Reload map', exact: true }).locator('svg')
  await expect(reload).toHaveClass('reload-icon')
  await expect(reload.locator('path')).toHaveCount(4)
  await expect(reload).toHaveCSS('stroke-width', '2px')
  await expect(map.getByRole('button', { name: 'Zoom in', exact: true })).toHaveCSS('height', '36px')
  await expect(map.getByRole('button', { name: 'Zoom in', exact: true })).toHaveCSS('font-size', '24px')
  await expect(map.locator('.station-map-marker')).toHaveCount(50)
  await expect(map.getByRole('button', { name: 'Station 50 / S50', exact: true })).toBeVisible()
  const polarPin = map.getByRole('button', { name: 'Station 48 / S48', exact: true })
  await expect(polarPin).toBeVisible()
  expect((await polarPin.boundingBox())!.y).toBeGreaterThanOrEqual(mapBounds.y)
  const pin = map.getByRole('button', { name: 'Station 50 / S50', exact: true }).locator('svg')
  await expect(pin).toHaveCSS('height', '24px')
  await expect(pin).toHaveCSS('fill', 'rgb(0, 102, 214)')
  await expect(pin.locator('circle')).toHaveCSS('fill', 'rgb(255, 255, 255)')
  await expect(map.getByRole('link', { name: 'OpenStreetMap', exact: true })).toBeVisible()
  await expect.poll(() => tileRequests.length).toBeGreaterThan(0)
  expect(tileRequests.every((referer) => referer === new URL(page.url()).origin + '/')).toBe(true)
  const filters = page.getByRole('article', { name: 'Metadata filters', exact: true })
  await filters.getByLabel('Station 0 / S00', { exact: true }).check()
  await expect(map.locator('.station-map-marker')).toHaveCount(1)
  await filters.getByRole('searchbox', { name: 'Search available values' }).fill('S50')
  await filters.getByLabel('Station 50 / S50', { exact: true }).check()
  await expect(map.locator('.station-map-marker')).toHaveCount(2)
  const selected = map.getByRole('button', { name: 'Station 50 / S50', exact: true })
  await selected.focus()
  await selected.press('Enter')
  await expect(selected).toHaveAttribute('aria-pressed', 'true')
  await expect(selected).toHaveClass('station-map-marker is-selected')
  await expect(selected.locator('svg')).not.toHaveCSS('filter', 'none')
  const closePopup = map.getByRole('button', { name: 'Close station popup', exact: true })
  await expect(closePopup).toHaveCSS('height', '36px')
  await closePopup.click()
  await expect(selected).toHaveAttribute('aria-pressed', 'false')
  await expect(selected).toBeFocused()
  await selected.press('Enter')
  await map.getByRole('button', { name: 'Open station details', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Details', exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: 'Close Details', exact: true }).click()
  await filters.getByRole('button', { name: 'Clear all', exact: true }).click()
  await expect(map.locator('.station-map-marker')).toHaveCount(50)
  tileFailure = true
  // Move beyond tile levels cached while fitting the earlier filter selections.
  await map.getByRole('button', { name: 'Zoom in', exact: true }).click({ clickCount: 4, delay: 300 })
  await expect(map.getByRole('alert')).toContainText('OpenStreetMap tiles could not be loaded.')
  tileFailure = false
  await map.getByRole('button', { name: 'Retry map tiles', exact: true }).click()
  await expect(map.getByRole('alert')).toHaveCount(0)
  stationFailure = true
  await map.getByRole('button', { name: 'Reload map', exact: true }).click()
  await expect(map.getByRole('alert')).toContainText('API request failed (HTTP 403).')
  await expect(map.locator('.station-map-marker')).toHaveCount(0)
  stationFailure = false
  await map.getByRole('button', { name: 'Retry map read', exact: true }).click()
  await expect(map.locator('.station-map-marker')).toHaveCount(50)
  await page.reload()
  await expect(page.getByRole('tab', { name: 'Map', exact: true })).toHaveCount(1)
  await expect(page.getByRole('tab', { name: 'Filters', exact: true })).toHaveCount(1)
  await expect(page.getByRole('tab', { name: 'Tree view', exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: 'Close Map', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Filters', exact: true })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Tree view', exact: true })).toHaveCount(0)
})

test('real Map displays authorized stations on live OSM tiles and limits markers to selected station IDs', async ({ page }) => {
  test.setTimeout(90_000)
  let loadedTiles = 0
  page.on('response', (response) => {
    if (response.url().startsWith('https://tile.openstreetmap.org/') && response.status() === 200) loadedTiles++
  })
  await login(page)
  await selectView(page, 'Map')
  const map = page.getByRole('region', { name: 'Map', exact: true })
  await expect(map.getByRole('status')).toHaveText(/^\d[\d,]* stations shown; [\d,]+ without coordinates\.$/, { timeout: 45_000 })
  const initial = await map.locator('.station-map-marker').count()
  expect(initial).toBeGreaterThan(0)
  await expect.poll(() => loadedTiles, { timeout: 30_000 }).toBeGreaterThan(0)
  await expect.poll(() => map.locator('.ol-layer canvas').evaluateAll((canvases) => canvases.some((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement) || !canvas.width || !canvas.height) return false
    const context = canvas.getContext('2d')
    return context !== null && context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data[3]! > 0
  })), { timeout: 30_000 }).toBe(true)
  const marker = map.locator('.station-map-marker').first()
  const label = await marker.getAttribute('aria-label')
  expect(label).not.toBeNull()
  const id = label!.split(' / ').at(-1)!
  const filters = page.getByRole('article', { name: 'Metadata filters', exact: true })
  await filters.getByRole('searchbox', { name: 'Search available values' }).fill(id)
  await filters.locator('.metadata-choice').filter({ hasText: label! }).getByRole('checkbox').check()
  await expect(map.locator('.station-map-marker')).toHaveCount(1)
  await expect(map.getByRole('button', { name: label!, exact: true })).toBeVisible()
  await filters.getByRole('button', { name: 'Clear all', exact: true }).click()
  await expect(map.locator('.station-map-marker')).toHaveCount(initial)
})
