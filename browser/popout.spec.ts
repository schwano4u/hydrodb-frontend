import { expect, fixtureReader, selectMenu, selectView, test } from './fixtures'

test('map copies inherit hidden filters and editable classification, and can be renamed', async ({ page, context }) => {
  await fixtureReader(page)
  await context.route('https://tile.openstreetmap.org/**', (route) => route.abort())
  await page.route('**/api/v1/metadata/browser?**', (route) => {
    const params = new URL(route.request().url()).searchParams
    const filters = JSON.parse(params.get('filters') ?? '[]')
    const items = params.get('collection') === 'stations'
      ? params.get('mode') === 'values' ? (params.get('field') === 'station_provider'
        ? [{ value: 'DWD', label: 'DWD' }] : [{ value: 'A', label: 'Station A / A' }])
        : (filters.length || params.has('polygon') ? ['A'] : ['A', 'B']).map((id) => ({
          collection: 'stations', status: 'active', references: [], position_scope: 'current_only',
          item: { station_id: id, station_name: `Station ${id}`, station_metadata_version: '1',
            station_validity_start: '2026-11-20T12:00:00Z', station_location_status: 'known', station_provider: 'DWD',
            station_location: { latitude: 53.1, longitude: id === 'A' ? 8.1 : 8.2 } },
        })) : []
    return route.fulfill({ json: { items, read_cutoff: 'popout-cutoff', next_after: null, total: items.length } })
  })
  await page.route('**/api/v1/preferences/layouts', (route) => route.fulfill({ json: { items: [], can_publish: false } }))
  await page.goto('/')
  await selectView(page, 'Map')
  const filters = page.getByRole('article', { name: 'Metadata filters', exact: true })
  await filters.getByRole('checkbox', { name: 'Station A / A', exact: true }).check()
  await page.getByRole('button', { name: 'Draw polygon', exact: true }).click()
  const viewport = page.getByRole('region', { name: 'Station map', exact: true })
  for (const [x, y] of [[100, 100], [200, 100], [200, 200]]) {
    await viewport.click({ position: { x, y } })
  }
  await viewport.dblclick({ position: { x: 100, y: 200 } })
  await expect(page.getByRole('button', { name: 'Clear polygon selection' })).toBeVisible()
  await expect(page.getByText('1 stations shown; 0 without coordinates.')).toBeVisible()
  await page.getByText('Classify stations', { exact: true }).click()
  await page.getByLabel('Mode', { exact: true }).selectOption('attribute')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  const label = page.getByLabel('Label for DWD', { exact: true })
  await label.fill('Weather service')
  await label.press('Tab')
  const mapTab = page.getByRole('tab', { name: 'Map', exact: true })
  await mapTab.click({ button: 'right' })
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByText('Open in New Window', { exact: true }).click(),
  ])
  const viewTrigger = page.getByRole('menubar', { name: 'Application menu' }).getByRole('menuitem', { name: 'View', exact: true })
  await viewTrigger.focus()
  await page.keyboard.press('Enter')
  const viewMenu = page.getByRole('menu', { name: 'View', exact: true })
  const mapEntry = viewMenu.getByRole('menuitemcheckbox', { name: 'Map', exact: true })
  await expect(viewMenu).toBeVisible()
  await mapEntry.focus()
  await page.keyboard.press('ArrowDown')
  await expect(viewMenu.getByRole('menuitem', { name: 'New Map', exact: true })).toBeFocused()
  const [second] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('Enter')])
  await expect(popup).toHaveURL(/\/popout\.html$/)
  await expect(popup.getByRole('tab', { name: 'Map copy 1', exact: true })).toBeVisible()
  await expect(second.getByRole('tab', { name: 'Map copy 2', exact: true })).toBeVisible()
  await expect(mapTab).toBeVisible()
  const count = '1 stations shown; 0 without coordinates.'
  await expect(popup.getByText(count)).toBeVisible()
  await expect(second.getByText(count)).toBeVisible()
  for (const copy of [popup, second]) {
    await expect(copy.getByText('Map filters', { exact: true })).toHaveCount(0)
    await expect(copy.getByRole('button', { name: /Draw polygon|Clear polygon selection/ })).toHaveCount(0)
    await expect(copy.getByLabel('Label for DWD', { exact: true })).toHaveValue('Weather service')
  }
  await popup.getByRole('tab', { name: 'Map copy 1', exact: true }).click({ button: 'right' })
  popup.once('dialog', (dialog) => dialog.accept('Weather stations'))
  await popup.getByRole('menuitem', { name: 'Rename Panel', exact: true }).click()
  await expect(popup.getByRole('tab', { name: 'Weather stations', exact: true })).toBeVisible()
  await popup.getByText('Classify stations (active)', { exact: true }).click()
  const copyLabel = popup.getByLabel('Label for DWD', { exact: true })
  await copyLabel.fill('Local label')
  await copyLabel.press('Tab')
  await expect(popup.getByRole('button', { name: 'Station A / A', exact: true })).toHaveAttribute('aria-description', /Local label/)
  await expect(label).toHaveValue('Weather service')
  await expect(second.getByLabel('Label for DWD', { exact: true })).toHaveValue('Weather service')
  await filters.getByRole('button', { name: 'Clear all', exact: true }).click()
  await expect(page.getByText('2 stations shown; 0 without coordinates.')).toBeVisible()
  await expect(popup.getByText(count)).toBeVisible()
  await expect(second.getByText(count)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Draw polygon' })).toBeVisible()
  await mapTab.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Copy to Weather stations', exact: true }).click()
  await expect(popup.getByRole('tab', { name: 'Map copy 3', exact: true })).toBeVisible()
  await expect(popup.getByText('2 stations shown; 0 without coordinates.')).toBeVisible()
  await popup.getByRole('tab', { name: 'Map copy 3', exact: true }).click({ button: 'right' })
  await popup.getByRole('menuitem', { name: 'Split Right', exact: true }).click()
  await popup.getByRole('tab', { name: 'Weather stations', exact: true }).click()
  const maps = popup.getByRole('region', { name: 'Station map', exact: true })
  await expect(maps).toHaveCount(2)
  const mapSizes = () => maps.evaluateAll((elements) => elements.map((map) => ({
    width: map.clientWidth,
    pin: map.querySelector<HTMLElement>('.station-map-marker')?.style.translate,
  })))
  await expect.poll(async () => (await mapSizes()).every(({ pin }) => !!pin)).toBe(true)
  const before = await mapSizes()
  const sash = await popup.locator('.dv-popout-window .dv-sash').boundingBox()
  if (!sash) throw new Error('The map split has no resizable divider.')
  const x = sash.x + sash.width / 2
  const y = sash.y + sash.height / 2
  // Model a backgrounded opener while the popup remains interactive.
  const openerFrame = await page.evaluateHandle(() => {
    const original = window.requestAnimationFrame
    window.requestAnimationFrame = () => -1
    return original
  })
  await popup.mouse.move(x, y)
  await popup.mouse.down()
  await popup.mouse.move(x + 120, y, { steps: 6 })
  await popup.mouse.up()
  await expect.poll(async () => (await mapSizes()).map(({ width }, index) =>
    Math.abs(width - before[index]!.width) > 80)).toEqual([true, true])
  await expect.poll(async () => (await mapSizes()).map(({ pin }, index) =>
    pin !== before[index]!.pin)).toEqual([true, true])
  await openerFrame.evaluate((original) => { window.requestAnimationFrame = original })
  await openerFrame.dispose()
  await second.getByRole('tab', { name: 'Map copy 2', exact: true }).click({ button: 'right' })
  await second.getByRole('menuitem', { name: 'Move to Weather stations', exact: true }).click().catch((error: unknown) => {
    // Dockview can close the source before Firefox finishes reporting the click.
    if (!second.isClosed()) throw error
  })
  await expect(popup.getByRole('tab', { name: 'Map copy 2', exact: true })).toBeVisible()
  await expect(popup.getByText(count)).toBeVisible()
  await expect(popup.getByRole('tabpanel', { name: 'Map copy 2' }).getByLabel('Label for DWD')).toHaveValue('Weather service')
  await popup.getByRole('tab', { name: 'Weather stations', exact: true }).click()
  await expect(popup.getByRole('tabpanel', { name: 'Weather stations' }).getByLabel('Label for DWD')).toHaveValue('Local label')
  await selectMenu(page, 'Layout', 'Save current layout')
  await expect(page.getByText('Close panel windows before saving a named layout.', { exact: true })).toBeVisible()
  await popup.close()
  await expect(mapTab).toBeVisible()
  await expect(page.getByRole('tab', { name: /Weather stations|Map copy/ })).toHaveCount(0)
  await filters.getByRole('checkbox', { name: 'Station A / A', exact: true }).check()
  await expect(page.getByText(count)).toBeVisible()
  await page.reload()
  await expect.poll(() => second.isClosed()).toBe(true)
  await expect(mapTab).toBeVisible()
  await expect(page.getByText(count)).toBeVisible()
})

