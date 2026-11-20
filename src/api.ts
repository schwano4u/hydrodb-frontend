export type ApiFailure = 'http' | 'timeout' | 'network' | 'cancelled' | 'malformed' | 'invalid-input'

export class ApiError extends Error {
  readonly kind: ApiFailure
  readonly status?: number
  readonly code?: string
  readonly requestId?: string
  readonly retryAfterSeconds?: number
  readonly malformedErrorResponse: boolean

  constructor(
    kind: ApiFailure,
    message: string,
    status?: number,
    code?: string,
    requestId?: string,
    retryAfterSeconds?: number,
    malformedErrorResponse = false,
  ) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
    this.code = code
    this.requestId = requestId
    this.retryAfterSeconds = retryAfterSeconds
    this.malformedErrorResponse = malformedErrorResponse
  }
}

export interface Principal {
  principal_id: string
  kind: 'user'
  display_name: string
}

export interface SignInResult {
  principal: Principal
  csrf_token: string
  session: { absolute_expires_at: string; idle_timeout_seconds: number }
}

export interface CurrentSession extends Principal {
  username: string
  credential: {
    type: 'session'
    csrf_token: string
    absolute_expires_at: string
    idle_expires_at: string
  }
}

export type Readiness =
  | { status: 'ready' }
  | { status: 'not_ready'; reasons: string[] }

export interface DatabaseStatus {
  service: 'hydrodb'
  version: string
  schema_version: number
}

type Endpoint =
  | '/api/v1/auth/sessions'
  | '/api/v1/auth/me'
  | '/api/v1/auth/sessions/current'
  | '/health/live'
  | '/health/ready'
  | '/api/v1/status'

const messages: Record<string, string> = {
  AUTHENTICATION_FAILED: 'Invalid username or password.',
  AUTHENTICATION_REQUIRED: 'Sign-in is required or the session has expired.',
  INSUFFICIENT_CAPABILITY: 'The signed-in user is not permitted to perform this operation.',
  CSRF_TOKEN_INVALID: 'Session verification failed. Check the session before retrying sign-out.',
  SIGN_IN_THROTTLED: 'Too many sign-in attempts. Wait before trying again.',
  DEPENDENCY_UNAVAILABLE: 'A backend dependency is unavailable.',
  HISTORY_FENCED: 'Database history is fenced; operator action is required.',
  INTERNAL_ERROR: 'The backend reported an internal error.',
  INVALID_REQUEST: 'The backend rejected the request.',
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
}

function csrf(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
}

function principal(value: unknown): value is Principal {
  return record(value) && uuid(value.principal_id) && value.kind === 'user' &&
    typeof value.display_name === 'string'
}

function malformed(label: string): never {
  throw new ApiError('malformed', `The API returned an unexpected ${label} response.`)
}

function httpError(response: Response, body: unknown): ApiError {
  const valid = record(body) && nonempty(body.code) && typeof body.message === 'string' &&
    (body.request_id === null || uuid(body.request_id))
  // Only known codes and UUID request IDs enter diagnostics, never server text or details.
  const code = valid && typeof body.code === 'string' && Object.hasOwn(messages, body.code)
    ? body.code : undefined
  const requestId = valid && uuid(body.request_id) ? body.request_id : undefined
  const retry = response.headers.get('retry-after')
  const retryAfter = retry !== null && /^\d+$/.test(retry) && Number.isSafeInteger(Number(retry))
    ? Number(retry) : undefined
  return new ApiError(
    'http',
    `${code ? messages[code] : 'API request failed'} (HTTP ${response.status}).${valid ? '' : ' Invalid API error response.'}`,
    response.status, code, requestId, retryAfter, !valid,
  )
}

