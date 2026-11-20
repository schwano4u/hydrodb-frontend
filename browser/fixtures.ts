import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test as base, expect } from '@playwright/test'
import type { BrowserContext } from '@playwright/test'

const target = '/home/ubuntu/hydrodb/staging/test/hydrodb-empty-test'
const ca = process.env.HYDRODB_BROWSER_CA_FILE ?? `${target}/tls/ca.crt`

async function revokeSession(context: BrowserContext) {
  const me = await context.request.get('/api/v1/auth/me')
  if (me.status() === 401) return
  if (me.status() !== 200) throw new Error(`Acceptance identity check failed (HTTP ${me.status()}).`)
  const body: unknown = await me.json()
  if (typeof body !== 'object' || body === null || !('credential' in body) ||
    typeof body.credential !== 'object' || body.credential === null ||
    !('csrf_token' in body.credential) || typeof body.credential.csrf_token !== 'string') {
    throw new Error('Cannot safely revoke acceptance session: malformed identity response.')
  }
  const logout = await context.request.delete('/api/v1/auth/sessions/current', {
    headers: { 'x-csrf-token': body.credential.csrf_token },
  })
  if (logout.status() !== 204) throw new Error(`Acceptance session cleanup failed (HTTP ${logout.status()}).`)
}

export const test = base.extend({
  context: async ({ playwright, browserName, baseURL }, run, testInfo) => {
    const home = await mkdtemp(join(tmpdir(), 'hydrodb-p0-browser-'))
    const profile = join(home, 'profile')
    const nss = browserName === 'firefox' ? profile : join(home, '.pki/nssdb')
    try {
      await mkdir(nss, { recursive: true })
      execFileSync('certutil', ['-N', '--empty-password', '-d', `sql:${nss}`])
      execFileSync('certutil', ['-A', '-d', `sql:${nss}`, '-n', 'HydroDB test CA', '-t', 'C,,', '-i', ca])
      if (browserName === 'chromium') {
        await mkdir(join(home, '.local/share/pki'), { recursive: true })
        await symlink(nss, join(home, '.local/share/pki/nssdb'))
        await mkdir(join(profile, 'Default'), { recursive: true })
        await writeFile(join(profile, 'Default/Preferences'), JSON.stringify({
          // Chromium's default storage partition uses the "x" preference key.
          partition: { default_zoom_level: { x: Math.log(Number(testInfo.project.metadata.zoom ?? 1)) / Math.log(1.2) } },
        }))
      }
      const browser = browserName === 'firefox' ? playwright.firefox : playwright.chromium
      const context = await browser.launchPersistentContext(profile, {
        baseURL,
        headless: true,
        viewport: null,
        ...(browserName === 'chromium' ? { channel: 'chromium' } : {}),
        args: browserName === 'firefox' ? ['--width', '1280', '--height', '1000'] : ['--window-size=1280,1000'],
        env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local/share') },
        ignoreHTTPSErrors: false,
      })
      try {
        await run(context)
      } finally {
        try {
          await revokeSession(context)
        } finally {
          await context.close()
        }
      }
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  },
})

export async function readerPassword(): Promise<string> {
  const file = process.env.HYDRODB_BROWSER_PASSWORD_FILE ?? `${target}/frontend/reader-password`
  return (await readFile(file, 'utf8')).trim()
}

export { expect }
