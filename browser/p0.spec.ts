import type { Locator, Page } from '@playwright/test'
import { test, expect, readerPassword, openIdentity, selectMenu } from './fixtures'

const allowed = new Set([
  'POST /api/v1/auth/sessions', 'GET /api/v1/auth/me',
  'DELETE /api/v1/auth/sessions/current', 'GET /health/live',
  'GET /health/ready', 'GET /api/v1/status',
])
const violations = new WeakMap<Page, string[]>()
const pageErrors = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page, baseURL }) => {
  const invalid: string[] = []
  const errors: string[] = []
  violations.set(page, invalid)
  pageErrors.set(page, errors)
  page.on('pageerror', () => errors.push('Browser script error'))
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin !== baseURL || url.search || url.hash) {
      invalid.push('Unexpected origin or URL parameters')
    } else if (!allowed.has(`${request.method()} ${url.pathname}`) &&
      !(request.method() === 'GET' && (['/', '/index.html', '/hydrodb.svg'].includes(url.pathname) ||
        /^\/assets\/[^/]+$/.test(url.pathname)))) {
      invalid.push(`${request.method()} ${url.pathname}`)
    }
  })
})

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  expect(violations.get(page)).toEqual([])
  expect(pageErrors.get(page)).toEqual([])
})

async function login(page: Page) {
  await openIdentity(page)
  await page.getByLabel('Username', { exact: true }).fill('browser-test-reader')
  await page.getByLabel('Password', { exact: true }).fill(await readerPassword())
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await selectMenu(page, 'Tools', 'Health')
  await expect(page.getByText('Authenticated database read succeeded', { exact: true })).toBeVisible()
}

async function tabTo(page: Page, control: Locator) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await control.evaluate((element) => element === document.activeElement)) break
    await page.keyboard.press('Tab')
  }
  await expect(control).toBeFocused()
}

