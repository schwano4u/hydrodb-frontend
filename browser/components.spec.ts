import { readFile } from 'node:fs/promises'
import { expect, fixtureReader, selectMenu, selectView, test } from './fixtures'

test('Job definitions download sits beside Reload and saves the table as CSV', async ({ page }) => {
  await fixtureReader(page)
  const jobId = '10000000-0000-4000-8000-000000000001'
  await page.route('**/api/v1/etl/jobs?**', (route) => route.fulfill({ json: {
    items: [{ job_id: jobId, name: 'Fixture gauge readings', feed: 'pegelonline', runner: 'fixture-runner',
      purpose: 'samples', config_version: 'release-1', enabled: true, cron: '0 * * * *', latest_run: null,
      next_scheduled_at: null, last_scheduled_at: null, last_success_at: null }],
    next_after: null, total: 1, observed_at: '2026-11-23T20:00:00Z',
  } }))
  await page.goto('/')
  await selectMenu(page, 'Tools', 'Jobs')
  const jobs = page.getByRole('region', { name: 'ETL Jobs' })
  await expect(jobs.getByRole('table', { name: 'Job definitions' })).toContainText('Fixture gauge readings')
  await expect(jobs.getByLabel('Rows per page')).toHaveCSS('height', '26px')
  const refresh = jobs.getByRole('button', { name: 'Refresh jobs' })
  const download = jobs.getByRole('button', { name: 'Download job definitions as CSV' })
  await expect(download).toHaveCSS('height', '32px')
  const refreshBounds = (await refresh.boundingBox())!
  const downloadBounds = (await download.boundingBox())!
  expect(downloadBounds.x).toBeGreaterThanOrEqual(refreshBounds.x + refreshBounds.width)
  expect(downloadBounds.y).toBeCloseTo(refreshBounds.y, 0)
  const file = page.waitForEvent('download')
  await download.click()
  const saved = await file
  expect(saved.suggestedFilename()).toBe('hydrodb-job-definitions.csv')
  const csv = await readFile(await saved.path(), 'utf8')
  expect(csv).toContain(`"Fixture gauge readings","${jobId}"`)
  expect(csv).not.toContain('Configuration version')
})

test('offline component examples use the documented sizing and layout', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-24T12:04:00Z') })
  await page.clock.pauseAt(new Date('2026-11-24T12:05:00Z'))
  await page.goto(new URL('../../hydrodb-requirements/docs/frontend/components.html', import.meta.url).href)
  const refresh = page.getByRole('button', { name: 'Refresh stations' })
  const timestamp = page.getByText('Last updated', { exact: false }).filter({ has: page.locator('time') })
  await expect(timestamp).toHaveText('Last updated 2026-11-24T12:00:00.000Z')
  const stampBounds = (await timestamp.boundingBox())!
  expect(stampBounds.x + stampBounds.width).toBeLessThan((await refresh.boundingBox())!.x)
  await refresh.press('Enter')
  await expect(refresh).toBeDisabled()
  await expect(refresh.locator('svg')).toHaveCSS('animation-name', 'metadata-reload-spin')
  await expect(page.getByRole('status').filter({ hasText: /^Reloading$/ })).toHaveCount(1)
  await page.clock.runFor(999)
  await expect(timestamp).toHaveText('Last updated 2026-11-24T12:00:00.000Z')
  await page.clock.runFor(1)
  await expect(timestamp).toHaveText('Last updated 2026-11-24T12:05:01.000Z')
  await expect(refresh).toBeEnabled()
  await expect(refresh.locator('svg')).toHaveCSS('animation-name', 'none')
  const mapMouseover = page.getByRole('region', { name: 'Map Pin Mouseover', exact: true })
  const pin = mapMouseover.getByRole('img', { name: 'Alder Reach / ST-001' })
  await pin.hover()
  const lines = [
    'Station: Alder Reach',
    'Station ID: ST-001',
    'Classification: ≤ 1 h',
    'Series: demo:alder-reach:water-level',
    'Latest timestamp: 2026-11-24T18:00:00+00:00',
  ]
  await expect(pin).toHaveAttribute('title', lines.join('\n'))
  const tooltipPreview = mapMouseover.locator('.components-demo-map-tooltip')
  await expect(tooltipPreview).toBeVisible()
  expect((await tooltipPreview.innerText()).split('\n')).toEqual(lines)
  const selection = page.getByRole('region', { name: 'Selection Action Bar', exact: true }).locator('section')
  await expect(selection.getByRole('status')).toHaveText('1 of 8 series selected')
  await selection.getByRole('button', { name: 'Series', exact: true }).click()
  const selected = page.getByRole('dialog', { name: 'Selected series' })
  for (const button of await selected.getByRole('button').all()) {
    await expect(button).toHaveCSS('height', '32px')
  }
  await selected.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('searchbox')).toHaveCSS('height', '32px')
  await expect(page.getByLabel('Rows per page')).toHaveCSS('height', '26px')
  await expect(page.getByRole('button', { name: 'Remove river basin filter Elbe' }).locator('..')).toHaveCSS('height', '32px')
  await expect(page.getByRole('button', { name: 'Component help' }).locator('span')).toHaveCSS('font-size', '18px')
  await expect(page.getByText('Component which required explanation')).toBeVisible()
  await expect(page.getByText('Alder Ford', { exact: true })).toHaveCount(0)
})