async function request<T>(
  path: Endpoint,
  init: RequestInit,
  decode: (body: unknown, status: number) => T,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, 10_000)
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  try {
    controller.signal.throwIfAborted()
    const response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      mode: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
    })
    let body: unknown
    if (response.status !== 204) {
      try {
        body = await response.json()
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
        if (!response.ok) throw httpError(response, undefined)
        malformed('JSON')
      }
    }
    controller.signal.throwIfAborted()
    if (!response.ok && !(path === '/health/ready' && response.status === 503)) {
      throw httpError(response, body)
    }
    return decode(body, response.status)
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ApiError(
        timedOut ? 'timeout' : 'cancelled',
        timedOut ? 'The API did not respond within 10 seconds.' : 'The API request was cancelled.',
      )
    }
    if (error instanceof ApiError) throw error
    throw new ApiError('network', 'Unable to reach the API. Check the connection and try again.')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}

export function signIn(username: string, password: string, signal?: AbortSignal): Promise<SignInResult> {
  return request('/api/v1/auth/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }, (body, status) => {
    if (status !== 200 || !record(body) || !principal(body.principal) ||
      !csrf(body.csrf_token) || !record(body.session) ||
      !timestamp(body.session.absolute_expires_at) ||
      typeof body.session.idle_timeout_seconds !== 'number' ||
      !Number.isSafeInteger(body.session.idle_timeout_seconds) || body.session.idle_timeout_seconds <= 0) {
      malformed('sign-in')
    }
    return {
      principal: {
        principal_id: body.principal.principal_id,
        kind: body.principal.kind,
        display_name: body.principal.display_name,
      },
      csrf_token: body.csrf_token,
      session: {
        absolute_expires_at: body.session.absolute_expires_at,
        idle_timeout_seconds: body.session.idle_timeout_seconds,
      },
    }
  }, signal)
}

export function getCurrentSession(signal?: AbortSignal): Promise<CurrentSession> {
  return request('/api/v1/auth/me', { method: 'GET' }, (body, status) => {
    if (status !== 200 || !principal(body) || !record(body) || !nonempty(body.username) ||
      !record(body.credential) || body.credential.type !== 'session' ||
      !csrf(body.credential.csrf_token) || !timestamp(body.credential.absolute_expires_at) ||
      !timestamp(body.credential.idle_expires_at)) malformed('session')
    return {
      principal_id: body.principal_id,
      kind: body.kind,
      display_name: body.display_name,
      username: body.username,
      credential: {
        type: 'session',
        csrf_token: body.credential.csrf_token,
        absolute_expires_at: body.credential.absolute_expires_at,
        idle_expires_at: body.credential.idle_expires_at,
      },
    }
  }, signal)
}

export function signOut(csrfToken: string, signal?: AbortSignal): Promise<void> {
  if (!csrf(csrfToken)) {
    return Promise.reject(new ApiError('invalid-input', 'A valid session CSRF token is required for sign-out.'))
  }
  return request('/api/v1/auth/sessions/current', {
    method: 'DELETE', headers: { 'x-csrf-token': csrfToken },
  }, (_body, status) => {
    if (status !== 204) malformed('sign-out')
  }, signal)
}

export function checkLiveness(signal?: AbortSignal): Promise<void> {
  return request('/health/live', { method: 'GET' }, (body, status) => {
    if (status !== 200 || !record(body) || body.status !== 'live') malformed('liveness')
  }, signal)
}

export function checkReadiness(signal?: AbortSignal): Promise<Readiness> {
  return request('/health/ready', { method: 'GET' }, (body, status) => {
    if (record(body)) {
      if (status === 200 && body.status === 'ready') return { status: 'ready' }
      if (status === 503 && body.status === 'not_ready' && Array.isArray(body.reasons) &&
        body.reasons.length > 0 && body.reasons.every(nonempty)) {
        return { status: 'not_ready', reasons: body.reasons }
      }
    }
    return malformed('readiness')
  }, signal)
}

export function getDatabaseStatus(signal?: AbortSignal): Promise<DatabaseStatus> {
  return request('/api/v1/status', { method: 'GET' }, (body, status) => {
    if (status !== 200 || !record(body) || body.service !== 'hydrodb' || !nonempty(body.version) ||
      typeof body.schema_version !== 'number' || !Number.isSafeInteger(body.schema_version) ||
      body.schema_version <= 0) malformed('database status')
    return { service: 'hydrodb', version: body.version, schema_version: body.schema_version }
  }, signal)
}
