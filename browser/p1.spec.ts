import type { Page } from '@playwright/test'
import type { WorkspaceLayout } from '../src/workspaceLayout'
import { test, expect, readerPassword, openIdentity, selectView, selectMenu } from './fixtures'

async function login(page: Page) {
  await page.goto('/')
  await openIdentity(page)
  await page.getByLabel('Username', { exact: true }).fill('browser-test-reader')
  await page.getByLabel('Password', { exact: true }).fill(await readerPassword())
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Read-only workspace', exact: true })).toBeVisible()
}

async function keyButton(page: Page, name: string) {
  if (name === 'Sign out') await openIdentity(page)
  const control = page.getByRole('button', { name, exact: true })
  await control.focus()
  await page.keyboard.press('Enter')
}

async function savedLayout(page: Page): Promise<WorkspaceLayout> {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) => key.startsWith('hydrodb.workspace:'))
    if (!key) throw new Error('Workspace presentation was not saved.')
    return JSON.parse(localStorage.getItem(key)!)
  })
}

async function expectWorkspaceFits(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const dock = document.querySelector('.dock-host')!.getBoundingClientRect()
    const menu = document.querySelector('[role="menubar"]')!.getBoundingClientRect()
    return Math.max(
      Math.abs(dock.top - menu.bottom), Math.abs(dock.bottom - innerHeight),
      Math.abs(dock.left), Math.abs(dock.right - document.documentElement.clientWidth),
      document.documentElement.scrollHeight - innerHeight,
    )
  })).toBeLessThanOrEqual(1)
}