test('offline station pin opens the map popup and fixture details', async ({ page }) => {
  await page.goto(new URL('../../hydrodb-requirements/docs/frontend/components.html', import.meta.url).href)
  const demo = page.getByRole('region', { name: 'Station Map Popup', exact: true })
  const pin = demo.getByRole('button', { name: 'Alder Reach / ST-001' })
  const openDetails = demo.getByRole('button', { name: 'Open station details' })
  await expect(openDetails).toBeHidden()
  await pin.press('Enter')
  await expect(pin).toHaveAttribute('aria-pressed', 'true')
  const hoverPin = page.getByRole('region', { name: 'Map Pin Mouseover', exact: true })
    .getByRole('img', { name: 'Alder Reach / ST-001' })
  const entries = demo.locator('.station-map-popup p > span')
  await expect(entries.first()).toBeVisible()
  const { text, gaps } = await demo.locator('.station-map-popup').evaluate((popup) => {
    const elements = [...popup.querySelectorAll('p > span')]
    const bounds = elements.map((element) => element.getBoundingClientRect())
    return {
      text: elements.map((element) => element.textContent).join('\n'),
      gaps: bounds.slice(1).map((current, index) => current.top - bounds[index]!.bottom),
    }
  })
  expect(text).toBe(await hoverPin.getAttribute('title'))
  expect(gaps).toEqual([3, 3, 3, 3])
  await expect(openDetails).toHaveCSS('height', '36px')
  await openDetails.click()
  const details = demo.getByRole('dialog', { name: 'Station details' })
  await expect(details).toContainText('River basin: Elbe')
  await page.keyboard.press('Escape')
  await expect(details).toBeHidden()
  await expect(openDetails).toBeVisible()
  const openGraph = demo.getByRole('button', { name: 'Open time series graph' })
  await expect(openGraph).toHaveCSS('height', '36px')
  await openGraph.click()
  const graph = demo.getByRole('dialog', { name: 'Alder Reach: time series graph' })
  await expect(graph.getByText('Water level', { exact: false }).first()).toBeVisible()
  await expect(graph.getByText('Discharge', { exact: false }).first()).toBeVisible()
  await expect(graph.getByRole('img', { name: 'Alder Reach time series' }).locator('canvas').first()).toBeVisible()
  await graph.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(graph).toBeHidden()
  await expect(openGraph).toBeFocused()
  await demo.getByRole('button', { name: 'Close station popup' }).click()
  await expect(pin).toBeFocused()
  await expect(openDetails).toBeHidden()
  await pin.click()
  await pin.press('Escape')
  await expect(pin).toHaveAttribute('aria-pressed', 'false')
  await expect(openDetails).toBeHidden()
})

test('offline refresh controls stay on one row in a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto(new URL('../../hydrodb-requirements/docs/frontend/components.html', import.meta.url).href)
  const demo = page.getByRole('region', { name: 'Icon Button and Table Refresh' })
  const stamp = demo.locator('small').filter({ hasText: 'Last updated' })
  const selector = demo.getByRole('combobox', { name: 'Auto reload' })
  await expect(selector).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(stamp).toBeVisible()
  const [timestamp, refresh, interval] = await Promise.all([
    stamp.boundingBox(),
    demo.getByRole('button', { name: 'Refresh stations' }).boundingBox(),
    selector.boundingBox(),
  ])
  expect(timestamp!.x + timestamp!.width).toBeLessThan(refresh!.x)
  expect(interval!.x - (refresh!.x + refresh!.width)).toBeCloseTo(12, 0)
  expect(timestamp!.y + timestamp!.height / 2).toBeCloseTo(refresh!.y + refresh!.height / 2, 0)
  expect(refresh!.y + refresh!.height / 2).toBeCloseTo(interval!.y + interval!.height / 2, 0)
  await selector.selectOption('30')
  await expect(selector).toHaveCSS('padding-inline-start', '10px')
  expect((await selector.boundingBox())!.width).toBeGreaterThan(interval!.width)
  await selector.selectOption('0')
  expect((await selector.boundingBox())!.width).toBeCloseTo(interval!.width, 0)
})

