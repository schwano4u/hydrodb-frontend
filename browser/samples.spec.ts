import { test, expect, readerPassword, openIdentity, selectView } from './fixtures'
import { readFile } from 'node:fs/promises'
import { parquetReadObjects } from 'hyparquet'

test('offline graph controls are 36 px and fit a narrow viewport', async ({ page }) => {
  const html = await readFile(new URL('../../hydrodb-requirements/docs/frontend/timeseries-graph.html', import.meta.url), 'utf8')
  await page.setViewportSize({ width: 320, height: 640 })
  await page.setContent(html)
  const dataset = page.getByRole('combobox', { name: 'Dataset' })
  await expect(dataset).toHaveCSS('height', '32px')
  expect(await dataset.evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(320)
  await page.getByRole('button', { name: 'Graph settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Graph settings' })
  await expect(dialog.getByRole('combobox', { name: 'Line style' })).toHaveCSS('height', '32px')
  await expect(dialog.getByRole('spinbutton', { name: 'Minimum' })).toHaveCSS('height', '32px')
  await expect(dialog.getByRole('button', { name: 'Apply' })).toHaveCSS('height', '32px')
  const direction = dialog.getByText('Reverse direction', { exact: true })
  const layout = await direction.evaluate((text) => {
    const range = document.createRange()
    range.selectNodeContents(text)
    const caption = range.getBoundingClientRect()
    const checkbox = text.closest('label')!.querySelector('input')!.getBoundingClientRect()
    return {
      lines: range.getClientRects().length,
      viewport: innerWidth,
      gap: caption.left - checkbox.right,
      centerDifference: Math.abs((caption.top + caption.bottom - checkbox.top - checkbox.bottom) / 2),
    }
  })
  expect(layout.lines).toBeLessThanOrEqual(layout.viewport >= 320 ? 1 : 2)
  expect(layout.gap).toBeGreaterThan(0)
  expect(layout.gap).toBeLessThan(12)
  expect(layout.centerDifference).toBeLessThan(3)
  await direction.click()
  await expect(dialog.getByRole('checkbox', { name: 'Reverse direction' })).toBeChecked()
  expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0)
})

test('offline time series legend can collapse and expand without resetting zoom', async ({ page }) => {
  const html = await readFile(new URL('../../hydrodb-requirements/docs/frontend/timeseries-graph.html', import.meta.url), 'utf8')
  await page.setContent(html)
  await page.getByRole('combobox', { name: 'Dataset' }).selectOption('dwd')
  await page.getByRole('button', { name: 'Zoom in' }).click()
  const toggle = page.locator('summary', { hasText: 'Time series legend' })
  const series = page.getByText('Bars span the recorded observation periods.')
  const plot = page.locator('.sample-chart-canvas')
  await expect(series).toBeVisible()
  const legend = page.locator('.sample-legend-disclosure')
  const expandedLegendHeight = (await legend.boundingBox())!.height
  const expandedHeight = (await plot.boundingBox())!.height
  await toggle.press('Enter')
  await expect(series).toBeHidden()
  await expect.poll(async () => (await legend.boundingBox())!.height).toBeLessThan(expandedLegendHeight)
  await expect.poll(async () => (await plot.boundingBox())!.height).toBeGreaterThanOrEqual(expandedHeight)
  await expect(page.getByRole('button', { name: 'Zoom out' })).toBeEnabled()
  await toggle.click()
  await expect(series).toBeVisible()
  await expect(page.getByRole('button', { name: 'Zoom out' })).toBeEnabled()
})