test('bounded panels, keyboard docking, layout restore/reset and session cleanup', async ({ page }, testInfo) => {
  const errors: string[] = []
  const domainRequests: string[] = []
  page.on('pageerror', () => errors.push('Workspace script error'))
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/') && !(request.method() === 'GET' && url.pathname === '/api/v1/metadata/browser') && ![
      '/api/v1/auth/sessions', '/api/v1/auth/me', '/api/v1/auth/sessions/current', '/api/v1/status',
    ].includes(url.pathname)) domainRequests.push('Unexpected domain operation')
  })
  await login(page)
  for (const name of ['Settings', 'User identity']) {
    const control = page.getByRole('button', { name, exact: true })
    await control.hover()
    await expect(control).toHaveCSS('border-radius', '8px')
    await expect(control).toHaveCSS('background-color', 'rgb(239, 240, 245)')
    await expect(control).toHaveCSS('width', '32px')
    await expect(control).toHaveCSS('height', '32px')
  }
  await expect(page.locator('.identity-avatar')).toHaveCSS('width', '26px')
  await expect(page.locator('.identity-avatar')).toHaveCSS('height', '26px')
  await expect(page.getByRole('button', { name: 'Settings', exact: true }).locator('svg')).toHaveCSS('height', '24px')
  await expect(page.getByRole('banner')).toHaveCSS('height', '55px')
  expect(await page.locator('.brand h1').evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeCloseTo(19.2, 1)
  await expect(page.getByRole('article', { name: 'Welcome placeholder' })).toBeVisible()
  await expectWorkspaceFits(page)
  const workspace = page.getByRole('region', { name: 'Read-only workspace', exact: true })
  await expect(workspace.getByRole('region', { name: 'Backend and database health', exact: true })).toHaveCount(0)
  await selectMenu(page, 'Tools', 'Health')
  await expect(workspace.getByText('Authenticated database read succeeded', { exact: true })).toBeVisible()
  await page.getByRole('menubar').getByRole('menuitem', { name: 'Tools', exact: true }).click()
  await expect(page.getByRole('menu', { name: 'Tools', exact: true }).getByRole('menuitemcheckbox', { name: 'Health', exact: true })).toBeChecked()
  await page.keyboard.press('Escape')
  await selectMenu(page, 'Tools', 'Health')
  await expect(page.getByRole('tab', { name: 'Health', exact: true })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Backend and database health', exact: true })).toHaveCount(0)
  await selectMenu(page, 'Tools', 'Health')
  await selectView(page, 'Metadata')
  await expect(page.getByRole('article', { name: 'Metadata browser', exact: true })).toBeVisible()
  await selectView(page, 'Metadata')
  await expect(page.getByRole('tab', { name: 'Metadata', exact: true })).toHaveCount(0)
  await selectView(page, 'Metadata')
  await selectView(page, 'Time series graph')
  await expect(page.getByRole('tab')).toHaveCount(6)
  await selectView(page, 'Arrange Side by Side')
  await expect(page.getByRole('article', { name: 'Metadata browser', exact: true })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Time series graph', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('article', { name: 'Metadata browser', exact: true })).toBeVisible()
  await expect(workspace.getByRole('region', { name: 'Backend and database health', exact: true })).toBeVisible()
  const closeHealth = page.getByRole('button', { name: 'Close Health', exact: true })
  await expect(closeHealth).toHaveCSS('height', '32px')
  await expect(closeHealth.locator('svg')).toHaveCSS('width', '11px')
  await expect(closeHealth.locator('svg')).toHaveCSS('height', '11px')
  await expectWorkspaceFits(page)
  const layout = await page.evaluate(() => {
    const keys = Object.keys(localStorage)
    const value = keys.map((key) => localStorage.getItem(key)).join('')
    return { onlyLayout: keys.every((key) => key.startsWith('hydrodb.workspace:')), noProtected: !/csrf|password|credential|read_cutoff/.test(value) }
  })
  expect(layout).toEqual({ onlyLayout: true, noProtected: true })
  await selectView(page, 'Arrange as Tabs')
  await page.getByRole('tab', { name: 'Metadata', exact: true }).locator('.dv-default-tab-content').click()
  await expect(page.getByRole('article', { name: 'Metadata browser', exact: true })).toBeVisible()
  await selectView(page, 'Close Active Panel')
  await expect(page.getByRole('article', { name: 'Metadata browser', exact: true })).toHaveCount(0)
  await selectView(page, 'Metadata')
  await expect(page.getByRole('article', { name: 'Metadata browser', exact: true })).toBeVisible()
  await selectView(page, 'Reset Layout')
  await expect(page.getByRole('article', { name: 'Welcome placeholder' })).toBeVisible()
  await expectWorkspaceFits(page)
  await expect(page.getByRole('tab')).toHaveCount(1)
  await selectView(page, 'Close Active Panel')
  await expect(page.getByRole('tab')).toHaveCount(0)
  await selectView(page, 'Welcome')
  await expect(page.getByRole('article', { name: 'Welcome placeholder' })).toBeVisible()
  await page.setViewportSize({ width: 375 * Number(testInfo.project.metadata.zoom ?? 1), height: 812 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expectWorkspaceFits(page)
  expect(await page.locator('.brand h1').evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeCloseTo(14.72, 1)
  for (const title of ['Settings']) {
    await keyButton(page, title)
    const popup = page.getByRole('dialog', { name: title, exact: true })
    await expect(popup).toBeVisible()
    const bounds = await popup.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
    await popup.getByRole('button', { name: `Close ${title.toLowerCase()}` }).click()
    await expect(popup).not.toBeVisible()
  }
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  await selectMenu(page, 'Tools', 'Health')
  await expect(workspace.getByRole('region', { name: 'Backend and database health', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await selectView(page, 'Metadata')
  await expect(page.getByRole('article', { name: 'Metadata browser', exact: true })).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  const identity = page.getByRole('button', { name: 'User identity', exact: true })
  await expect(identity).toBeVisible()
  expect(await identity.evaluate((element) => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0)
  await keyButton(page, 'User identity')
  await expect(page.getByRole('dialog', { name: 'User identity', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(identity).toBeFocused()
  await keyButton(page, 'Sign out')
  await expect(page.getByText('Signed out. Server session revoked.', { exact: true })).toBeVisible()
  await expect(page.locator('.dock-host')).toHaveCount(0)
  await expect(page.locator('.identity-avatar svg')).toHaveCSS('width', '24px')
  expect(errors).toEqual([])
  expect(domainRequests).toEqual([])
})

test('pinned metadata tools cannot close while Metadata is open, restore on reload, and reset cleanly', async ({ page }) => {
  await login(page)
  await expect(page.getByRole('tab', { name: 'Filters', exact: true })).toHaveCount(0)
  await selectView(page, 'Metadata')
  const filters = page.getByRole('article', { name: 'Metadata filters', exact: true })
  const metadata = page.getByRole('article', { name: 'Metadata browser', exact: true })
  await expect(filters).toBeVisible()
  await expect(metadata).toBeVisible()
  expect((await filters.boundingBox())!.x).toBeLessThan((await metadata.boundingBox())!.x)
  const tree = page.getByRole('article', { name: 'Tree view', exact: true })
  await expect(tree).not.toBeVisible()
  const edge = (await savedLayout(page)).layout.edgeGroups?.left
  expect(edge?.autoHide).toBe(false)
  expect(edge?.group).toMatchObject({ views: ['filters', 'station-tree'], activeView: 'filters' })
  await expect(page.getByRole('button', { name: 'Close Filters', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Close Tree view', exact: true })).toHaveCount(0)
  await selectView(page, 'Filters')
  const filterTab = page.getByRole('tab', { name: 'Filters', exact: true })
  await filterTab.click()
  await expect(filters).not.toBeVisible()
  await filterTab.click()
  await expect(filters).toBeVisible()
  await filterTab.focus()
  await filterTab.press('Delete')
  await expect(filterTab).toHaveCount(1)
  await filterTab.press('Backspace')
  await expect(filterTab).toHaveCount(1)
  const view = page.getByRole('menubar').getByRole('menuitem', { name: 'View', exact: true })
  await view.click()
  await expect(page.getByRole('menu', { name: 'View', exact: true }).getByRole('menuitemcheckbox', { name: 'Filters', exact: true })).toHaveCount(0)
  await expect(page.getByRole('menu', { name: 'View', exact: true }).getByRole('menuitemcheckbox', { name: 'Tree view', exact: true })).toHaveCount(0)
  await expect(page.getByRole('menu', { name: 'View', exact: true }).getByRole('menuitem', { name: 'Close Active Panel', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Close Metadata', exact: true }).click()
  await expect(filterTab).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Tree view', exact: true })).toHaveCount(0)
  await expect.poll(async () => (await savedLayout(page)).layout.edgeGroups).toBeUndefined()
  await selectView(page, 'Filters')
  await expect(filters).toBeVisible()
  await selectView(page, 'Tree view')
  await expect(tree).toBeVisible()
  const reopened = (await savedLayout(page)).layout.edgeGroups?.left
  await page.reload()
  await expect(page.getByRole('tab', { name: 'Filters', exact: true })).toHaveCount(1)
  await expect(page.getByRole('tab', { name: 'Tree view', exact: true })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Close Filters', exact: true })).toHaveCount(0)
  expect((await savedLayout(page)).layout.edgeGroups?.left?.group).toEqual(reopened?.group)
  await expectWorkspaceFits(page)
  await selectView(page, 'Reset Layout')
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect.poll(async () => (await savedLayout(page)).layout.edgeGroups).toBeUndefined()
  await selectView(page, 'Metadata')
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) => key.startsWith('hydrodb.workspace:'))
    if (!key) throw new Error('Workspace layout was not saved')
    const saved = JSON.parse(localStorage.getItem(key)!)
    const prior = structuredClone(saved.layout)
    delete saved.layout.edgeGroups
    delete saved.layout.panels.filters
    delete saved.layout.panels['station-tree']
    saved.closedPanels = { filters: prior, 'station-tree': prior }
    localStorage.setItem(key, JSON.stringify(saved))
  })
  await page.reload()
  await expect(filters).toBeVisible()
  await expect(metadata).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Tree view', exact: true })).toHaveCount(1)
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) => key.startsWith('hydrodb.workspace:'))
    if (!key) throw new Error('Workspace layout was not saved')
    const saved: WorkspaceLayout = JSON.parse(localStorage.getItem(key)!)
    const root = saved.layout.grid.root
    saved.layout.grid.root = { type: 'branch', data: [
      { type: 'branch', size: 300, data: [
        { type: 'leaf', data: { id: 'stacked-filters', views: ['filters'], activeView: 'filters' } },
        { type: 'leaf', data: { id: 'stacked-tree', views: ['station-tree'], activeView: 'station-tree' } },
      ] },
      ...(Array.isArray(root.data) ? root.data : [root]),
    ] }
    saved.layout.activeGroup = 'stacked-filters'
    delete saved.layout.edgeGroups
    saved.layout.panels['station-tree']!.title = 'Station tree'
    localStorage.setItem(key, JSON.stringify(saved))
  })
  await page.reload()
  await expect(filters).toBeVisible()
  await expect(tree).not.toBeVisible()
  await expect(metadata).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Station tree', exact: true })).toHaveCount(0)
  expect((await savedLayout(page)).layout.edgeGroups?.left?.group).toMatchObject({ views: ['filters', 'station-tree'], activeView: 'filters' })
  await selectView(page, 'Tree view')
  await expect(tree).toBeVisible()
  await expect(filters).not.toBeVisible()
  await expect(page.getByText('Saved layout was invalid or obsolete. The default workspace has been restored.', { exact: true })).toHaveCount(0)
})

test('View remembers closed splits and floating panels without undoing other panels', async ({ page }) => {
  await login(page)
  const bar = page.getByRole('menubar', { name: 'Application menu' })
  await expect(bar.getByRole('menuitem')).toHaveText(['File', 'Edit', 'View', 'Layout', 'Tools', 'Help'])
  await expect(bar.getByRole('menuitem', { name: 'Tools', exact: true }).locator('svg')).toBeVisible()
  const view = bar.getByRole('menuitem', { name: 'View', exact: true })
  await view.focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitemcheckbox', { name: 'Welcome', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitemcheckbox', { name: 'Metadata', exact: true })).toBeFocused()
  const viewMenu = page.getByRole('menu', { name: 'View', exact: true })
  await expect(viewMenu.getByRole('menuitemcheckbox', { name: 'Health', exact: true })).toHaveCount(0)
  await expect(viewMenu.getByRole('menuitemcheckbox', { name: 'Details', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(view).toBeFocused()
  for (const name of ['File', 'Edit', 'Help']) {
    await bar.getByRole('menuitem', { name, exact: true }).click()
    await expect(page.getByRole('menu', { name, exact: true }).getByRole('menuitem')).toBeDisabled()
    await page.keyboard.press('Escape')
  }
  await selectView(page, 'Time series graph')
  const host = page.locator('.dock-host')
  const box = await host.boundingBox()
  await page.getByRole('tab', { name: 'Time series graph', exact: true }).dragTo(host, {
    targetPosition: { x: box!.width - 5, y: box!.height / 2 },
  })
  const welcome = page.getByRole('article', { name: 'Welcome placeholder' })
  const series = page.getByRole('article', { name: 'Time series graph', exact: true })
  await expect(welcome).toBeVisible()
  await expect(series).toBeVisible()
  expect((await series.boundingBox())!.x).toBeGreaterThan((await welcome.boundingBox())!.x)
  await page.getByRole('button', { name: 'Close Time series graph', exact: true }).click()
  await expect.poll(async () => Boolean((await savedLayout(page)).closedPanels?.series)).toBe(true)
  await page.reload()
  await selectView(page, 'Time series graph')
  await expect(welcome).toBeVisible()
  await expect(series).toBeVisible()
  expect((await series.boundingBox())!.x).toBeGreaterThan((await welcome.boundingBox())!.x)
  const tab = await page.getByRole('tab', { name: 'Time series graph', exact: true }).boundingBox()
  const dock = await host.boundingBox()
  await page.mouse.move(tab!.x + tab!.width / 2, tab!.y + tab!.height / 2)
  await page.keyboard.down('Shift')
  await page.mouse.down()
  await page.mouse.move(tab!.x + tab!.width / 2, tab!.y + tab!.height / 2 + 25, { steps: 5 })
  await page.mouse.move(dock!.x + dock!.width / 2, dock!.y + 100, { steps: 10 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect.poll(async () => (await savedLayout(page)).layout.floatingGroups?.length ?? 0).toBe(1)
  const floating = (await savedLayout(page)).layout.floatingGroups![0]!
  await selectView(page, 'Metadata')
  await selectView(page, 'Time series graph')
  await expect(page.getByRole('tab', { name: 'Time series graph', exact: true })).toHaveCount(1)
  await expect.poll(async () => (await savedLayout(page)).layout.activeGroup).toBe(floating.data!.id)
  const lastFloating = (await savedLayout(page)).layout.floatingGroups![0]!
  await page.getByRole('button', { name: 'Close Time series graph', exact: true }).click()
  await expect.poll(async () => Boolean((await savedLayout(page)).closedPanels?.series)).toBe(true)
  await page.reload()
  await selectView(page, 'Time series graph')
  const coordinates = (position: typeof floating.position) => [
    position.width, position.height,
    'left' in position ? position.left : -position.right,
    'top' in position ? position.top : -position.bottom,
  ]
  const expected = coordinates(lastFloating.position)
  await expect.poll(async () => {
    const position = (await savedLayout(page)).layout.floatingGroups?.[0]?.position
    return position ? Math.max(...coordinates(position).map((value, index) => Math.abs(value - expected[index]!))) : Infinity
  }).toBeLessThanOrEqual(1)
  await expect(page.getByRole('tab', { name: 'Metadata', exact: true })).toHaveCount(1)
  await selectView(page, 'Reset Layout')
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(welcome).toBeVisible()
  await expect.poll(async () => (await savedLayout(page)).layout.floatingGroups ?? []).toEqual([])
  expect((await savedLayout(page)).closedPanels).toBeUndefined()
})

test('invalid layouts recover visibly; unavailable storage stays usable; expiry disposes the workspace', async ({ page }) => {
  await login(page)
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) => key.startsWith('hydrodb.workspace:'))
    if (!key) throw new Error('Workspace layout was not saved')
    localStorage.setItem(key, '{"version":999,"layout":"invalid"}')
  })
  await page.reload()
  await expect(page.getByText('Saved layout was invalid or obsolete. The default workspace has been restored.', { exact: true })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Welcome placeholder' })).toBeVisible()
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Storage blocked', 'QuotaExceededError') }
  })
  await page.reload()
  await expect(page.getByText('The workspace layout could not be saved. Changes remain in memory only.', { exact: true })).toBeVisible()
  await selectView(page, 'Metadata')
  await expect(page.getByRole('article', { name: 'Metadata browser', exact: true })).toBeVisible()
  await selectMenu(page, 'Tools', 'Health')
  await expect(page.getByText('Authenticated database read succeeded', { exact: true })).toBeVisible()
  await page.route('**/api/v1/status', (route) => route.fulfill({
    status: 401, contentType: 'application/json',
    body: '{"code":"AUTHENTICATION_REQUIRED","message":"Expired","request_id":null}',
  }))
  await keyButton(page, 'Check health again')
  await expect(page.getByText('Session expired (HTTP 401). Sign in again.', { exact: true })).toBeVisible()
  await expect(page.locator('.dock-host')).toHaveCount(0)
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('a failed workspace bundle leaves login and health usable', async ({ page }) => {
  await page.route('**/assets/Workspace-*.js', (route) => route.abort('failed'))
  await page.goto('/')
  await openIdentity(page)
  await page.getByLabel('Username', { exact: true }).fill('browser-test-reader')
  await page.getByLabel('Password', { exact: true }).fill(await readerPassword())
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByText(/The workspace could not be opened/)).toBeVisible()
  await expect(page.getByText('Authenticated database read succeeded', { exact: true })).toBeVisible()
  await keyButton(page, 'Sign out')
  await expect(page.getByText('Signed out. Server session revoked.', { exact: true })).toBeVisible()
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})