test('offline auto reload repeats, resets after manual refresh or interval changes, and stops when off', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.install({ time: new Date('2026-11-24T11:59:00Z') })
  await page.clock.pauseAt(new Date('2026-11-24T12:00:00Z'))
  await page.goto(new URL('../../hydrodb-requirements/docs/frontend/components.html', import.meta.url).href)
  const demo = page.getByRole('region', { name: 'Icon Button and Table Refresh' })
  const interval = demo.getByRole('combobox', { name: 'Auto reload' })
  const refresh = demo.getByRole('button', { name: 'Refresh stations' })
  await expect(demo.getByText('Auto reload', { exact: true })).toHaveCount(0)
  const timestamp = demo.locator('time')
  const expectTime = (time: string) => expect(timestamp).toHaveAttribute('datetime', `2026-11-24T${time}.000Z`)
  await expect(interval).toHaveValue('0')
  await expect(interval.locator('option')).toHaveText(['Off', '15 seconds', '30 seconds', '1 minute', '5 minutes'])
  await page.clock.runFor(31_000)
  await expectTime('12:00:00')
  await interval.selectOption('30')
  await page.clock.runFor(29_000)
  await expectTime('12:00:00')
  await page.clock.runFor(1_000)
  await expect(refresh).toBeDisabled()
  await expect(refresh.locator('svg')).toHaveCSS('animation-name', 'none')
  await expect(refresh.locator('svg')).toHaveCSS('visibility', 'hidden')
  expect(await refresh.evaluate((button) => getComputedStyle(button, '::after').width)).toBe('3px')
  await expectTime('12:00:00')
  await page.clock.runFor(1_000)
  await expectTime('12:01:02')
  await page.clock.runFor(30_000)
  await expect(refresh).toBeDisabled()
  await page.clock.runFor(1_000)
  await expectTime('12:01:33')
  await page.clock.runFor(10_000)
  await refresh.click()
  await page.clock.runFor(1_000)
  await expectTime('12:01:44')
  await page.clock.runFor(20_000)
  await expectTime('12:01:44')
  await interval.selectOption('15')
  await page.clock.runFor(14_000)
  await expectTime('12:01:44')
  await page.clock.runFor(1_000)
  await expect(refresh).toBeDisabled()
  await interval.selectOption('0')
  await page.clock.runFor(1_000)
  await expectTime('12:02:20')
  await expect(refresh).toBeEnabled()
  await page.clock.runFor(30_000)
  await expectTime('12:02:20')
})

test('offline station classification applies settings and updates fixture pins', async ({ page }) => {
  await page.goto(new URL('../../hydrodb-requirements/docs/frontend/components.html', import.meta.url).href)
  const demo = page.getByRole('region', { name: 'Station Classification', exact: true })
  const pins = demo.getByRole('list', { name: 'Fixture station pins' })
  await demo.getByText('Classify stations', { exact: true }).click()
  await demo.getByLabel('Mode', { exact: true }).selectOption('attribute')
  await expect(pins.getByText('Alder Reach', { exact: true })).toBeVisible()
  await demo.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(pins.getByText('Alder Reach — DWD', { exact: true })).toBeVisible()
  await demo.getByRole('checkbox', { name: 'Show DWD on map' }).uncheck()
  await expect(pins.getByText('Alder Reach', { exact: false })).toHaveCount(0)
  await expect(pins.getByText('Birch Island — WSV', { exact: true })).toBeVisible()
  await demo.getByLabel('Mode', { exact: true }).selectOption('timestamp')
  await expect(demo.getByLabel('Age thresholds (hours)')).toHaveCSS('height', '36px')
  await expect(demo.getByRole('button', { name: 'Apply', exact: true })).toHaveCSS('height', '36px')
  await demo.getByLabel('Parameter', { exact: true }).selectOption({ label: 'Water level' })
  await demo.getByRole('checkbox', { name: 'Show values on map' }).check()
  await demo.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(pins.getByText('00:30', { exact: true })).toBeVisible()
  await expect(pins.getByText('Cedar Reach — No data', { exact: true })).toBeVisible()
  await demo.getByLabel('Mode', { exact: true }).selectOption('value')
  await expect(demo.getByLabel('Value breakpoints')).toHaveCSS('height', '36px')
})

