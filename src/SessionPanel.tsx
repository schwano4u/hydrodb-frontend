import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, getCurrentSession, signIn, signOut } from './api'
import HealthPanel from './HealthPanel'

type Identity = { displayName: string; username: string; csrfToken: string }
type Session =
  | { state: 'restoring' }
  | { state: 'unavailable'; message: string }
  | { state: 'signed-out'; message?: string; expired?: boolean }
  | { state: 'signed-in'; identity: Identity; message?: string }

function failure(error: unknown): string {
  if (!(error instanceof ApiError)) return 'The session operation failed.'
  const retry = error.retryAfterSeconds === undefined
    ? '' : ` Retry in ${error.retryAfterSeconds} seconds.`
  return error.message + retry
}

export default function SessionPanel() {
  const [session, setSession] = useState<Session>({ state: 'restoring' })
  const [busy, setBusy] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const operation = useRef<AbortController | null>(null)
  const [healthRefresh, setHealthRefresh] = useState(0)
  const onSessionChange = () => setHealthRefresh((value) => value + 1)
  const onSessionExpired = useCallback(() => {
    operation.current?.abort()
    operation.current = null
    setBusy(false)
    setPassword('')
    setSession({ state: 'signed-out', expired: true, message: 'Your session has expired. Sign in again.' })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    operation.current = controller
    void getCurrentSession(controller.signal).then(
      (current) => {
        if (controller.signal.aborted) return
        setSession({
          state: 'signed-in',
          identity: {
            displayName: current.display_name,
            username: current.username,
            csrfToken: current.credential.csrf_token,
          },
        })
        setUsername(current.username)
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setSession(error instanceof ApiError && error.status === 401
          ? { state: 'signed-out' }
          : { state: 'unavailable', message: failure(error) })
      },
    ).finally(() => {
      if (operation.current === controller) operation.current = null
    })
    return () => {
      controller.abort()
      operation.current?.abort()
      operation.current = null
    }
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (operation.current || session.state !== 'signed-out') return
    const controller = new AbortController()
    operation.current = controller
    setBusy(true)
    setSession({ state: 'signed-out' })
    try {
      const result = await signIn(username, password, controller.signal)
      if (controller.signal.aborted) return
      setSession({
        state: 'signed-in',
        identity: {
          displayName: result.principal.display_name,
          username,
          csrfToken: result.csrf_token,
        },
      })
      onSessionChange()
    } catch (error) {
      if (!controller.signal.aborted) {
        setSession(error instanceof ApiError && error.kind === 'http'
          ? { state: 'signed-out', message: failure(error) }
          : {
            state: 'unavailable',
            message: `Sign-in result could not be verified. Check the session before submitting again. ${failure(error)}`,
          })
      }
    } finally {
      if (!controller.signal.aborted) {
        setPassword('')
        setBusy(false)
      }
      if (operation.current === controller) operation.current = null
    }
  }

  async function checkSession() {
    if (operation.current) return
    const controller = new AbortController()
    operation.current = controller
    setBusy(true)
    try {
      const current = await getCurrentSession(controller.signal)
      if (controller.signal.aborted) return
      setUsername(current.username)
      setSession({
        state: 'signed-in',
        identity: {
          displayName: current.display_name,
          username: current.username,
          csrfToken: current.credential.csrf_token,
        },
      })
      onSessionChange()
    } catch (error) {
      if (controller.signal.aborted) return
      if (error instanceof ApiError && error.status === 401) {
        setSession({
          state: 'signed-out',
          expired: session.state === 'signed-in',
          message: session.state === 'signed-in' ? 'Your session has expired. Sign in again.' : undefined,
        })
        onSessionChange()
      } else {
        setSession({ state: 'unavailable', message: `Session could not be verified. ${failure(error)}` })
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false)
      if (operation.current === controller) operation.current = null
    }
  }

  async function logout() {
    if (operation.current || session.state !== 'signed-in') return
    const controller = new AbortController()
    operation.current = controller
    setBusy(true)
    try {
      await signOut(session.identity.csrfToken, controller.signal)
      if (controller.signal.aborted) return
      setSession({ state: 'signed-out', message: 'Signed out. Server session revoked.' })
      setPassword('')
      onSessionChange()
    } catch (error) {
      if (controller.signal.aborted) return
      if (error instanceof ApiError && error.status === 401) {
        setSession({ state: 'signed-out', expired: true, message: 'Your session has expired. Sign in again.' })
        onSessionChange()
      } else {
        setSession({
          ...session,
          message: `Sign-out failed; server-session revocation is not confirmed. ${failure(error)}`,
        })
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false)
      if (operation.current === controller) operation.current = null
    }
  }

  return (
    <>
    <section className="connection-card" aria-labelledby="session-title" aria-busy={busy}>
      <h3 id="session-title">Database login</h3>
      <p className="scope-note">
        Sign in to a HydroDB user account, not PostgreSQL. Dataset access remains
        subject to backend permissions.
      </p>
      {session.state === 'restoring' && <p role="status">Checking your existing session...</p>}
      {session.state === 'unavailable' && (
        <>
          <p role="alert">{session.message}</p>
          <button type="button" disabled={busy} onClick={() => void checkSession()}>
            {busy ? 'Checking session...' : 'Retry session check'}
          </button>
        </>
      )}
      {session.state === 'signed-out' && (
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="username">Username</label>
          <input id="username" name="username" autoComplete="username" required
            value={username} onChange={(event) => setUsername(event.target.value)} disabled={busy} />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required
            value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} />
          {session.message && <p role="status">{session.message}</p>}
          <button type="submit" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
        </form>
      )}
      {session.state === 'signed-in' && (
        <>
          <dl>
            <dt>Session identity</dt><dd>{session.identity.displayName}</dd>
            <dt>Username</dt><dd>{session.identity.username}</dd>
          </dl>
          {session.message && <p role="alert">{session.message}</p>}
          <div className="session-actions">
            <button type="button" disabled={busy} onClick={() => void checkSession()}>Check session</button>
            <button type="button" disabled={busy} onClick={() => void logout()}>Sign out</button>
          </div>
          {busy && <p role="status">Updating session...</p>}
        </>
      )}
    </section>
    <HealthPanel
      authenticated={session.state === 'signed-in' && !busy}
      expired={session.state === 'signed-out' && session.expired === true}
      refreshKey={healthRefresh}
      onSessionExpired={onSessionExpired}
    />
    </>
  )
}