test('a blocked panel window leaves its panel docked and explains how to retry', async ({ page }) => {
  await fixtureReader(page)
  await page.addInitScript(() => { window.open = () => null })
  await page.goto('/')
  const tab = page.getByRole('tab', { name: 'Welcome', exact: true })
  await tab.click({ button: 'right' })
  await page.getByText('Open in New Window', { exact: true }).click()
  await expect(page.getByText(/browser blocked the new window/)).toBeVisible()
  await expect(tab).toBeVisible()
  await selectView(page, 'New Map')
  await expect(page.getByText(/browser blocked the new window/)).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Map copy 1', exact: true })).toHaveCount(0)
})

test('graphs keep independent ranges and fetch fresh samples after reload', async ({ page }) => {
  await fixtureReader(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => {
    const Observer = window.ResizeObserver
    // A background opener must not be required to deliver chart resize notifications.
    window.ResizeObserver = class extends Observer {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) => {
          const delivered = entries.filter(({ target }) =>
            !target.classList.contains('sample-chart-canvas') || target.ownerDocument === document)
          if (delivered.length) callback(delivered, observer)
        })
      }
    }
  })
  const series = ['A', 'B'].map((id) => ({
    series_id: id, series_name: `Series ${id}`, series_metadata_version: '1',
    series_validity_start: '2026-11-19T00:00:00Z', series_value_shape: 'scalar',
    series_value_statistic: 'instantaneous', series_processing_level: 'raw',
    series_sampling_definition: { kind: 'non-equidistant' },
    series_period_definition: null, series_timestamp_position: null,
    unit_id: 'm', unit_metadata_version: 1,
    quality_codebook_id: 'quality', quality_codebook_metadata_version: 1,
    scientific_context: {},
    resolved_definitions: { unit: { unit_id: 'm', unit_metadata_version: 1, unit_symbol: 'm' } },
  }))
  const observationTimes = ['2026-11-20T06:00:00.000Z', '2026-11-20T18:00:00.000Z']
  let cutoff = 'graph-cutoff'
  const requests: { id: string; start: string | null; cutoff: string | null }[] = []
  const detailCutoffs: (string | null)[] = []
  await page.route('**/api/v1/series/*/coverage?**', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-2)
    return route.fulfill({ json: { series_id: id, first_sample_at: null, last_sample_at: null } })
  })
  await page.route('**/api/v1/metadata/browser?**', (route) => {
    const params = new URL(route.request().url()).searchParams
    if (params.get('mode') === 'detail') detailCutoffs.push(params.get('read_cutoff'))
    const items = series.filter(({ series_id }) => !params.has('id') || params.get('id') === series_id)
      .map((item) => ({ collection: 'series', status: 'active', position_scope: 'unavailable', references: [], item }))
    return route.fulfill({ json: { items, read_cutoff: cutoff, next_after: null, total: items.length } })
  })
  await page.route('**/api/v1/series/*/samples?**', (route) => {
    const url = new URL(route.request().url())
    const id = url.pathname.split('/').at(-2)!
    requests.push({ id, start: url.searchParams.get('start'), cutoff: url.searchParams.get('read_cutoff') })
    const times = id === 'A' ? observationTimes : ['2026-11-20T03:00:00.000Z', '2026-11-20T12:30:00.000Z']
    const items = times.filter((timestamp) =>
      Date.parse(timestamp) >= Date.parse(url.searchParams.get('start')!) &&
      Date.parse(timestamp) < Date.parse(url.searchParams.get('end')!)).map((timestamp) => ({
      timestamp, revision_no: 1, series_metadata_version: 1, state: 'valid',
      value: id === 'A' ? 5 : timestamp.includes('12:30') ? 6 : 8,
      detection_bound: null, period_start: null, period_end: null, occurrence: null,
      quality_code: 255, quality_codebook_id: 'quality', quality_codebook_metadata_version: 1,
      source: { record_id: timestamp, revision: 1 }, interpretation: { original: series.find((item) => item.series_id === id) },
    }))
    return route.fulfill({ json: {
      series_id: id, start: url.searchParams.get('start'), end: url.searchParams.get('end'),
      selection: 'primary', items, next_after: null, read_cutoff: cutoff,
    } })
  })
  await page.clock.setFixedTime(new Date('2026-11-21T00:00:00Z'))
  await page.goto('/')
  const selectSeries = async (id: string, previous?: string) => {
    await page.getByRole('tab', { name: 'Metadata', exact: true }).click()
    if (previous) await page.getByRole('checkbox', { name: `Select Series ${previous}`, exact: true }).uncheck()
    await page.getByRole('checkbox', { name: `Select Series ${id}`, exact: true }).check()
    await page.getByRole('button', { name: 'Open visualization', exact: true }).click()
  }
  await selectView(page, 'Metadata')
  await selectSeries('A')
  await selectView(page, 'New Time Series Graph')
  await selectSeries('B', 'A')
  const chart = (number = '') => page.getByRole('article', { name: `Time series graph${number}`, exact: true })
  const graphTab = (name: string) => page.getByRole('tab', { name, exact: true })
  await expect(chart(' 2').getByText('Series B', { exact: true })).toBeVisible()
  await graphTab('Time series data 2').click()
  await expect(page.getByRole('article', { name: 'Time series data 2', exact: true })).toBeVisible()
  await graphTab('Time series graph').click()
  await expect(chart().getByText('Series A', { exact: true })).toBeVisible()
  await chart().getByRole('button', { name: 'Graph settings' }).click()
  const settings = chart().getByRole('dialog', { name: 'Graph settings' })
  await settings.getByRole('spinbutton', { name: 'Minimum' }).fill('0')
  await settings.getByRole('spinbutton', { name: 'Maximum' }).fill('10')
  await settings.getByRole('button', { name: 'Apply' }).click()
  const plot = chart().locator('.sample-chart-canvas')
  const marker = chart().locator('.sample-chart-selected-time')
  const highlighted = page.getByRole('article', { name: 'Time series data', exact: true }).locator('tr[aria-current="true"]')
  async function observationPositions(graph = plot) {
    const canvas = graph.locator('canvas').first()
    await expect(canvas).toBeVisible()
    const findPoints = () => canvas.evaluate((element: HTMLCanvasElement) => {
      const { width, height } = element
      const rect = element.getBoundingClientRect()
      const pixels = element.getContext('2d')!.getImageData(0, 0, width, height).data
      let left = width, right = 0, top = height, bottom = 0
      for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          const i = (y * width + x) * 4
          if (Math.abs(pixels[i]! - 20) > 2 || Math.abs(pixels[i + 1]! - 127) > 2 ||
              Math.abs(pixels[i + 2]! - 168) > 2 || pixels[i + 3]! < 180) continue
          left = Math.min(left, x)
          right = Math.max(right, x)
          top = Math.min(top, y)
          bottom = Math.max(bottom, y)
        }
      }
      if (right - left < 8) return null
      const y = ((top + bottom) / 2 / height) * rect.height
      return {
        earlier: { x: rect.left + ((left + 2) / width) * rect.width, y: rect.top + y },
        later: { x: rect.left + ((right - 2) / width) * rect.width, y: rect.top + y },
      }
    })
    await expect.poll(findPoints).not.toBeNull()
    return (await findPoints())!
  }
  const { earlier, later } = await observationPositions()
  await page.mouse.click(earlier.x, earlier.y)
  await expect(highlighted).toContainText('06:00:00')
  await graphTab('Time series graph').click()
  await expect(marker).toBeVisible()
  await expect(marker.locator('.sample-chart-value-box')).toHaveText('5 m')
  await expect(marker.locator('.sample-chart-value-box')).toHaveCSS('background-color', 'rgb(20, 127, 168)')
  const firstMarkerX = (await marker.boundingBox())!.x
  await page.mouse.click(later.x, later.y)
  await expect(highlighted).toHaveCount(1)
  await expect(highlighted).toContainText('18:00:00')
  await graphTab('Time series graph').click()
  await expect(marker).toBeVisible()
  const markerBounds = (await marker.boundingBox())!
  expect(markerBounds.x).toBeGreaterThan(firstMarkerX)
  await page.mouse.click(markerBounds.x + markerBounds.width / 2, markerBounds.y + 20)
  await expect(marker).toBeHidden()
  await graphTab('Time series data').click()
  await expect(highlighted).toHaveCount(0)
  await graphTab('Time series graph').click()
  const start = chart().getByRole('textbox', { name: 'Start UTC (inclusive)', exact: true })
  const original = await start.inputValue()
  await start.fill('2026-11-20T12:00:00Z')
  await start.press('Enter')
  await expect.poll(() => requests.at(-1)).toMatchObject({ id: 'A', start: '2026-11-20T12:00:00Z' })
  await graphTab('Time series graph 2').click()
  await expect(chart(' 2').getByRole('textbox', { name: 'Start UTC (inclusive)', exact: true })).toHaveValue(original)
  await expect(chart(' 2').getByText('Series B', { exact: true })).toBeVisible()
  await graphTab('Metadata').click()
  await page.getByRole('checkbox', { name: 'Select Series B', exact: true }).uncheck()
  await page.getByRole('checkbox', { name: 'Select Series A', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Select Series B', exact: true }).check()
  await page.getByRole('button', { name: 'Open visualization', exact: true }).click()
  await expect(chart(' 2').getByText('Time series overlay', { exact: true })).toBeVisible()
  const [popup] = await Promise.all([page.waitForEvent('popup'), selectView(page, 'New Map')])
  await expect(popup.getByRole('tab', { name: 'Map copy 1', exact: true })).toBeVisible()
  const moveToMap = async (label: string) => {
    await graphTab(label).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Move to Map copy 1', exact: true }).click()
    await expect(popup.getByRole('tab', { name: label, exact: true })).toBeVisible()
    await expect(graphTab(label)).toHaveCount(0)
  }
  await moveToMap('Time series data 2')
  await moveToMap('Time series graph 2')
  const popupChart = popup.getByRole('article', { name: 'Time series graph 2', exact: true })
  await expect(popupChart.getByText('Time series overlay', { exact: true })).toBeVisible()
  await popup.getByRole('tab', { name: 'Time series graph 2', exact: true }).click({ button: 'right' })
  await popup.getByRole('menuitem', { name: 'Split Right', exact: true }).click()
  const popupPlot = popupChart.locator('.sample-chart-canvas')
  const canvasSize = () => popupPlot.locator('canvas').first().evaluate((canvas) => ({
    width: canvas.clientWidth, height: canvas.clientHeight,
  }))
  const originalCanvas = await canvasSize()
  await popup.setViewportSize({ width: 1500, height: 1000 })
  await expect.poll(async () => (await canvasSize()).width).toBeGreaterThan(originalCanvas.width)
  await expect.poll(async () => (await canvasSize()).height).toBeGreaterThan(originalCanvas.height)
  await popup.setViewportSize({ width: 1100, height: 760 })
  await expect.poll(async () => {
    const host = (await popupPlot.boundingBox())!
    const canvas = await canvasSize()
    return Math.max(Math.abs(host.width - canvas.width), Math.abs(host.height - canvas.height))
  }).toBeLessThan(2)
  const popupPoint = (await observationPositions(popupPlot)).later
  await popup.mouse.click(popupPoint.x, popupPoint.y)
  const popupBoxes = popupChart.locator('.sample-chart-value-box')
  await expect(popupBoxes).toHaveText(['5 m', '6 m'])
  await expect(popupBoxes.nth(1)).toHaveAttribute('title', 'Series B / 2026-11-20T12:30:00.000Z')
  await expect(popupBoxes.nth(1)).toHaveCSS('background-color', 'rgb(161, 68, 19)')
  const popupMarker = (await popupChart.locator('.sample-chart-selected-time').boundingBox())!
  await popup.mouse.click(popupMarker.x + popupMarker.width / 2, popupMarker.y + 20)
  await popup.getByRole('tab', { name: 'Time series data 2', exact: true }).click()
  await expect(popupChart).toBeVisible()
  const popupData = popup.getByRole('article', { name: 'Time series data 2', exact: true })
  await expect(popupData).toBeVisible()
  const seriesPicker = popupData.getByRole('button', { name: /^Data series:/ })
  const modePicker = popupData.getByRole('button', { name: /^Table mode:/ })
  await expect(seriesPicker).toHaveText('Data series: Series A (A)')
  await seriesPicker.click()
  await popupData.getByRole('dialog', { name: 'Data series' }).getByRole('button', { name: 'Series B (B)' }).click()
  await expect(seriesPicker).toHaveText('Data series: Series B (B)')
  await modePicker.click()
  const modes = popupData.getByRole('dialog', { name: 'Table mode' })
  await modes.getByRole('button', { name: 'Aligned series' }).click()
  await expect(seriesPicker).toBeHidden()
  await modePicker.press('Enter')
  await modes.getByRole('button', { name: 'Single series' }).click()
  await expect(seriesPicker).toHaveText('Data series: Series B (B)')
  await popup.getByRole('tab', { name: 'Time series data 2', exact: true }).click({ button: 'right' })
  await popup.getByRole('menuitem', { name: 'Move to Main Window', exact: true }).click()
  await expect(graphTab('Time series data 2')).toBeVisible()
  await graphTab('Time series data 2').click()
  await expect(page.getByRole('combobox', { name: 'Data series' })).toHaveValue('B')
  await popup.close()
  await expect(graphTab('Time series graph 2')).toBeVisible()
  await expect(graphTab('Map copy 1')).toHaveCount(0)
  await graphTab('Time series graph 2').click()
  await expect(chart(' 2').getByText('Time series overlay', { exact: true })).toBeVisible()
  cutoff = 'fresh-cutoff'
  const firstReloadRequest = requests.length
  const firstReloadDetail = detailCutoffs.length
  await page.reload()
  for (const name of ['Time series graph', 'Time series data', 'Time series graph 2', 'Time series data 2']) {
    await expect(graphTab(name)).toHaveCount(1)
  }
  await graphTab('Time series graph 2').click()
  await expect(chart(' 2').getByText('Time series overlay', { exact: true })).toBeVisible()
  await expect(chart(' 2').getByRole('textbox', { name: 'Start UTC (inclusive)', exact: true })).toHaveValue(original)
  await graphTab('Time series graph').click()
  await expect(chart().getByRole('textbox', { name: 'Start UTC (inclusive)', exact: true })).toHaveValue('2026-11-20T12:00:00Z')
  await expect.poll(() => requests.slice(firstReloadRequest).map(({ id, cutoff }) => [id, cutoff])).toEqual(
    expect.arrayContaining([['A', 'fresh-cutoff'], ['B', 'fresh-cutoff']]))
  expect(detailCutoffs.slice(firstReloadDetail)).toContain(null)
  expect(detailCutoffs.slice(firstReloadDetail)).not.toContain('graph-cutoff')
  await graphTab('Metadata').click()
  await expect(page.getByRole('checkbox', { name: 'Select Series A', exact: true })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Select Series B', exact: true })).toBeChecked()
})