test('application metadata auto reload is opt-in and waits for a pending read', async ({ page }) => {
  await fixtureReader(page)
  await page.clock.install()
  let captures = 0
  let finish: (() => void) | undefined
  await page.route('**/api/v1/metadata/browser?**', async (route) => {
    const params = new URL(route.request().url()).searchParams
    if (!params.has('read_cutoff') && ++captures === 2) {
      await new Promise<void>((resolve) => { finish = resolve })
    }
    await route.fulfill({ json: { items: [], read_cutoff: 'fixture-cutoff', next_after: null, total: 0 } })
  })
  await page.goto('/')
  await selectView(page, 'Metadata')
  const metadata = page.getByRole('article', { name: 'Metadata browser', exact: true })
  const selector = metadata.getByRole('combobox', { name: 'Auto reload' })
  const refresh = metadata.getByRole('button', { name: 'Reload', exact: true })
  await expect(refresh).toBeEnabled()
  await expect(selector).toHaveValue('0')
  await page.clock.fastForward(30_000)
  expect(captures).toBe(1)
  await selector.selectOption('15')
  await page.clock.fastForward(15_000)
  await expect.poll(() => Boolean(finish)).toBe(true)
  await expect(refresh).toBeDisabled()
  await page.clock.fastForward(30_000)
  expect(captures).toBe(2)
  await selector.selectOption('0')
  finish?.()
  await expect(refresh).toBeEnabled()
  await page.clock.fastForward(30_000)
  expect(captures).toBe(2)
})

test('the application selection bar uses 32 px actions and puts empty results in the legend', async ({ page }) => {
  await fixtureReader(page)
  await page.route('**/api/v1/metadata/browser?**', (route) => route.fulfill({ json: {
    items: [{ collection: 'series', status: 'active', position_scope: 'unavailable', references: [],
      item: { series_id: 'fixture-level', series_name: 'Fixture level',
        series_metadata_version: '1', series_validity_start: '2026-11-20T00:00:00Z' } }],
    read_cutoff: 'fixture-cutoff', next_after: null, total: 1,
  } }))
  await page.route('**/api/v1/series/fixture-level/coverage?**', (route) => route.fulfill({ json: {
    series_id: 'fixture-level', first_sample_at: null, last_sample_at: null,
  } }))
  await page.route('**/api/v1/series/fixture-level/samples?**', (route) => {
    const params = new URL(route.request().url()).searchParams
    return route.fulfill({ json: { items: [], series_id: 'fixture-level', selection: 'primary',
      start: params.get('start'), end: params.get('end'), read_cutoff: params.get('read_cutoff'), next_after: null } })
  })
  await page.goto('/')
  await selectView(page, 'Metadata')
  const metadata = page.getByRole('article', { name: 'Metadata browser', exact: true })
  await metadata.getByRole('button', { name: 'Fixture level / fixture-level', exact: true }).click()
  const detail = page.getByRole('article', { name: 'Metadata detail' })
  await expect(detail.getByRole('heading', { name: 'Fixture level', exact: true })).toBeVisible()
  await expect(detail.getByRole('button', { name: 'View samples', exact: true })).toHaveCount(0)
  await expect(detail.getByRole('button', { name: 'Copy stable ID', exact: true })).toHaveCount(0)
  await metadata.getByRole('checkbox', { name: 'Select Fixture level' }).check()
  const bar = metadata.getByRole('region', { name: 'Floating Selection Toolbar' })
  await expect(bar.getByRole('status')).toHaveText('1 of 8 series selected')
  for (const button of await bar.getByRole('button').all()) {
    await expect(button).toHaveCSS('height', '32px')
  }
  await bar.getByRole('button', { name: 'Series', exact: true }).click()
  const selected = bar.getByRole('dialog', { name: 'Selected series' })
  await expect(selected.getByRole('button', { name: /^Remove/ })).toHaveCSS('height', '32px')
  await expect(selected.getByRole('button', { name: 'Close' })).toHaveCSS('height', '32px')
  await selected.getByRole('button', { name: 'Close' }).click()
  await bar.getByRole('button', { name: 'Open visualization' }).click()
  const graph = page.getByRole('article', { name: 'Time series graph' })
  const message = 'No samples in the requested UTC range.'
  await expect(graph.locator('details').getByText(message)).toBeVisible()
  await expect(graph.getByText(message)).toHaveCount(1)
  await graph.getByText('Time series legend', { exact: true }).click()
  await expect(graph.getByText(message)).toBeHidden()
})
