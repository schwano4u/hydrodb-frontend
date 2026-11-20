import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError, checkLiveness, checkReadiness, getCurrentSession, getDatabaseStatus, signIn, signOut,
} from './api'

const id = 'f3d53263-1166-40cf-b856-30093df11d6d'
const token = 'c'.repeat(43)
const expires = '2026-11-21T08:00:00Z'
const principal = { principal_id: id, kind: 'user', display_name: 'Test Reader' }
const login = {
  principal, csrf_token: token,
  session: { absolute_expires_at: expires, idle_timeout_seconds: 1800 },
}
const session = {
  ...principal, username: 'reader',
  credential: { type: 'session', csrf_token: token, absolute_expires_at: expires, idle_expires_at: expires },
}

function respond(body: unknown, status = 200, headers?: HeadersInit) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(status === 204 ? null : JSON.stringify(body), { status, headers }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.useRealTimers())

describe('P0 transport', () => {
  it('uses the cookie session protocol without credentials in URLs or extra operations', async () => {
    const fetchMock = respond(login)
    expect(await signIn('reader', 'password')).toEqual(login)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/sessions', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ username: 'reader', password: 'password' }),
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store',
    }))
    respond(session)
    expect(await getCurrentSession()).toEqual(session)
    const logout = respond(undefined, 204)
    await signOut(token)
    expect(logout).toHaveBeenCalledWith('/api/v1/auth/sessions/current', expect.objectContaining({
      method: 'DELETE', headers: { 'x-csrf-token': token },
    }))
  })

  it('rejects missing CSRF locally and never confirms a failed sign-out', async () => {
    const fetchMock = respond({ code: 'CSRF_TOKEN_INVALID', message: 'Rejected', request_id: id }, 403)
    await expect(signOut('')).rejects.toMatchObject({ kind: 'invalid-input' })
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(signOut(token)).rejects.toMatchObject({ kind: 'http', status: 403, code: 'CSRF_TOKEN_INVALID' })
    respond({}, 200)
    await expect(signOut(token)).rejects.toMatchObject({ kind: 'malformed' })
  })

  it.each([
    [401, 'AUTHENTICATION_FAILED'],
    [403, 'INSUFFICIENT_CAPABILITY'],
    [429, 'SIGN_IN_THROTTLED'],
    [503, 'DEPENDENCY_UNAVAILABLE'],
  ])('decodes HTTP %i without reflecting credentials or automatically retrying', async (status, code) => {
    const secret = 'SECRET-password-cookie-csrf'
    const fetchMock = respond({ code, message: secret, request_id: id, details: { secret } }, status, {
      'Retry-After': '60',
    })
    const error = await signIn('reader', secret).catch((failure: unknown) => failure)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ kind: 'http', status, code, requestId: id, retryAfterSeconds: 60 })
    expect(String(error) + JSON.stringify(error)).not.toContain(secret)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('marks malformed error envelopes and discards unknown diagnostic fields', async () => {
    const secret = 'SECRET'
    respond({ code: secret, message: secret, request_id: secret }, 401)
    const error = await getCurrentSession().catch((failure: unknown) => failure)
    expect(error).toMatchObject({ kind: 'http', status: 401, malformedErrorResponse: true })
    expect(String(error) + JSON.stringify(error)).not.toContain(secret)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>SECRET</html>', { status: 503 })))
    await expect(getDatabaseStatus()).rejects.toMatchObject({
      kind: 'http', status: 503, malformedErrorResponse: true,
    })
  })

  it('keeps process liveness, readiness reasons, and database-backed status separate', async () => {
    respond({ status: 'live' })
    await checkLiveness()
    respond({ status: 'ready' })
    expect(await checkReadiness()).toEqual({ status: 'ready' })
    respond({ status: 'not_ready', reasons: ['database_unavailable', 'history_fenced'] }, 503)
    expect(await checkReadiness()).toEqual({
      status: 'not_ready', reasons: ['database_unavailable', 'history_fenced'],
    })
    respond({ service: 'hydrodb', version: '0.1.0', schema_version: 25, read_cutoff: 'opaque' })
    expect(await getDatabaseStatus()).toEqual({ service: 'hydrodb', version: '0.1.0', schema_version: 25 })
  })

  it.each([
    [() => signIn('reader', 'password'), { ...login, csrf_token: '' }, 200],
    [() => getCurrentSession(), { ...session, credential: { type: 'token' } }, 200],
    [() => checkLiveness(), { status: 'ready' }, 200],
    [() => checkReadiness(), { status: 'not_ready', reasons: [] }, 503],
    [() => checkReadiness(), { status: 'ready' }, 503],
    [() => checkReadiness(), { status: 'not_ready', reasons: ['draining'] }, 200],
    [() => getDatabaseStatus(), { service: 'hydrodb', version: '0.1', schema_version: '25' }, 200],
  ])('rejects malformed or contradictory successful contracts %#', async (operation, body, status) => {
    respond(body, status)
    await expect(operation()).rejects.toMatchObject({ kind: 'malformed' })
  })

  it('rejects invalid JSON and sanitizes network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not JSON')))
    await expect(checkLiveness()).rejects.toMatchObject({ kind: 'malformed' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('SECRET-request-body')))
    const error = await checkLiveness().catch((failure: unknown) => failure)
    expect(error).toMatchObject({ kind: 'network' })
    expect(String(error) + JSON.stringify(error)).not.toContain('SECRET')
  })

  it('bounds the entire response including a stalled body and releases its timer', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_path, init: RequestInit) =>
      Promise.resolve({
        status: 200, ok: true,
        json: () => new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }),
      })))
    const pending = checkLiveness().catch((failure: unknown) => failure)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await pending).toMatchObject({ kind: 'timeout' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels pending and already-obsolete requests without leaking abort reasons', async () => {
    const fetchMock = vi.fn().mockImplementation((_path, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('SECRET', 'AbortError')))
      }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const pending = checkLiveness(controller.signal).catch((failure: unknown) => failure)
    controller.abort('SECRET')
    expect(await pending).toMatchObject({ kind: 'cancelled' })
    await expect(checkLiveness(controller.signal)).rejects.toMatchObject({ kind: 'cancelled' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
