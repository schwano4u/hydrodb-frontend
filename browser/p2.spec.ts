import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { parquetReadObjects } from 'hyparquet'
import { test, expect, readerPassword, openIdentity, selectView } from './fixtures'
import { entities } from '../src/metadata'
import type { Collection } from '../src/metadata'

async function login(page: Page) {
  await page.goto('/')
  await openIdentity(page)
  await page.getByLabel('Username', { exact: true }).fill('browser-test-reader')
  await page.getByLabel('Password', { exact: true }).fill(await readerPassword())
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Read-only workspace', exact: true })).toBeVisible()
  await selectView(page, 'Metadata')
  const browser = page.getByRole('article', { name: 'Metadata browser', exact: true })
  await expect(browser.getByRole('heading', { name: 'Metadata browser', exact: true })).toHaveCount(0)
  await expect(browser.getByLabel('Search names / IDs', { exact: true })).toHaveCount(0)
  await expect(browser.getByLabel('As-of UTC (blank for current)', { exact: true })).toHaveCount(0)
  await expect(browser.getByRole('heading', { name: 'Active selections', exact: true })).toHaveCount(0)
  await expect(browser.getByText('No attribute filters. All authorized metadata is available in bounded pages.', { exact: true })).toHaveCount(0)
  await expect(browser.getByLabel('Instance type', { exact: true })).toBeVisible()
  await expect(browser.getByRole('button', { name: 'Reload', exact: true })).toHaveText('')
  await expect(browser.getByRole('button', { name: 'Reload', exact: true }).locator('svg')).toHaveCount(1)
  const reload = browser.getByRole('button', { name: 'Reload', exact: true }).locator('svg')
  await expect(reload).toHaveClass('reload-icon')
  await expect(reload.locator('path')).toHaveCount(4)
  await expect(reload).toHaveCSS('stroke-width', '2px')
  return browser
}

  test('table downloads include all matching pages as CSV, JSON and readable Parquet', async ({ page }, testInfo) => {
    const requests: URL[] = []
    await page.route('**/api/v1/metadata/browser?**', async (route) => {
      const query = new URL(route.request().url())
      requests.push(query)
      if (query.searchParams.get('mode') === 'values') {
        await route.fulfill({ json: { items: [], next_after: null, read_cutoff: 'export-cutoff', total: 0 } })
        return
      }
      const last = query.searchParams.get('after') === 'next'
      const second = query.searchParams.get('order') === 'desc' ? !last : last
      await route.fulfill({ json: {
        items: [{ collection: 'series', status: 'active', position_scope: 'unavailable', references: [],
          item: { series_id: second ? 'row-2' : 'row-1', series_name: second ? 'Zulu' : '=Formula, "quoted"',
            series_metadata_version: '9223372036854775807', series_validity_start: '2026-11-20T12:00:00.123456Z',
            series_sampling_definition: { exact: '9223372036854775807', nested: [null, true] } } }],
        next_after: last ? null : 'next', read_cutoff: 'export-cutoff', total: 2,
      } })
    })
    const browser = await login(page)
    await expect(browser.locator('tbody tr')).toHaveCount(1)
    await expect(browser.getByText('of 2 total rows', { exact: true })).toBeVisible()
    await expect(browser.getByText('Read context', { exact: true })).toHaveCount(0)
    const toolbar = browser.locator('.metadata-toolbar')
    const toolbarBounds = (await toolbar.boundingBox())!
    const instanceBounds = (await browser.getByLabel('Instance type', { exact: true }).boundingBox())!
    const columnsBounds = (await browser.getByRole('button', { name: 'Columns', exact: true }).boundingBox())!
    const reloadBounds = (await browser.getByRole('button', { name: 'Reload', exact: true }).boundingBox())!
    const downloadBounds = (await browser.getByRole('button', { name: 'Download table', exact: true }).boundingBox())!
    for (const bounds of [instanceBounds, columnsBounds, reloadBounds, downloadBounds]) {
      expect(bounds.height).toBeCloseTo(36, 1)
    }
    for (const icon of await toolbar.locator('.metadata-reload svg').all()) {
      await expect(icon).toHaveCSS('width', '24px')
      await expect(icon).toHaveCSS('height', '24px')
    }
    await expect(browser.getByRole('button', { name: 'Columns', exact: true }).locator('svg')).toHaveCSS('height', '16px')
    await expect(browser.locator('.metadata-pagination select')).toHaveCSS('height', '36px')
    for (const button of await browser.locator('.metadata-page-navigation button').all()) {
      await expect(button).toHaveCSS('height', '36px')
      await expect(button.locator('svg')).toHaveCSS('height', '24px')
    }
    const selectorStyle = await browser.getByLabel('Instance type', { exact: true }).evaluate((element) => {
      const style = getComputedStyle(element)
      return [style.backgroundColor, style.borderColor, style.borderRadius]
    })
    const buttonStyle = await browser.getByRole('button', { name: 'Columns', exact: true }).evaluate((element) => {
      const style = getComputedStyle(element)
      return [style.backgroundColor, style.borderColor, style.borderRadius]
    })
    expect(selectorStyle).toEqual(buttonStyle)
    expect(Math.abs(downloadBounds.x + downloadBounds.width - toolbarBounds.x - toolbarBounds.width)).toBeLessThanOrEqual(1)
    if (toolbarBounds.width >= 600) {
      const centers = [instanceBounds, columnsBounds, reloadBounds, downloadBounds].map((bounds) => bounds.y + bounds.height / 2)
      expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(1)
      expect(columnsBounds.x).toBeGreaterThanOrEqual(instanceBounds.x + instanceBounds.width)
    }
    const paging = browser.getByRole('button', { name: 'Next page', exact: true })
    expect((await paging.boundingBox())!.y).toBeLessThan((await browser.locator('table').boundingBox())!.y)
    const columnWidths = () => browser.locator('thead th').evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect().width))
    const tableWidth = (await browser.locator('table').boundingBox())!.width
    expect(tableWidth).toBeCloseTo((await browser.locator('.metadata-table-scroll').boundingBox())!.width, 0)
    const before = await columnWidths()
    const middle = browser.getByRole('separator', { name: 'Resize station id' })
    await middle.press('ArrowRight')
    const after = await columnWidths()
    expect(after[0]).toBeCloseTo(before[0]!, 0)
    expect(after[1]! - before[1]!).toBeCloseTo(10, 0)
    for (let index = 2; index < before.length; index++) {
      expect(after[index]! / before[index]!).toBeCloseTo(after[2]! / before[2]!, 2)
    }
    expect((await browser.locator('table').boundingBox())!.width).toBeCloseTo(tableWidth, 0)
    await expect(browser.getByRole('separator', { name: 'Resize series sampling definition' })).toHaveCount(0)
    await browser.getByRole('button', { name: 'Columns', exact: true }).click()
    await expect(browser.getByRole('dialog', { name: 'Columns', exact: true })).toBeVisible()
    await expect(browser.getByRole('dialog', { name: 'Columns', exact: true }).getByRole('slider')).toHaveCount(0)
    for (const field of ['station id', 'parameter id', 'unit id', 'series processing level', 'series value shape', 'series value statistic']) {
      await browser.getByLabel(field, { exact: true }).uncheck()
    }
    await expect(browser.locator('thead th')).toHaveCount(2)
    await browser.getByRole('button', { name: 'Columns', exact: true }).click()
    const resize = browser.getByRole('separator', { name: 'Resize Name / stable ID' })
    const initialWidth = (await browser.locator('thead th').first().boundingBox())!.width
    await resize.focus()
    await resize.press('ArrowRight')
    expect((await browser.locator('thead th').first().boundingBox())!.width - initialWidth).toBeCloseTo(10, 0)
    const bounds = await resize.boundingBox()
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
    await page.mouse.down()
    await page.mouse.move(bounds!.x + bounds!.width / 2 + 20, bounds!.y + bounds!.height / 2, { steps: 5 })
    await page.mouse.up()
    await expect.poll(async () => (await browser.locator('thead th').first().boundingBox())!.width - initialWidth).toBeCloseTo(30, 0)
    expect((await browser.locator('table').boundingBox())!.width).toBeCloseTo(tableWidth, 0)
    const nameSort = browser.getByRole('button', { name: 'Name / stable ID', exact: true })
    await nameSort.click()
    await expect(browser.locator('thead th').first()).toHaveAttribute('aria-sort', 'ascending')
    await nameSort.click()
    await expect(browser.locator('thead th').first()).toHaveAttribute('aria-sort', 'descending')
    await expect(browser.locator('tbody tr').first()).toContainText('row-2')
    for (const format of ['CSV', 'JSON', 'PARQUET']) {
      await browser.getByRole('button', { name: 'Download table', exact: true }).click()
      const downloading = page.waitForEvent('download')
      await browser.getByRole('button', { name: format, exact: true }).click()
      const download = await downloading
      expect(download.suggestedFilename()).toBe(`hydrodb-series.${format.toLowerCase()}`)
      const path = await download.path()
      if (!path) throw new Error('Browser download has no file')
      const data = await readFile(path)
      if (format === 'CSV') {
        expect(data.toString()).toContain(`"'=Formula, ""quoted""","row-1"`)
        expect(data.toString()).toContain('"row-2"')
      } else if (format === 'JSON') {
        const json = JSON.parse(data.toString())
        expect(json.rows.map((row: { id: string }) => row.id)).toEqual(['row-2', 'row-1'])
        expect(json.read_cutoff).toBe('export-cutoff')
        expect(json.columns).toEqual(['name', 'id', 'series_sampling_definition'])
      } else {
        const file = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
        const rows = await parquetReadObjects({ file })
        expect(rows.map((row) => row.id)).toEqual(['row-2', 'row-1'])
        expect(Object.keys(rows[0]!)).toEqual(['name', 'id', 'series_sampling_definition'])
        expect(rows[0]?.series_sampling_definition).toBe('{"exact":"9223372036854775807","nested":[null,true]}')
      }
      await expect(browser.getByText('Download prepared for all matching rows.', { exact: true })).toHaveText('Download prepared for all matching rows.')
      await download.delete()
    }
    expect(requests.filter((url) => !url.searchParams.has('read_cutoff'))).toHaveLength(1)
    expect(requests.filter((url) => url.searchParams.has('read_cutoff')).every((url) =>
      url.searchParams.get('read_cutoff') === 'export-cutoff')).toBe(true)
    expect(requests.some((url) => url.searchParams.get('after') === 'next' &&
      url.searchParams.get('sort') === 'name' && url.searchParams.get('order') === 'desc')).toBe(true)
    const proportions = await columnWidths()
    await page.setViewportSize({ width: 480 * Number(testInfo.project.metadata.zoom ?? 1), height: 1000 })
    await expect.poll(async () => (await browser.locator('table').boundingBox())!.width).toBeLessThan(tableWidth)
    const narrow = await columnWidths()
    expect(narrow[0]! / narrow[1]!).toBeCloseTo(proportions[0]! / proportions[1]!, 2)
    expect((await browser.locator('table').boundingBox())!.width)
      .toBeCloseTo((await browser.locator('.metadata-table-scroll').boundingBox())!.width, 0)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })
test('Filters scroll only available values while upper controls stay fixed', async ({ page }) => {
  await page.route('**/api/v1/metadata/browser?**', async (route) => {
    const query = new URL(route.request().url())
    const size = Number(query.searchParams.get('limit'))
    const index = Number(query.searchParams.get('page') ?? 1)
    await route.fulfill({ json: {
      items: query.searchParams.get('mode') === 'values'
        ? Array.from({ length: size }, (_, offset) => {
          const value = String((index - 1) * size + offset + 1).padStart(3, '0')
          return { value, label: `Station value ${value} with a long label that wraps in the Filters panel` }
        }) : [],
      next_after: index * size < 100 ? 'next' : null, read_cutoff: 'scroll-cutoff', total: 100,
    } })
  })
  await login(page)
  await selectView(page, 'Filters')
  const filters = page.getByRole('article', { name: 'Metadata filters', exact: true })
  const values = filters.getByRole('region', { name: 'Available values', exact: true })
  const pagination = filters.getByRole('navigation', { name: 'Available values pagination' })
  await expect(values.locator('.metadata-choice')).toHaveCount(50)
  const controls = [
    filters.getByRole('button', { name: 'Clear all', exact: true }),
    filters.getByLabel('Filter attribute', { exact: true }),
    filters.getByRole('button', { name: 'Filter attribute help', exact: true }),
    filters.getByRole('searchbox', { name: 'Search available values', exact: true }),
    pagination,
  ]
  const before = await Promise.all(controls.map((control) => control.boundingBox()))
  const dimensions = await values.evaluate((element) => ({ height: element.clientHeight, content: element.scrollHeight }))
  expect(dimensions.height).toBeGreaterThan(0)
  expect(dimensions.content).toBeGreaterThan(dimensions.height)
  await values.focus()
  await values.press('Control+End')
  await expect.poll(() => values.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  for (const [index, control] of controls.entries()) {
    const after = await control.boundingBox()
    expect(after!.y).toBeCloseTo(before[index]!.y, 1)
    await expect(control).toBeInViewport()
  }
  expect(await filters.evaluate((element) => element.scrollTop)).toBe(0)
  expect(await filters.locator('..').evaluate((element) => element.scrollTop)).toBe(0)
  await pagination.getByRole('button', { name: 'Next page', exact: true }).click()
  await expect(values.locator('.metadata-choice').first()).toContainText('Station value 051')
  expect(await values.evaluate((element) => element.scrollTop)).toBe(0)
})

test('filter chips and per-instance tree naming settings remain keyboard accessible', async ({ page }) => {
  const treeCollections: Collection[] = ['stations', 'sampling_positions', 'instruments', 'instrument_deployments', 'parameter_groups', 'parameters', 'series']
  const node = (collection: Collection) => {
    const prefix = entities[collection].prefix
    return {
      collection, status: 'active', position_scope: 'unavailable',
      references: collection === 'instrument_deployments'
        ? [{ field: 'instrument_id', collection: 'instruments', id: 'instruments-1', version: '1' }] : [],
      item: { [`${prefix}_id`]: `${collection}-1`, [`${prefix}_name`]: `${collection} name`,
        [`${prefix}_metadata_version`]: '1', [`${prefix}_validity_start`]: '2026-11-20T12:00:00Z' },
    }
  }
  await page.route('**/api/v1/metadata/browser?**', async (route) => {
    const query = new URL(route.request().url())
    await route.fulfill({ json: {
      items: query.searchParams.get('mode') === 'values'
        ? [{ value: 'A', label: 'Station A' }, { value: 'B', label: 'Station B' }]
        : query.searchParams.get('mode') === 'branches'
          ? [{ path: treeCollections.slice(1).map(node) }]
          : [node(query.searchParams.get('collection') === 'stations' ? 'stations' : 'series')],
      next_after: null, read_cutoff: 'naming-cutoff', total: 1,
    } })
  })
  await login(page)
  await selectView(page, 'Filters')
  const filters = page.getByRole('article', { name: 'Metadata filters', exact: true })
  const selectAll = filters.getByRole('checkbox', { name: 'Select all on this page', exact: true })
  await expect(selectAll).toBeVisible()
  await selectAll.focus()
  await selectAll.press('Space')
  await expect(filters.getByLabel('Station A', { exact: true })).toBeChecked()
  await expect(filters.getByLabel('Station B', { exact: true })).toBeChecked()
  await selectAll.press('Space')
  await expect(filters.getByLabel('Station A', { exact: true })).not.toBeChecked()
  await expect(filters.getByLabel('Station B', { exact: true })).not.toBeChecked()
  await filters.getByLabel('Station A', { exact: true }).check()
  await filters.getByLabel('Station B', { exact: true }).check()
  const remove = filters.getByRole('button', { name: 'Remove Stations: station id = A', exact: true })
  for (const select of await filters.locator('select').all()) {
    await expect(select).toHaveCSS('height', '36px')
  }
  const filterHelp = filters.getByRole('button', { name: 'Filter attribute help', exact: true })
  await expect(filterHelp).toHaveCSS('width', '24px')
  await expect(filterHelp).toHaveCSS('height', '24px')
  await expect(remove).toHaveCSS('height', '36px')
  await expect(remove).toHaveText('\u00d7')
  await expect(remove.locator('..')).toHaveText('station id = A\u00d7')
  const chipBounds = await remove.locator('..').boundingBox()
  const clearBounds = await filters.getByRole('button', { name: 'Clear all', exact: true }).boundingBox()
  expect(clearBounds!.height).toBeCloseTo(chipBounds!.height, 1)
  await remove.focus()
  await remove.press('Enter')
  await expect(filters.getByLabel('Station A', { exact: true })).not.toBeChecked()
  await expect(filters.getByLabel('Station B', { exact: true })).toBeChecked()
  await expect(filters.getByRole('button', { name: 'Tree naming settings', exact: true })).toHaveCount(0)
  await selectView(page, 'Tree view')
  const treePanel = page.getByRole('article', { name: 'Tree view', exact: true })
  const tree = treePanel.getByRole('region', { name: 'Tree view results', exact: true })
  const design = treePanel.getByLabel('Design', { exact: true })
  await expect(design).toHaveValue('station-tree')
  await expect(design.locator('option')).toHaveText(['Station tree'])
  const station = tree.getByRole('button', { name: 'stations name / stations-1', exact: true })
  await expect(station).toHaveText('stations name')
  await tree.getByRole('button', { name: 'Expand stations name / stations-1', exact: true }).click()
  await expect(tree.getByRole('button', { name: 'instruments name / instruments-1', exact: true })).toHaveText('instruments name')
  const settings = treePanel.getByRole('button', { name: 'Tree naming settings', exact: true })
  const designBounds = (await design.boundingBox())!
  const settingsBounds = (await settings.boundingBox())!
  expect(designBounds.height).toBeCloseTo(36, 1)
  expect(settingsBounds.height).toBeCloseTo(36, 1)
  await expect(settings.locator('svg')).toHaveCSS('height', '24px')
  const settingsGraphics = await page.getByRole('button', { name: 'Settings', exact: true }).locator('svg')
    .or(settings.locator('svg')).evaluateAll((elements) => elements.map((element) => {
      const style = getComputedStyle(element)
      return {
        artwork: element.innerHTML, viewBox: element.getAttribute('viewBox'),
        width: style.width, height: style.height, fill: style.fill, stroke: style.stroke,
        strokeWidth: style.strokeWidth, strokeLinecap: style.strokeLinecap, strokeLinejoin: style.strokeLinejoin,
      }
    }))
  expect(settingsGraphics).toHaveLength(2)
  expect(settingsGraphics[0]).toEqual(settingsGraphics[1])
  await expect(tree.getByRole('button', { name: 'Collapse stations name / stations-1', exact: true })).toHaveCSS('height', '36px')
  expect(designBounds.x + designBounds.width).toBeLessThanOrEqual(settingsBounds.x)
  expect(designBounds.y + designBounds.height / 2).toBeCloseTo(settingsBounds.y + settingsBounds.height / 2, 0)
  await expect(settings).toHaveText('')
  await settings.focus()
  await settings.press('Enter')
  const dialog = treePanel.getByRole('dialog', { name: 'Tree naming settings', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Stations ID', { exact: true })).toBeFocused()
  for (const collection of treeCollections) {
    await expect(dialog.getByLabel(`${entities[collection].title} Name`, { exact: true })).toBeChecked()
    await expect(dialog.getByLabel(`${entities[collection].title} Name`, { exact: true })).toBeDisabled()
    await expect(dialog.getByLabel(`${entities[collection].title} ID`, { exact: true })).not.toBeChecked()
  }
  await dialog.getByLabel('Stations ID', { exact: true }).check()
  await expect(station).toHaveText('stations name / stations-1')
  await dialog.getByLabel('Instruments ID', { exact: true }).check()
  await dialog.getByLabel('Instruments Name', { exact: true }).uncheck()
  await expect(dialog.getByLabel('Instruments ID', { exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(settings).toBeFocused()
  await expect(tree.getByRole('button', { name: 'Collapse stations name / stations-1', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await expect(tree.getByRole('button', { name: 'instruments name / instruments-1', exact: true })).toHaveText('instruments-1')
  await expect(tree.getByRole('button', { name: 'parameters name / parameters-1', exact: true })).toHaveText('parameters name')
  await selectView(page, 'Filters')
  await filters.getByRole('button', { name: 'Clear all', exact: true }).click()
  await expect(filters.getByRole('button', { name: /^Remove / })).toHaveCount(0)
  await expect(filters.getByLabel('Station B', { exact: true })).not.toBeChecked()
  await selectView(page, 'Tree view')
  await settings.click()
  await expect(dialog.getByLabel('Stations Name', { exact: true })).toBeChecked()
  await expect(dialog.getByLabel('Stations ID', { exact: true })).toBeChecked()
  await dialog.getByLabel('Stations ID', { exact: true }).uncheck()
  await expect(dialog.getByLabel('Stations Name', { exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(station).toHaveText('stations name')
  await tree.getByRole('button', { name: 'Expand stations name / stations-1', exact: true }).click()
  await expect(tree.getByRole('button', { name: 'instruments name / instruments-1', exact: true })).toHaveText('instruments-1')
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('real authorized catalog pages, shared filters, linked details and Station branches', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  const mutations: string[] = []
  const cutoffs: string[] = []
  page.setDefaultTimeout(10_000)
  page.on('crash', () => console.warn('P2 browser renderer crashed.'))
  page.on('requestfailed', (request) => {
    if (request.failure()?.errorText !== 'net::ERR_ABORTED') {
      console.warn('P2 request failed:', new URL(request.url()).pathname, request.failure()?.errorText)
    }
  })
  page.on('pageerror', () => errors.push('Metadata script error'))
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/v1/metadata/')) {
      if (request.method() !== 'GET') mutations.push('Unexpected metadata mutation')
      const cutoff = url.searchParams.get('read_cutoff')
      if (cutoff) cutoffs.push(cutoff)
    }
    if (/samples|jobs|ingestion/.test(url.pathname)) mutations.push('Unexpected scientific operation')
  })
  const browser = await login(page)
  const rows = browser.getByRole('region', { name: 'Instance results', exact: true })
  await expect(rows.locator('tbody tr')).toHaveCount(50)
  const pagination = rows.getByRole('navigation', { name: 'Table pagination' })
  await expect(pagination.getByLabel('Rows per page')).toHaveValue('50')
  await expect(pagination.getByRole('status')).toHaveText(/^Page 1 \/ [\d,]+$/)
  await expect(pagination.getByRole('button', { name: 'Previous page', exact: true })).toBeDisabled()
  const totalPages = (await pagination.getByRole('status').innerText()).split(' / ')[1]!
  await pagination.getByRole('button', { name: 'Last page', exact: true }).click()
  await expect(pagination.getByRole('status')).toHaveText(`Page ${totalPages} / ${totalPages}`)
  await expect(pagination.getByRole('button', { name: 'Next page', exact: true })).toBeDisabled()
  await pagination.getByRole('button', { name: 'Previous page', exact: true }).click()
  await expect(pagination.getByRole('button', { name: 'Next page', exact: true })).toBeEnabled()
  await pagination.getByRole('button', { name: 'First page', exact: true }).click()
  await expect(pagination.getByRole('status')).toHaveText(`Page 1 / ${totalPages}`)
  await pagination.getByLabel('Rows per page').selectOption('25')
  await expect(rows.locator('tbody tr')).toHaveCount(25)
  await pagination.getByLabel('Rows per page').selectOption('50')
  await expect(rows.locator('tbody tr')).toHaveCount(50)
  for (const label of ['First page', 'Previous page', 'Next page', 'Last page']) {
    await expect(pagination.getByRole('button', { name: label, exact: true }).locator('svg')).toHaveCount(1)
    await expect(pagination.getByRole('button', { name: label, exact: true })).toHaveText('')
  }
  const nameSort = rows.getByRole('button', { name: 'Name / stable ID', exact: true })
  await nameSort.click()
  await expect(rows.locator('thead th').first()).toHaveAttribute('aria-sort', 'ascending')
  await expect(rows.locator('tbody tr')).toHaveCount(50)
  await nameSort.click()
  await expect(rows.locator('thead th').first()).toHaveAttribute('aria-sort', 'descending')
  await expect(rows.locator('tbody tr')).toHaveCount(50)
  await rows.getByRole('button', { name: 'Next page', exact: true }).click()
  await expect(rows.locator('tbody tr')).toHaveCount(50)
  await selectView(page, 'Arrange Side by Side')
  await rows.locator('tbody .metadata-link').first().click()
  const detail = page.getByRole('article', { name: 'Metadata detail', exact: true })
  await expect(detail.getByRole('heading', { name: 'Read-only metadata detail' })).toBeVisible()
  const sourceBounds = await browser.boundingBox()
  const detailBounds = await detail.boundingBox()
  expect(detailBounds!.x).toBeGreaterThanOrEqual(sourceBounds!.x + sourceBounds!.width - 1)
  await page.getByRole('button', { name: 'Close Details', exact: true }).click()
  await expect(detail).toHaveCount(0)
  await rows.locator('tbody .metadata-link').first().click()
  await expect(detail.getByRole('heading', { name: 'Read-only metadata detail' })).toBeVisible()
  const reopenedSource = await browser.boundingBox()
  const reopenedDetail = await detail.boundingBox()
  expect(reopenedDetail!.x).toBeGreaterThanOrEqual(reopenedSource!.x + reopenedSource!.width - 1)
  await expect(page.getByRole('tab', { name: 'Details', exact: true })).toHaveCount(1)
  await detail.getByText('Scientific context and lineage', { exact: true }).click()
  await expect(detail.locator('details[open] > pre')).toBeVisible()
  await detail.getByText('Retained revisions', { exact: true }).click()
  await expect(detail.getByRole('button', { name: /Open retained version/ }).first()).toBeVisible()
  await detail.getByText('station id', { exact: true }).locator('..').getByRole('button').click()
  await expect(detail.getByText('Current coordinates only. These coordinates do not describe an earlier observation or cutoff.', { exact: true })).toBeVisible()
  await selectView(page, 'Metadata')
  await selectView(page, 'Filters')
  const filters = page.getByRole('article', { name: 'Metadata filters', exact: true })
  const filterHelp = filters.getByRole('button', { name: 'Filter attribute help', exact: true })
  const explanation = filters.getByText('Values within an attribute match any selection; different attributes must all match one declared metadata path. At most 12 attributes and 20 values per attribute.', { exact: true })
  await expect(explanation).toBeHidden()
  await filterHelp.focus()
  await filterHelp.press('Enter')
  await expect(explanation).toBeVisible()
  await expect(filterHelp).toHaveAttribute('aria-expanded', 'true')
  const labelBounds = await filters.locator('label[for="metadata-attribute"]').boundingBox()
  const helpBounds = await filterHelp.boundingBox()
  expect(helpBounds!.x).toBeGreaterThanOrEqual(labelBounds!.x + labelBounds!.width)
  await filterHelp.press('Enter')
  await expect(explanation).toBeHidden()
  await filters.getByLabel('Filter attribute', { exact: true }).selectOption('series:series_id')
  const available = filters.getByRole('navigation', { name: 'Available values pagination' })
  const choices = filters.locator('.metadata-choice')
  await expect(choices).toHaveCount(50)
  const selectAll = filters.getByRole('checkbox', { name: 'Select all on this page', exact: true })
  await expect(selectAll).toBeDisabled()
  await expect(selectAll).toHaveAccessibleDescription(/would exceed the 20-value limit/)
  const checkboxSizes = await choices.locator('input').evaluateAll((inputs) => inputs.map((input) => {
    const { width, height } = input.getBoundingClientRect()
    return [width, height]
  }))
  expect(checkboxSizes).toEqual(Array.from({ length: 50 }, () => [16, 16]))
  await expect(available.getByLabel('Rows per page')).toHaveValue('50')
  await expect(available.getByText(/of [\d,]+ total rows/)).toBeVisible()
  const firstLabels = await choices.allTextContents()
  expect(firstLabels.map((label) => label.toLowerCase())).toEqual(firstLabels.map((label) => label.toLowerCase()).sort())
  await available.getByRole('button', { name: 'Next page', exact: true }).click()
  await expect(choices.first()).not.toHaveText(firstLabels[0]!)
  const secondLabels = await choices.allTextContents()
  expect([...firstLabels, ...secondLabels].map((label) => label.toLowerCase()))
    .toEqual([...firstLabels, ...secondLabels].map((label) => label.toLowerCase()).sort())
  await choices.first().getByRole('checkbox').check()
  await expect(available.getByRole('status')).toHaveText(/^Page 2 \/ [\d,]+$/)
  await available.getByRole('button', { name: 'First page', exact: true }).click()
  await expect(choices.first()).toHaveText(firstLabels[0]!)
  await available.getByRole('button', { name: 'Next page', exact: true }).click()
  await expect(choices.first().getByRole('checkbox')).toBeChecked()
  const valueSearch = filters.getByRole('searchbox', { name: 'Search available values' })
  const attributeBounds = await filters.getByLabel('Filter attribute', { exact: true }).boundingBox()
  const searchBounds = await valueSearch.boundingBox()
  expect(searchBounds!.y).toBeGreaterThanOrEqual(attributeBounds!.y + attributeBounds!.height - 1)
  const searchText = secondLabels[0]!.split(' / ').at(-1)!.slice(0, 200).toUpperCase()
  await valueSearch.fill(searchText)
  await expect(available.getByRole('status')).toHaveText(/^Page 1 \/ [\d,]+$/)
  await expect(choices.filter({ hasText: secondLabels[0]! }).getByRole('checkbox')).toBeChecked()
  await expect(selectAll).toBeChecked()
  await selectAll.uncheck()
  await expect(choices.filter({ hasText: secondLabels[0]! }).getByRole('checkbox')).not.toBeChecked()
  await selectAll.check()
  const foundLabels = await choices.allTextContents()
  expect(foundLabels.length).toBeGreaterThan(0)
  expect(foundLabels.every((label) => label.toLowerCase().includes(searchText.toLowerCase()))).toBe(true)
  await valueSearch.fill('NO-MATCH-FOR-AVAILABLE-VALUES-SEARCH')
  await expect(available.getByText('of 0 total rows')).toBeVisible()
  await expect(choices).toHaveCount(0)
  await valueSearch.fill('')
  await expect(choices.first()).toHaveText(firstLabels[0]!)
  await filters.getByRole('button', { name: 'Clear all', exact: true }).click()
  await filters.getByLabel('Filter attribute', { exact: true }).selectOption('stations:station_id')
  await expect(choices.first().getByRole('checkbox')).toBeVisible()
  await choices.nth(0).getByRole('checkbox').check()
  await expect(choices.nth(0).getByRole('checkbox')).toBeChecked()
  await choices.nth(1).getByRole('checkbox').check()
  await filters.getByLabel('Filter attribute', { exact: true }).selectOption('parameters:parameter_id')
  await expect(choices.first().getByRole('checkbox')).toBeVisible()
  await choices.first().getByRole('checkbox').check()
  await expect(filters.getByRole('region', { name: 'Active filters' }).getByRole('button', { name: /^Remove / })).toHaveCount(3)
  await selectView(page, 'Tree view')
  const tree = page.getByRole('region', { name: 'Tree view results', exact: true })
  await expect(tree.locator('.station-tree > li > .metadata-link').first()).toBeVisible()
  const stationLabels = await tree.locator('.station-tree > li > .metadata-link').allTextContents()
  expect(stationLabels.map((label) => label.toLowerCase())).toEqual(stationLabels.map((label) => label.toLowerCase()).sort())
  await page.getByRole('button', { name: 'Close Details', exact: true }).click()
  await tree.locator('.station-tree > li > .metadata-link').first().click()
  await expect(detail.getByRole('heading', { name: 'Read-only metadata detail' })).toBeVisible()
  const treeBounds = await tree.boundingBox()
  const treeDetailBounds = await detail.boundingBox()
  expect(treeDetailBounds!.x).toBeGreaterThanOrEqual(treeBounds!.x + treeBounds!.width - 1)
  await expect(tree.locator('.station-tree')).toHaveCSS('list-style-type', 'none')
  await expect(tree.getByRole('button', { name: /^Expand / }).first()).toHaveText('')
  await expect(tree.getByRole('button', { name: /^Expand / }).first().locator('svg')).toHaveCount(1)
  await tree.getByRole('button', { name: /^Expand / }).first().click()
  await expect(tree.locator('.metadata-path').first()).toBeVisible()
  const path = tree.locator('.metadata-path').first()
  const branch = path.getByRole('button', { name: /^Collapse / }).first()
  await expect(branch).toHaveText('')
  await branch.click()
  await expect(path.locator('ul').first()).toBeHidden()
  await path.getByRole('button', { name: /^Expand / }).first().press('Enter')
  await expect(path.locator('ul').first()).toBeVisible()
  expect(await tree.locator('ul').evaluateAll((lists) => lists.every((list) => getComputedStyle(list).listStyleType === 'none'))).toBe(true)
  await expect(tree.getByText(/^Units:/)).toHaveCount(0)
  await expect(tree.getByText(/^Quality codebooks:/)).toHaveCount(0)
  await tree.getByRole('button', { name: /^Collapse / }).first().click()
  await selectView(page, 'Filters')
  await expect(filters.getByRole('region', { name: 'Active filters' }).getByRole('button', { name: /^Remove / })).toHaveCount(3)
  await filters.getByRole('button', { name: 'Clear all', exact: true }).click()
  await selectView(page, 'Metadata')
  for (const collection of ['stations', 'sampling_positions', 'instruments', 'instrument_deployments', 'parameters', 'parameter_groups', 'quality_codebooks', 'series', 'units']) {
    await browser.getByLabel('Instance type', { exact: true }).selectOption(collection)
    const title = await browser.getByLabel('Instance type', { exact: true }).locator('option:checked').innerText()
    await expect(browser.locator('caption')).toHaveText(`${title} / matching authorized instances`)
    await expect(browser.getByRole('navigation', { name: 'Table pagination' }).getByRole('status')).toHaveText(/^Page 1 \/ [\d,]+$/)
    expect(await browser.locator('tbody tr').count()).toBeLessThanOrEqual(50)
  }
  expect(new Set(cutoffs).size).toBe(1)
  await page.setViewportSize({ width: 375 * Number(testInfo.project.metadata.zoom ?? 1), height: 812 })
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await openIdentity(page)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.locator('.dock-host')).toHaveCount(0)
  const stored = await page.evaluate(() => Object.values(localStorage).join(''))
  expect(stored).not.toMatch(/station_id|parameter_id|read_cutoff|csrf|password/)
  expect(errors).toEqual([])
  expect(mutations).toEqual([])
})

test('exact large versions and nested attributes remain data; HTTP failures and expiry are explicit', async ({ page }) => {
  let failure = 0
  await page.route('**/api/v1/metadata/series/0001/scientific_context?**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      read_cutoff: 'fixture-cutoff',
      scientific_context: {
        processing: { inputs: [{ series_id: 'input-0001', series_metadata_version: '9223372036854775807' }] },
        measurement: { reference: { value: 0, unit_id: 'm', unit_metadata_version: '9223372036854775806' } },
      },
    }),
  }))
  await page.route('**/api/v1/metadata/browser?**', async (route) => {
    if (failure) {
      await route.fulfill({ status: failure, contentType: 'application/json', body: JSON.stringify({
        code: failure === 401 ? 'AUTHENTICATION_REQUIRED' : failure === 403 ? 'INSUFFICIENT_CAPABILITY' : failure === 409 ? 'HISTORY_UNAVAILABLE' : 'NOT_FOUND',
        message: 'Injected metadata failure', request_id: null,
      }) })
      return
    }
    const query = new URL(route.request().url()).searchParams
    if (query.get('mode') === 'values') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        items: [], next_after: null, read_cutoff: 'fixture-cutoff', total: 0,
      }) })
      return
    }
    const collection = query.get('collection') === 'stations' ? 'stations' : 'series'
    const prefix = collection === 'stations' ? 'station' : 'series'
    const node = {
      collection, status: 'active', position_scope: query.has('read_cutoff') ? 'current_only' : 'unavailable', references: [],
      item: { [`${prefix}_id`]: '0001', [`${prefix}_name`]: 'Duplicate name', [`${prefix}_metadata_version`]: 'BIGINT',
        [`${prefix}_validity_start`]: '2026-11-20T12:00:00.123456Z',
        ...(collection === 'stations' ? { station_location: { marker: 'CURRENT-COORDINATE-FIXTURE' } } : {}),
        [`${prefix}_user_attributes`]: { label: '<img src=x onerror=alert(1)>', nested: [null, true, 0, '0001'] } },
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      items: [node], next_after: null, read_cutoff: 'fixture-cutoff', total: 1,
    }).replaceAll('"BIGINT"', '9223372036854775807') })
  })
  const browser = await login(page)
  await browser.locator('tbody .metadata-link').first().click()
  const detail = page.getByRole('article', { name: 'Metadata detail', exact: true })
  await detail.getByText('Scientific context and lineage', { exact: true }).click()
  await expect(detail.getByRole('button', { name: 'processing input: input-0001 / retained version 9223372036854775807', exact: true })).toBeVisible()
  await expect(detail.getByRole('button', { name: 'measurement reference Unit: m / retained version 9223372036854775806', exact: true })).toBeVisible()
  await selectView(page, 'Metadata')
  await browser.getByRole('button', { name: 'Reload', exact: true }).click()
  await browser.getByLabel('Instance type', { exact: true }).selectOption('stations')
  await browser.locator('tbody .metadata-link').first().click()
  await expect(detail.getByText('active / identified retained version 9223372036854775807', { exact: true })).toBeVisible()
  await detail.getByText('station user attributes / structured data', { exact: true }).click()
  const userAttributes = detail.getByText('station user attributes / structured data', { exact: true }).locator('..').locator('pre')
  await expect(userAttributes).toContainText('[null, true, 0, "0001"]')
  await expect(userAttributes).toContainText('<img src=x onerror=alert(1)>')
  await expect(detail.locator('img')).toHaveCount(0)
  await expect(detail.getByText('Current coordinates only. These coordinates do not describe an earlier observation or cutoff.', { exact: true })).toBeVisible()
  await detail.getByText('station location / structured data', { exact: true }).click()
  await expect(detail.getByText(/CURRENT-COORDINATE-FIXTURE/)).toBeVisible()
  await selectView(page, 'Metadata')
  for (const status of [403, 404, 409]) {
    failure = status
    await browser.getByRole('button', { name: 'Reload', exact: true }).click()
    await expect(browser.getByRole('alert')).toContainText(`HTTP ${status}`)
    await expect(browser.locator('tbody tr')).toHaveCount(0)
  }
  failure = 401
  await browser.getByRole('button', { name: 'Reload', exact: true }).click()
  await expect(page.getByText('Your session has expired. Sign in again.', { exact: true })).toBeVisible()
  await expect(page.locator('.dock-host')).toHaveCount(0)
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})