test('offline graph settings apply styling and valid axis bounds without resetting zoom', async ({ page }) => {
  const html = await readFile(new URL('../../hydrodb-requirements/docs/frontend/timeseries-graph.html', import.meta.url), 'utf8')
  await page.setContent(html)
  await page.getByRole('button', { name: 'Zoom in' }).click()
  const open = page.getByRole('button', { name: 'Graph settings' })
  await open.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Graph settings' })
  const min = dialog.getByRole('spinbutton', { name: 'Minimum' })
  const max = dialog.getByRole('spinbutton', { name: 'Maximum' })
  const reverse = dialog.getByRole('checkbox', { name: 'Reverse direction' })
  await expect(reverse).not.toBeChecked()
  await min.fill('500')
  await max.fill('200')
  await dialog.getByRole('button', { name: 'Apply' }).click()
  await expect(dialog.getByRole('alert')).toContainText('minimum less than maximum')
  await min.fill('0')
  await max.fill('600')
  await reverse.check()
  await dialog.getByLabel('Color').fill('#e01a50')
  await dialog.getByRole('spinbutton', { name: 'Line thickness (px)' }).fill('5')
  await dialog.getByLabel('Line style').selectOption('dashed')
  const drawing = await page.evaluateHandle(() => {
    const strokes: { width: number; dash: number[] }[] = []
    const labels: { text: string; y: number }[] = []
    const context = CanvasRenderingContext2D.prototype
    const stroke = context.stroke
    const fillText = context.fillText
    context.stroke = function (path?: Path2D) {
      if (this.strokeStyle === '#e01a50') strokes.push({ width: this.lineWidth, dash: this.getLineDash() })
      if (path) stroke.call(this, path)
      else Reflect.apply(stroke, this, [])
    }
    context.fillText = function (text, x, y, maxWidth) {
      labels.push({ text, y: this.getTransform().transformPoint({ x, y }).y })
      if (maxWidth === undefined) fillText.call(this, text, x, y)
      else fillText.call(this, text, x, y, maxWidth)
    }
    return { strokes, labels }
  })
  await dialog.getByRole('button', { name: 'Apply' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Zoom out' })).toBeEnabled()
  await expect.poll(() => drawing.evaluate(({ strokes, labels }) => ({
    dashed: strokes.some(({ width, dash }) => width === 5 && dash.length > 0),
    reversed: labels.find(({ text }) => text === '0')!.y < labels.find(({ text }) => text === '600')!.y,
  }))).toEqual({ dashed: true, reversed: true })
  await open.click()
  await expect(max).toHaveValue('600')
  await expect(reverse).toBeChecked()
  await dialog.getByRole('button', { name: 'Restore defaults' }).click()
  await open.click()
  await expect(max).toHaveValue('')
  await expect(reverse).not.toBeChecked()
  await expect(dialog.getByLabel('Line style')).toHaveValue('')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await drawing.dispose()
})

test('offline precipitation bars span the recorded periods rather than the cadence', async ({ page }) => {
  const html = await readFile(new URL('../../hydrodb-requirements/docs/frontend/timeseries-graph.html', import.meta.url), 'utf8')
  await page.setContent(html.replace(
    /(<script id="dwd-snapshot" type="application\/json">)([^<]+)(<\/script>)/,
    (_match, open: string, json: string, close: string) => {
      const snapshot = JSON.parse(json)
      const sample = snapshot.readings[0]
      snapshot.readings = [
        { ...sample, period_start: '2026-11-22T12:00:00Z', period_end: '2026-11-22T12:02:00Z',
          timestamp: '2026-11-22T12:02:00Z', value: '2' },
        { ...sample, period_start: '2026-11-22T12:03:00Z', period_end: '2026-11-22T12:07:00Z',
          timestamp: '2026-11-22T12:07:00Z', value: '4' },
      ]
      return open + JSON.stringify(snapshot) + close
    },
  ))
  const bars = await page.evaluateHandle(() => {
    const rectangles: { x: number; y: number; width: number; height: number }[] = []
    const last = new WeakMap<CanvasRenderingContext2D, typeof rectangles[number]>()
    const context = CanvasRenderingContext2D.prototype
    const rect = context.rect
    const fill = context.fill
    context.rect = function (x, y, width, height) {
      last.set(this, { x, y, width, height })
      rect.call(this, x, y, width, height)
    }
    context.fill = function (pathOrRule?: Path2D | CanvasFillRule, rule?: CanvasFillRule) {
      const pending = last.get(this)
      if (pending && this.fillStyle === '#147fa8') rectangles.push(pending)
      last.delete(this)
      if (pathOrRule instanceof Path2D) fill.call(this, pathOrRule, rule)
      else Reflect.apply(fill, this, pathOrRule === undefined ? [] : [pathOrRule])
    }
    return rectangles
  })
  await page.getByRole('combobox', { name: 'Dataset' }).selectOption('dwd')
  await expect.poll(() => bars.evaluate((shapes) => shapes.length)).toBeGreaterThanOrEqual(2)
  const [first, second] = await bars.evaluate((shapes) => shapes.slice(0, 2).sort((a, b) => a.x - b.x))
  expect(first.height).toBeGreaterThan(0)
  expect(second.width / first.width).toBeCloseTo(2)
  expect((second.x - first.x - first.width) / first.width).toBeCloseTo(0.5)
  expect(second.height / first.height).toBeCloseTo(2)
  expect(second.y + second.height).toBeCloseTo(first.y + first.height)
  await bars.dispose()
})

test('offline precipitation overlays the exact sum for complete UTC windows only', async ({ page }) => {
  const html = await readFile(new URL('../../hydrodb-requirements/docs/frontend/timeseries-graph.html', import.meta.url), 'utf8')
  await page.setContent(html.replace(
    /(<script id="dwd-snapshot" type="application\/json">)([^<]+)(<\/script>)/,
    (_match, open: string, json: string, close: string) => {
      const snapshot = JSON.parse(json)
      const sample = snapshot.readings[0]
      const stamp = (minute: number) => new Date(Date.UTC(2026, 10, 22, 12, minute)).toISOString()
      snapshot.readings = [0, 1, 2, 3, 4, 5, 6, 8, 9].map((minute) => ({
        ...sample, period_start: stamp(minute), period_end: stamp(minute + 1),
        timestamp: stamp(minute + 1), value: '0.1',
      }))
      return open + JSON.stringify(snapshot) + close
    },
  ))
  const fills = await page.evaluateHandle(() => {
    const colors: string[] = []
    const context = CanvasRenderingContext2D.prototype
    const fill = context.fill
    context.fill = function (pathOrRule?: Path2D | CanvasFillRule, rule?: CanvasFillRule) {
      if (this.fillStyle === '#147fa8' || this.fillStyle === '#a14413') colors.push(this.fillStyle)
      if (pathOrRule instanceof Path2D) fill.call(this, pathOrRule, rule)
      else Reflect.apply(fill, this, pathOrRule === undefined ? [] : [pathOrRule])
    }
    return colors
  })
  await page.getByRole('combobox', { name: 'Dataset' }).selectOption('dwd')
  await expect(page.getByText(/1 derived 5-minute totals on UTC clock boundaries/)).toBeVisible()
  await expect(page.getByText(/DWD 1-minute observation/)).toBeVisible()
  await expect(page.getByText(/5-minute total \(derived in preview\)/)).toBeVisible()
  const canvas = page.locator('.sample-chart-canvas canvas').first()
  await expect.poll(() => canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) return []
    const pixels = element.getContext('2d')!.getImageData(0, 0, element.width, element.height)
    // Above the one-minute bars, the first five-minute window is painted,
    // and the incomplete second window is empty.
    const pixel = (fraction: number) => {
      const x = Math.round(72 + (element.width - 72 - 24) * fraction)
      const y = Math.round(element.height / 2)
      const i = (y * element.width + x) * 4
      return pixels.data[i]! - pixels.data[i + 2]!
    }
    return [pixel(0.25) > 60, pixel(0.75) > 60]
  })).toEqual([true, false])
  // In the legend the short series comes first. On the canvas the long
  // aggregate is drawn first so the short bars remain on top.
  await expect.poll(() => fills.evaluate((colors) => colors.slice(0, 2))).toEqual(['#a14413', '#147fa8'])
  await fills.dispose()
})