test('verified HTTPS, native zoom, keyboard login, restoration and confirmed logout', async ({ page, context, browserName }, testInfo) => {
  await page.goto('/')
  await expect(page.getByText('Backend/database ready', { exact: true })).toBeVisible()
  const metrics = await page.evaluate(() => ({
    dpr: devicePixelRatio, width: innerWidth, scroll: document.documentElement.scrollWidth,
    applicationWidth: document.querySelector('.application')!.getBoundingClientRect().width,
    contentWidth: document.documentElement.clientWidth,
  }))
  expect(metrics.dpr).toBeCloseTo(Number(testInfo.project.metadata.zoom ?? 1), 1)
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.width)
  expect(metrics.applicationWidth).toBe(metrics.contentWidth)
  console.log(`${browserName}: ${await page.evaluate(() => navigator.userAgent)}; native zoom=${metrics.dpr}`)
  await page.keyboard.press('Tab')
  for (const title of ['Settings']) {
    const control = page.getByRole('button', { name: title, exact: true })
    await expect(control).toBeFocused()
    await page.keyboard.press('Enter')
    const popup = page.getByRole('dialog', { name: title, exact: true })
    await expect(popup).toBeVisible()
    await expect(popup.getByText(/will be available here/)).toBeVisible()
    await expect(popup.getByRole('button', { name: `Close ${title.toLowerCase()}` })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(popup).not.toBeVisible()
    await expect(control).toBeFocused()
    await page.keyboard.press('Tab')
  }
  await expect(page.getByRole('button', { name: 'User identity', exact: true })).toBeFocused()
  await expect(page.locator('.identity-label')).toHaveCSS('clip-path', 'inset(50%)')
  await expect(page.getByRole('button', { name: 'User identity', exact: true })).toHaveCSS('border-top-width', '0px')
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Username', { exact: true })).toBeFocused()
  expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineWidth)).toBe('3px')
  await page.keyboard.type('browser-test-reader')
  await page.keyboard.press('Tab')
  await page.keyboard.type('incorrect-acceptance-password')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(page.getByText(/Invalid username or password/)).toBeVisible()
  expect(await page.getByLabel('Password', { exact: true }).inputValue() === '').toBe(true)
  await tabTo(page, page.getByLabel('Password', { exact: true }))
  await page.keyboard.type(await readerPassword())
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await selectMenu(page, 'Tools', 'Health')
  await expect(page.getByText('Authenticated database read succeeded', { exact: true })).toBeVisible()
  const cookie = (await context.cookies()).find((item) => item.name === 'hydrodb_session')
  expect(Boolean(cookie?.httpOnly && cookie.secure && cookie.sameSite === 'Strict')).toBe(true)
  expect(await page.evaluate(() => !document.cookie.includes('hydrodb_session'))).toBe(true)
  expect(await page.evaluate(() =>
    Object.keys(localStorage).every((key) => key.startsWith('hydrodb.workspace:')) &&
    Object.keys(sessionStorage).length === 0)).toBe(true)
  await page.reload()
  await expect(page.getByRole('button', { name: 'User identity', exact: true })).toContainText('browser-test-reader')
  await expect(page.getByText('Authenticated database read succeeded', { exact: true })).toBeVisible()
  await expect(page.getByText('0.1.0', { exact: true })).toBeVisible()
  await expect(page.getByText('25', { exact: true })).toBeVisible()
  const firstTime = await page.locator('time').getAttribute('datetime')
  await tabTo(page, page.getByRole('button', { name: 'User identity', exact: true }))
  await expect(page.getByRole('button', { name: 'User identity', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeFocused()
  await expect(page.getByRole('dialog', { name: 'User identity', exact: true }).getByRole('button', { name: 'Check session', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  const health = page.getByRole('region', { name: 'Backend and database health', exact: true })
  await tabTo(page, health.getByRole('button', { name: 'Check session', exact: true }))
  const sessionCheck = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/v1/auth/me' && response.request().method() === 'GET')
  await page.keyboard.press('Enter')
  expect((await sessionCheck).status()).toBe(200)
  await expect(health.getByText('Authenticated database read succeeded', { exact: true })).toBeVisible()
  await tabTo(page, page.getByRole('button', { name: 'Check health again', exact: true }))
  await page.keyboard.press('Enter')
  await expect(page.getByText('Authenticated database read succeeded', { exact: true })).toBeVisible()
  expect(await page.locator('time').getAttribute('datetime')).not.toBe(firstTime)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const csrfDenied = await context.request.delete('/api/v1/auth/sessions/current')
  expect(csrfDenied.status()).toBe(403)
  await tabTo(page, page.getByRole('button', { name: 'User identity', exact: true }))
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Signed out. Server session revoked.', { exact: true })).toBeVisible()
  expect((await context.request.get('/api/v1/auth/me')).status()).toBe(401)
  await page.reload()
  await openIdentity(page)
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
})

test('throttled, unavailable and uncertain sign-in results are distinct and never auto-retried', async ({ page }) => {
  await page.goto('/')
  await openIdentity(page)
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible()
  let submissions = 0
  for (const scenario of ['throttle', 'unavailable', 'network', 'malformed']) {
    await page.route('**/api/v1/auth/sessions', async (route) => {
      submissions++
      if (scenario === 'network') return route.abort('failed')
      await route.fulfill({
        status: scenario === 'throttle' ? 429 : scenario === 'unavailable' ? 503 : 200,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
        body: scenario === 'malformed' ? '{"unexpected":true}' : JSON.stringify({
          code: scenario === 'throttle' ? 'SIGN_IN_THROTTLED' : 'DEPENDENCY_UNAVAILABLE',
          message: 'UNSAFE-SERVER-DETAIL', request_id: null,
        }),
      })
    })
    await page.getByLabel('Username', { exact: true }).fill('browser-test-reader')
    await page.getByLabel('Password', { exact: true }).fill('synthetic-negative-case')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    if (scenario === 'throttle' || scenario === 'unavailable') {
      await expect(page.getByText(scenario === 'throttle' ? /Retry in 60 seconds/ : /backend dependency is unavailable/)).toBeVisible()
      expect(await page.getByLabel('Password', { exact: true }).inputValue() === '').toBe(true)
    } else {
      await expect(page.getByText(/Sign-in result could not be verified/)).toBeVisible()
      await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0)
      await page.getByRole('button', { name: 'Retry session check', exact: true }).click()
      await expect(page.getByLabel('Password', { exact: true })).toBeVisible()
    }
    await expect(page.getByText('UNSAFE-SERVER-DETAIL')).toHaveCount(0)
    await page.unroute('**/api/v1/auth/sessions')
  }
  expect(submissions).toBe(4)
})

test('readiness reasons, failed logout, authenticated denial and expiry remain explicit', async ({ page }) => {
  await page.goto('/')
  await login(page)
  await page.route('**/health/ready', (route) => route.fulfill({
    status: 503, contentType: 'application/json',
    body: '{"status":"not_ready","reasons":["history_fenced","database_unavailable"]}',
  }))
  await page.getByRole('button', { name: 'Check health again', exact: true }).click()
  await expect(page.getByText('history_fenced', { exact: true })).toBeVisible()
  await expect(page.getByText('Backend/database ready', { exact: true })).toHaveCount(0)
  await expect(page.getByText('API process reachable', { exact: true })).toBeVisible()
  await page.unroute('**/health/ready')
  await page.route('**/api/v1/auth/sessions/current', (route) => route.abort('failed'))
  await openIdentity(page)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByText(/server-session revocation is not confirmed/)).toBeVisible()
  await expect(page.getByText('Browser Test Reader', { exact: true })).toBeVisible()
  await page.unroute('**/api/v1/auth/sessions/current')
  await page.route('**/api/v1/status', (route) => route.fulfill({
    status: 403, contentType: 'application/json',
    body: '{"code":"INSUFFICIENT_CAPABILITY","message":"Denied","request_id":null}',
  }))
  await page.getByRole('button', { name: 'Check health again', exact: true }).click()
  await expect(page.getByText(/Authenticated database read failed:.*HTTP 403/)).toBeVisible()
  await expect(page.getByText('Backend/database ready', { exact: true })).toBeVisible()
  await expect(page.getByText('Schema version', { exact: true })).toHaveCount(0)
  await page.unroute('**/api/v1/status')
  await page.route('**/api/v1/status', (route) => route.fulfill({
    status: 401, contentType: 'application/json',
    body: '{"code":"AUTHENTICATION_REQUIRED","message":"Expired","request_id":null}',
  }))
  await page.getByRole('button', { name: 'Check health again', exact: true }).click()
  await expect(page.getByText('Session expired (HTTP 401). Sign in again.', { exact: true })).toBeVisible()
  await expect(page.getByText('Browser Test Reader', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Schema version', { exact: true })).toHaveCount(0)
})

test('a stalled fetch hits the real ten-second deadline without leaving green results', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Backend/database ready', { exact: true })).toBeVisible()
  await page.evaluate(() => {
    const fetch = window.fetch
    let finish: ((response: Response) => void) | undefined
    window.fetch = (input, init) => input === '/health/ready'
      ? new Promise<Response>((resolve, reject) => {
        finish = resolve
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      }) : fetch(input, init)
    Object.defineProperty(window, 'restoreAcceptanceFetch', { configurable: true, value: () => {
      finish?.(new Response('{"status":"ready"}', { headers: { 'Content-Type': 'application/json' } }))
      window.fetch = fetch
    } })
  })
  try {
    const start = Date.now()
    await page.getByRole('button', { name: 'Check health again', exact: true }).click()
    await expect(page.getByText('Checking backend readiness...', { exact: true })).toBeVisible()
    await expect(page.getByText('Backend/database ready', { exact: true })).toHaveCount(0)
    await expect(page.locator('time')).toHaveCount(0)
    await expect(page.getByText(/Readiness check failed:.*10 seconds/)).toBeVisible({ timeout: 12_000 })
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(9_900)
    expect(elapsed).toBeLessThan(12_000)
    await page.evaluate(() => Reflect.get(window, 'restoreAcceptanceFetch')())
    await expect(page.getByText('Backend/database ready', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Check health again', exact: true }).click()
    await expect(page.getByText('Backend/database ready', { exact: true })).toBeVisible()
  } finally {
    await page.evaluate(() => Reflect.get(window, 'restoreAcceptanceFetch')())
  }
})

test('malformed health success and unavailable restoration never masquerade as healthy or signed out', async ({ page }) => {
  await page.route('**/api/v1/auth/me', (route) => route.abort('failed'))
  await page.route('**/health/ready', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"status":"live"}',
  }))
  await page.goto('/')
  await expect(page.getByText(/unexpected readiness response/)).toBeVisible()
  await expect(page.getByText('Backend/database ready', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Retry session check', exact: true })).toBeVisible()
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0)
  await page.unroute('**/api/v1/auth/me')
  await page.getByRole('button', { name: 'Retry session check', exact: true }).click()
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible()
})