test('scientific viewer charts scalar and vector interval samples, pins history and cancels stale reads', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const start = '2026-11-20T00:00:00.000001Z'
  const end = '2026-11-21T00:00:00Z'
  const definition = {
    series_id: 'scalar-A', series_name: 'Fixture scalar series', series_description: 'River level observation', series_metadata_version: '1',
    series_validity_start: start, series_value_shape: 'scalar', series_value_statistic: 'instantaneous',
    series_processing_level: 'raw', series_sampling_definition: { kind: 'equidistant' },
    series_sampling_interval: 'PT1S', series_period_definition: null, series_timestamp_position: null,
    unit_id: 'unit-m', unit_metadata_version: '9223372036854775807',
    quality_codebook_id: 'quality', quality_codebook_metadata_version: '1',
    resolved_definitions: {
      unit: { unit_id: 'unit-m', unit_metadata_version: '9223372036854775807', unit_symbol: 'm' },
      quality_codebook: { quality_codebook_id: 'quality', quality_codebook_metadata_version: '1',
        quality_codebook_entries: [{ code: 255, state: 'valid', meaning: 'Original accepted value' }, { code: 0, state: 'missing', meaning: 'Original missing value' }] },
    },
    scientific_context: { processing: { inputs: [] } },
  }
  const node = { collection: 'series', status: 'active', position_scope: 'unavailable', references: [], item: definition }
  const second = { ...definition, series_id: 'scalar-B', series_name: 'Fixture temperature', unit_id: 'unit-degC',
    resolved_definitions: { ...definition.resolved_definitions,
      unit: { ...definition.resolved_definitions.unit, unit_id: 'unit-degC', unit_symbol: 'degC' } } }
  const samples = Array.from({ length: 101 }, (_, index) => ({
    timestamp: `2026-11-20T00:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000001Z`,
    revision_no: 1, series_metadata_version: 1,
    state: index === 1 ? 'missing' : 'valid', value: index === 1 ? null : index / 10, detection_bound: null,
    quality_code: index === 1 ? 0 : 255, quality_codebook_id: 'quality', quality_codebook_metadata_version: 1,
    period_start: null, period_end: null, occurrence: null,
    source: { record_id: `source-${index}`, revision: '9223372036854775807' },
    interpretation: { original: definition },
  }))
  const vectorDefinition = {
    ...definition, series_value_shape: 'vector2', series_value_statistic: 'maximum', series_processing_level: 'aggregated',
    series_timestamp_position: 'end', series_period_definition: { kind: 'calendar', method: { kind: 'component_wise' } },
    series_calendar_definition: { time_zone: 'Europe/Berlin' },
    scientific_context: { vector: { reference_frame: 'ENU', axes: [{ axis: 'x', meaning: 'East' }, { axis: 'y', meaning: 'North' }] },
      processing: { inputs: [{ series_id: 'provider', series_metadata_version: 1 }] } },
  }
  const periodStart = '2026-11-19T00:00:00.000001Z'
  const occurrence = '2026-11-19T03:30:00.000001Z'
  const vectorSample = { ...samples[0]!, value: [0, 2], period_start: periodStart, period_end: start,
    occurrence, coverage: 0.75, status: 'partial', stale: true,
    interpretation: { original: vectorDefinition } }
  let scientific = false
  let multi = false
  let unauthorized = false
  let delay = false
  let release: (() => void) | undefined
  const requests: { url: URL; method: string }[] = []
  await page.route('**/api/v1/metadata/browser?**', async (route) => {
    const url = new URL(route.request().url()); requests.push({ url, method: route.request().method() })
    const cutoff = url.searchParams.get('read_cutoff') ?? (url.searchParams.has('as_of') ? 'asof-cutoff' : 'refreshed-cutoff')
    const secondSeries = multi && (url.searchParams.get('id') === second.series_id || url.searchParams.get('page') === '2')
    const item = secondSeries ? second : scientific ? vectorDefinition : definition
    const selectedFirst = url.searchParams.get('selected_first')
    const rows = multi && selectedFirst && url.searchParams.get('page') === '1'
      ? [definition, second, ...Array.from({ length: 8 }, (_, i) => ({ ...definition, series_id: `extra-${i}`, series_name: `Extra series ${i}` }))]
      : multi && url.searchParams.get('page') === '1' && url.searchParams.get('limit') === '10'
      ? [item, ...Array.from({ length: 9 }, (_, i) => ({ ...item, series_id: `extra-${i}`, series_name: `Extra series ${i}` }))]
      : [item]
    const mode = url.searchParams.get('mode')
    const station = multi && url.searchParams.get('collection') === 'stations'
    const items = station && mode === 'branches'
      ? [{ path: [node] }, { path: [{ ...node, item: second }] }]
      : mode && mode !== 'detail' ? []
        : station ? [{ ...node, collection: 'stations', item: {
          station_id: 'station-A', station_name: 'Fixture station', station_metadata_version: '1', station_validity_start: start,
        } }] : rows.map((item) => ({ ...node, item }))
    await route.fulfill({ json: {
      items, next_after: null, total: multi && !station ? 11 : 1, read_cutoff: cutoff,
    } })
  })
  await page.route('**/api/v1/series/*/samples?**', async (route) => {
    const url = new URL(route.request().url()); requests.push({ url, method: route.request().method() })
    if (delay) await new Promise<void>((resolve) => { release = resolve })
    if (unauthorized) {
      await route.fulfill({ status: 403, json: { code: 'INSUFFICIENT_CAPABILITY', message: 'Denied', request_id: null } })
      return
    }
    const secondSeries = url.pathname.includes(`/${second.series_id}/`)
    const source = secondSeries ? [{ ...samples[0]!, value: 17.34, interpretation: { original: second } }]
      : scientific ? [vectorSample] : samples
    const from = Date.parse(url.searchParams.get('start')!)
    const to = Date.parse(url.searchParams.get('end')!)
    const all = source.filter(({ timestamp }) => Date.parse(timestamp) >= from && Date.parse(timestamp) < to)
    const offset = url.searchParams.has('after') ? all.findIndex((sample) => sample.timestamp === url.searchParams.get('after')) + 1 : 0
    const size = Number(url.searchParams.get('limit'))
    const items = all.slice(offset, offset + size)
    await route.fulfill({ json: {
      series_id: secondSeries ? second.series_id : definition.series_id,
      start: url.searchParams.get('start'), end: url.searchParams.get('end'), selection: 'primary',
      items, next_after: offset + size < all.length ? items.at(-1)!.timestamp : null, read_cutoff: url.searchParams.get('read_cutoff'),
    } })
  })
  await page.goto('/')
  await page.clock.setFixedTime(new Date(end))
  await openIdentity(page)
  await page.getByLabel('Username', { exact: true }).fill('browser-test-reader')
  await page.getByLabel('Password', { exact: true }).fill(await readerPassword())
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await selectView(page, 'Metadata')
  const metadata = page.getByRole('article', { name: 'Metadata browser', exact: true })
  await metadata.getByRole('checkbox', { name: 'Select Fixture scalar series', exact: true }).check()
  await metadata.getByRole('button', { name: 'Open visualization', exact: true }).click()
  const chart = page.getByRole('article', { name: 'Time series graph', exact: true })
  const data = page.getByRole('article', { name: 'Time series data', exact: true })
  const dataTab = page.getByRole('tab', { name: 'Time series data', exact: true }).locator('.dv-default-tab-content')
  const chartTab = page.getByRole('tab', { name: 'Time series graph', exact: true }).locator('.dv-default-tab-content')
  await expect(dataTab).toHaveCount(1)
  await expect(chart.getByRole('figure')).toHaveAccessibleName('Fixture scalar series — River level observation')
  const sampleRequests = () => requests.filter(({ url }) => url.pathname.includes('/samples'))
  expect(sampleRequests()).toHaveLength(2)
  expect(sampleRequests()[0]?.url.searchParams.get('start')).toBe('2026-11-20T00:00:00.000Z')
  await chart.getByRole('button', { name: 'Moving week', exact: true }).click()
  await expect(chart.getByRole('figure')).toHaveAccessibleName('Fixture scalar series — River level observation')
  expect(sampleRequests()).toHaveLength(4)
  expect(sampleRequests()[2]?.url.searchParams.get('start')).toBe('2026-11-14T00:00:00.000Z')
  requests.length = 0
  await chart.getByLabel('Start UTC (inclusive)').fill(start)
  await chart.getByLabel('End UTC (exclusive)').fill(end)
  const period = chart.getByRole('group', { name: 'View period' })
  const reload = chart.getByRole('button', { name: 'Reload samples', exact: true })
  await expect(period.getByRole('button')).toHaveText(['Moving month', 'Moving week', 'Moving day'])
  const left = (await period.boundingBox())!
  const right = (await reload.boundingBox())!
  expect(right.x).toBeGreaterThan(left.x + left.width)
  expect(right.y).toBeCloseTo(left.y, 0)
  await reload.focus()
  await page.keyboard.press('Enter')
  await expect(chart.getByRole('figure')).toHaveAccessibleName('Fixture scalar series — River level observation')
  await expect.poll(() => chart.locator('.sample-chart canvas').evaluateAll((canvases) => canvases.some((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement) || !canvas.width || !canvas.height) return false
    const context = canvas.getContext('2d')
    return context !== null && context.getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0)
  }))).toBe(true)
  const initialRequests = requests.filter(({ url }) => url.pathname.includes('/samples'))
  expect(initialRequests).toHaveLength(2)
  expect(initialRequests.every(({ url, method }) => method === 'GET' && url.searchParams.get('interpretation') === 'original' &&
    url.searchParams.get('read_cutoff') === 'refreshed-cutoff' && !url.searchParams.has('as_of'))).toBe(true)
  const graph = chart.locator('.sample-chart')
  const heightMismatch = () => graph.evaluate((element) => {
    const panel = element.closest('article')!
    const graphBounds = element.getBoundingClientRect()
    const availableHeight = panel.getBoundingClientRect().bottom - parseFloat(getComputedStyle(panel).paddingBottom) - graphBounds.top
    return graphBounds.height - Math.max(availableHeight, parseFloat(getComputedStyle(element).minHeight))
  })
  await expect.poll(heightMismatch).toBeCloseTo(0, 0)
  if (testInfo.project.metadata.zoom !== 2) {
    const initialHeight = (await graph.boundingBox())!.height
    const viewport = await page.evaluate(() => ({ width: window.outerWidth, height: window.outerHeight }))
    await page.setViewportSize({ width: viewport.width, height: viewport.height + 320 })
    await expect.poll(async () => (await graph.boundingBox())!.height).toBeGreaterThan(initialHeight + 50)
    await expect.poll(heightMismatch).toBeCloseTo(0, 0)
    await expect.poll(() => graph.locator('canvas').first().evaluate((canvas) =>
      canvas.getBoundingClientRect().height - canvas.closest('.sample-chart')!.getBoundingClientRect().height)).toBeCloseTo(0, 0)
    expect(requests.filter(({ url }) => url.pathname.includes('/samples'))).toHaveLength(2)
  }
  await dataTab.click()
  await expect(data.getByRole('combobox', { name: 'Data series', exact: true })).toHaveValue('scalar-A')
  await expect(data.getByRole('textbox')).toHaveCount(0)
  await expect(data.getByRole('heading')).toHaveCount(0)
  await expect(data.getByLabel('Rows per page')).toHaveValue('25')
  await expect(data.locator('tbody tr')).toHaveCount(25)
  await expect(data.locator('tbody tr').first()).toContainText(start)
  const missingQuality = data.locator('tbody tr').nth(1).getByRole('cell', { name: '0', exact: true })
  await expect(missingQuality).toHaveText('0')
  await expect(missingQuality).toHaveAttribute('title', 'Original missing value\nquality / v1')
  await expect(data.locator('tbody tr').first().getByRole('cell', { name: '0 m', exact: true }))
    .toHaveAttribute('title', 'm / unit-m / v9223372036854775807')
  await expect(data.getByRole('columnheader', { name: /Unit/ })).toHaveCount(0)
  const paging = data.getByRole('navigation', { name: 'Sample pagination' })
  const tableRegion = data.getByRole('region', { name: 'Exact sample table' })
  const columnHeader = tableRegion.getByRole('columnheader').first()
  const tableMode = data.getByRole('combobox', { name: 'Table mode' })
  const headerPositions = async () => Promise.all([tableMode, paging, columnHeader].map(async (element) => (await element.boundingBox())!.y))
  const [modeY, pagingY] = await headerPositions()
  const firstRow = tableRegion.locator('tbody tr').first()
  const firstRowY = (await firstRow.boundingBox())!.y
  await tableRegion.focus()
  await page.keyboard.press('End')
  await expect.poll(async () => (await firstRow.boundingBox())!.y).toBeLessThan(firstRowY)
  const [scrolledModeY, scrolledPagingY, scrolledColumnY] = await headerPositions()
  expect(scrolledModeY).toBe(modeY)
  expect(scrolledPagingY).toBe(pagingY)
  expect(scrolledColumnY).toBeCloseTo((await tableRegion.boundingBox())!.y, 0)
  await expect(columnHeader).toBeInViewport()
  await paging.getByRole('button', { name: 'Last page', exact: true }).click()
  await expect(data.locator('tbody tr')).toHaveCount(1)
  await expect(paging.getByRole('status')).toHaveText('Page 5 / 5')
  expect(requests.filter(({ url }) => url.pathname.includes('/samples'))).toHaveLength(2)
  await chartTab.click()
  unauthorized = true
  await reload.click()
  await expect(chart.getByRole('alert')).toContainText('not permitted')
  unauthorized = false
  scientific = true
  await reload.click()
  await dataTab.click()
  const vectorRow = data.locator('tbody tr')
  await expect(vectorRow).toHaveCount(1)
  await expect(vectorRow).not.toContainText(occurrence)
  await data.getByRole('button', { name: 'Columns', exact: true }).click()
  await data.getByRole('checkbox', { name: 'Occurrence time (UTC)', exact: true }).check()
  await page.keyboard.press('Escape')
  await expect(vectorRow).toContainText(occurrence)
  await expect(vectorRow).toContainText('x: 0; y: 2')
  await expect(vectorRow).toContainText(periodStart)
  const revision = vectorRow.getByRole('cell', { name: '1', exact: true })
  await expect(revision).toHaveText('1')
  await expect(revision).toHaveAttribute('title', /Series v1[\s\S]*Source and lineage[\s\S]*Reported aggregate evidence[\s\S]*"status": "partial"/)
  await chartTab.click()
  const east = chart.getByRole('checkbox', { name: /x: East/ })
  const westTracePixels = () => chart.locator('canvas').evaluateAll((canvases) => canvases.some((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement) || !canvas.width || !canvas.height) return false
    return canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data.some(
      (value, index, pixels) => index % 4 === 0 && value === 20 && pixels[index + 1] === 127 && pixels[index + 2] === 168)
  }))
  await expect.poll(westTracePixels).toBe(true)
  await east.focus()
  await page.keyboard.press('Space')
  await expect(east).not.toBeChecked()
  await expect.poll(westTracePixels).toBe(false)
  scientific = false
  delay = true
  await reload.click()
  await expect.poll(() => Boolean(release)).toBe(true)
  await chart.getByLabel('End UTC (exclusive)').fill(start)
  release!()
  await chart.getByLabel('End UTC (exclusive)').blur()
  await expect(chart.getByRole('alert')).toContainText('End must be after start')
  await dataTab.click()
  await expect(data.getByRole('table')).toHaveCount(0)
  const saved = await page.evaluate(() => Object.values(localStorage).join(''))
  expect(saved).not.toContain(start)
  expect(saved).not.toContain('source-')
  await page.reload()
  await page.getByRole('tab', { name: 'Time series graph', exact: true }).click()
  await expect(chart).toContainText('then choose Open visualization')

  multi = true
  delay = false
  await selectView(page, 'Metadata')
  await metadata.getByRole('button', { name: 'Reload', exact: true }).click()
  const pagingTable = metadata.getByRole('navigation', { name: 'Table pagination' })
  await pagingTable.getByRole('combobox').selectOption('10')
  const a = metadata.getByRole('checkbox', { name: 'Select Fixture scalar series', exact: true })
  const table = metadata.getByRole('table')
  const measureColumns = () => table.evaluate(async (element) => {
    const available = element.parentElement!.getBoundingClientRect().width
    const firstWidths = Array.from(element.querySelectorAll('thead th'), (cell) => cell.getBoundingClientRect().width)
    let maxOverflow = 0
    let maxDrift = 0
    for (let frame = 0; frame < 20; frame++) {
      await new Promise(requestAnimationFrame)
      maxOverflow = Math.max(maxOverflow, Math.abs(element.getBoundingClientRect().width - available))
      element.querySelectorAll('thead th').forEach((cell, i) => {
        maxDrift = Math.max(maxDrift, Math.abs(cell.getBoundingClientRect().width - firstWidths[i]!))
      })
    }
    return { maxOverflow, maxDrift, selection: firstWidths[0], label: firstWidths[1] }
  })
  const separator = table.getByRole('separator', { name: /Name \/ stable ID/ })
  await expect(separator).toBeVisible()
  const initial = await measureColumns()
  expect(initial.maxOverflow).toBeLessThan(2)
  expect(initial.maxDrift).toBeLessThan(1)
  await separator.press('ArrowRight')
  const resized = await measureColumns()
  expect(resized.maxOverflow).toBeLessThan(2)
  expect(resized.maxDrift).toBeLessThan(1)
  expect(resized.selection).toBeCloseTo(initial.selection!, 0)
  expect(resized.label).toBeGreaterThan(initial.label!)
  await a.scrollIntoViewIfNeeded()
  const unselectedTable = (await table.boundingBox())!
  const toolbar = metadata.getByRole('region', { name: 'Floating Selection Toolbar' })
  await a.check()
  await expect(toolbar).toBeVisible()
  const selectedTable = (await table.boundingBox())!
  expect(selectedTable.y).toBeCloseTo(unselectedTable.y, 0)
  expect(selectedTable.height).toBeCloseTo(unselectedTable.height, 0)
  const measureOverlay = () => toolbar.evaluate((element) => {
    const panel = element.closest('article')!
    const bounds = element.getBoundingClientRect()
    const tableBounds = element.closest('.metadata-table-frame')!.querySelector('table')!.getBoundingClientRect()
    const panelBottom = panel.getBoundingClientRect().top + panel.clientTop + panel.clientHeight
    return {
      clipped: tableBounds.bottom > panelBottom,
      gap: Math.min(tableBounds.bottom, panelBottom) - bounds.bottom,
      centerOffset: bounds.left + bounds.width / 2 - tableBounds.left - tableBounds.width / 2,
    }
  })
  expect(await measureOverlay()).toMatchObject({ clipped: true, gap: expect.closeTo(40, 0), centerOffset: expect.closeTo(0, 0) })
  await metadata.evaluate((element) => { element.scrollTop += 80 })
  expect(await measureOverlay()).toMatchObject({ gap: expect.closeTo(40, 0) })
  await selectView(page, 'Tree view')
  const tree = page.getByRole('article', { name: 'Tree view', exact: true })
  await tree.getByRole('button', { name: 'Expand Fixture station / station-A', exact: true }).click()
  await expect(tree.getByRole('checkbox', { name: 'Select Fixture scalar series', exact: true })).toBeChecked()
  await tree.getByRole('checkbox', { name: 'Select Fixture temperature', exact: true }).check()
  await expect(tree.getByRole('region', { name: 'Floating Selection Toolbar' })).toContainText('2 of 8 series selected')
  await selectView(page, 'Metadata')
  await pagingTable.getByRole('button', { name: 'Next page', exact: true }).click()
  await expect(metadata.getByRole('checkbox', { name: 'Select Fixture temperature', exact: true })).toBeChecked()
  await metadata.evaluate((element) => { element.scrollTop = element.scrollHeight })
  expect(await measureOverlay()).toMatchObject({ clipped: false, gap: expect.closeTo(40, 0) })
  const selectSort = table.getByRole('button', { name: 'Select', exact: true })
  await selectSort.click()
  await expect(pagingTable.getByRole('status')).toHaveText('Page 1 / 2')
  await expect(selectSort).toHaveAttribute('aria-pressed', 'true')
  await expect(table.locator('tbody tr').nth(0).getByRole('checkbox')).toBeChecked()
  await expect(table.locator('tbody tr').nth(1).getByRole('checkbox', { name: 'Select Fixture temperature' })).toBeChecked()
  await expect(table.locator('tbody tr').nth(2).getByRole('checkbox')).not.toBeChecked()
  const sortedRequest = requests.find(({ url }) => url.searchParams.has('selected_first'))
  expect(sortedRequest?.url.searchParams.get('selected_first')).toBe('["scalar-A","scalar-B"]')
  await selectSort.click()
  await expect(selectSort).toHaveAttribute('aria-pressed', 'false')
  await expect(table.getByRole('checkbox', { name: 'Select Fixture temperature' })).toHaveCount(0)
  await expect(a).toBeChecked()
  const scrollTableIntoPanel = () => table.evaluate((element) => {
    const panel = element.closest('article')!
    panel.scrollTop += element.getBoundingClientRect().top - panel.getBoundingClientRect().top
  })
  await scrollTableIntoPanel()
  await expect(toolbar).toContainText('2 of 8 series selected')
  const graphButton = toolbar.getByRole('button', { name: 'Open visualization', exact: true })
  const downloadButton = toolbar.getByRole('button', { name: 'Download samples', exact: true })
  const clearButton = toolbar.getByRole('button', { name: 'Clear', exact: true })
  await expect(clearButton).toHaveCSS('height', '32px')
  for (const button of [graphButton, downloadButton]) {
    await expect(button).toHaveText('')
    await expect(button.locator('svg')).toBeVisible()
  }
  await graphButton.click({ timeout: 5000 })
  await expect(chart.getByRole('figure')).toHaveAccessibleName('Time series overlay')
  await chart.getByLabel('Start UTC (inclusive)').fill(start)
  await chart.getByLabel('End UTC (exclusive)').fill('2026-11-20T00:05:00Z')
  await reload.click()
  await expect(chart.getByRole('figure')).toHaveAccessibleName('Time series overlay')
  await expect(chart.getByText(/Fixture scalar series \(scalar-A\)/)).toBeVisible()
  await expect(chart.getByText(/Fixture temperature \(scalar-B\)/)).toBeVisible()
  await expect(chart.locator('.sample-chart')).toHaveCount(1)
  await expect.poll(() => chart.locator('canvas').evaluateAll((canvases) => {
    const colors = new Set<number>()
    for (const canvas of canvases) {
      if (!(canvas instanceof HTMLCanvasElement) || !canvas.width || !canvas.height) continue
      const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data
      if (!pixels) continue
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] !== 255) continue
        const rgb = pixels[i]! * 65536 + pixels[i + 1]! * 256 + pixels[i + 2]!
        if (rgb === 0x147fa8 || rgb === 0xa14413) colors.add(rgb)
      }
    }
    return colors.size
  })).toBe(2)
  const settingsReadCount = sampleRequests().length
  const settings = chart.getByRole('button', { name: 'Graph settings' })
  await settings.click()
  const graphSettings = chart.getByRole('dialog', { name: 'Graph settings' })
  const waterAxis = graphSettings.getByRole('group', { name: /Y-axis 1 — m/ })
  const temperatureAxis = graphSettings.getByRole('group', { name: /Y-axis 2 — degC/ })
  await waterAxis.getByRole('spinbutton', { name: 'Minimum' }).fill('0')
  await temperatureAxis.getByRole('spinbutton', { name: 'Minimum' }).fill('10')
  await graphSettings.getByRole('button', { name: 'Apply' }).click()
  await settings.click()
  await expect(waterAxis.getByRole('spinbutton', { name: 'Minimum' })).toHaveValue('0')
  await expect(temperatureAxis.getByRole('spinbutton', { name: 'Minimum' })).toHaveValue('10')
  await graphSettings.getByRole('button', { name: 'Cancel' }).click()
  expect(sampleRequests()).toHaveLength(settingsReadCount)
  await dataTab.click()
  await data.getByRole('combobox', { name: 'Data series', exact: true }).selectOption('scalar-B')
  await expect(data.locator('tbody tr')).toContainText('17.34')
  const readCount = sampleRequests().length
  await data.getByRole('combobox', { name: 'Table mode' }).selectOption('aligned')
  const aligned = data.getByRole('region', { name: 'Aligned sample table' })
  await expect(data.getByLabel('Rows per page')).toHaveValue('25')
  await expect(aligned.locator('tbody tr')).toHaveCount(25)
  await expect(aligned.getByRole('columnheader')).toHaveText(['Timestamp (UTC)', 'Fixture scalar series', 'Fixture temperature'])
  await expect(aligned.getByRole('row').nth(1).getByRole('cell')).toHaveText(['0 m', '17.34 degC'])
  await expect(aligned.getByRole('row').nth(2).getByRole('cell')).toHaveText(['Missing', 'No sample'])
  expect(sampleRequests()).toHaveLength(readCount)
  await selectView(page, 'Metadata')
  await scrollTableIntoPanel()
  await downloadButton.click({ timeout: 5000 })
  const download = page.getByRole('dialog', { name: 'Download selected samples' })
  await download.getByLabel('Start UTC (inclusive)').fill(start)
  await download.getByLabel('End UTC (exclusive)').fill(end)
  await download.getByLabel('Format').selectOption('parquet')
  const file = page.waitForEvent('download')
  await download.getByRole('button', { name: 'Download', exact: true }).click()
  const savedFile = await file
  expect(savedFile.suggestedFilename()).toBe('hydrodb-samples.parquet')
  const bytes = Uint8Array.from(await readFile(await savedFile.path()))
  const rows = await parquetReadObjects({ file: bytes.buffer })
  expect(rows).toHaveLength(102)
  expect(rows.at(-1)).toMatchObject({ series_id: 'scalar-B', timestamp: start, unit: 'degC', value: '17.34' })
  await toolbar.getByRole('button', { name: 'Series', exact: true }).press('Enter')
  const selectedSeries = toolbar.getByRole('dialog', { name: 'Selected series' })
  await expect(selectedSeries.getByRole('listitem')).toHaveText([
    'Fixture scalar series (scalar-A)Remove', 'Fixture temperature (scalar-B)Remove',
  ])
  for (const button of await selectedSeries.getByRole('button').all()) {
    await expect(button).toHaveCSS('height', '32px')
  }
  await selectedSeries.getByRole('button', { name: 'Remove Fixture temperature (scalar-B) from selection' }).click()
  await expect(selectedSeries).toBeVisible()
  await expect(selectedSeries.getByRole('listitem')).toHaveCount(1)
  await expect(toolbar).toContainText('1 of 8 series selected')
  await selectedSeries.getByRole('button', { name: 'Close', exact: true }).click()
  await clearButton.click()
  await expect(toolbar).toHaveCount(0)
  expect(errors).toEqual([])
})
