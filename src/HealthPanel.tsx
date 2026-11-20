import { useEffect, useState } from 'react'
import { ApiError, checkLiveness, checkReadiness, getDatabaseStatus } from './api'
import type { DatabaseStatus, Readiness } from './api'

type Check<T> = { state: 'success'; value: T } | { state: 'failed'; message: string }
type Snapshot = {
  key: string
  checkedAt: string
  live: Check<void>
  ready: Check<Readiness>
  database: Check<DatabaseStatus | undefined>
}

function result<T>(settled: PromiseSettledResult<T>): Check<T> {
  return settled.status === 'fulfilled'
    ? { state: 'success', value: settled.value }
    : {
      state: 'failed',
      message: settled.reason instanceof ApiError ? settled.reason.message : 'The health check failed.',
    }
}

export default function HealthPanel({
  authenticated, expired, refreshKey, onSessionExpired,
}: {
  authenticated: boolean
  expired: boolean
  refreshKey: number
  onSessionExpired: () => void
}) {
  const [attempt, setAttempt] = useState(0)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const key = `${authenticated}:${refreshKey}:${attempt}`
  const current = snapshot?.key === key ? snapshot : null

  useEffect(() => {
    const controller = new AbortController()
    const database = authenticated
      ? getDatabaseStatus(controller.signal).catch((error: unknown) => {
        if (!controller.signal.aborted && error instanceof ApiError && error.status === 401) {
          onSessionExpired()
        }
        throw error
      })
      : Promise.resolve(undefined)
    void Promise.allSettled([
      checkLiveness(controller.signal),
      checkReadiness(controller.signal),
      database,
    ]).then(([live, ready, status]) => {
      if (controller.signal.aborted) return
      setSnapshot({
        key, checkedAt: new Date().toISOString(),
        live: result(live), ready: result(ready), database: result(status),
      })
    })
    return () => controller.abort()
  }, [authenticated, key, onSessionExpired])

  return (
    <section className="connection-card" aria-labelledby="health-title" aria-busy={!current}>
      <h3 id="health-title">Backend and database health</h3>
      <dl>
        <dt>Backend origin</dt><dd>{window.location.origin}</dd>
        <dt>Transport</dt><dd>Same-origin HTTPS</dd>
        <dt>Last check (UTC)</dt>
        <dd>{current ? <time dateTime={current.checkedAt}>{current.checkedAt}</time> : 'Checking now; previous results are no longer current.'}</dd>
      </dl>
      <h4>API process liveness</h4>
      <div className={`connection-result ${current?.live.state === 'success' ? 'live' : current ? 'failed' : ''}`} role="status">
        {!current ? 'Checking the API process...' : current.live.state === 'success'
          ? 'API process reachable' : `Liveness check failed: ${current.live.message}`}
      </div>
      <p className="scope-note">
        Process liveness does not establish database readiness or authenticate a
        user. Session identity is shown separately above.
      </p>
      <h4>Backend/database readiness</h4>
      <div className={`connection-result ${current?.ready.state === 'success' && current.ready.value.status === 'ready' ? 'live' : current ? 'failed' : ''}`} role="status">
        {!current ? 'Checking backend readiness...' : current.ready.state === 'failed'
          ? `Readiness check failed: ${current.ready.message}`
          : current.ready.value.status === 'ready' ? 'Backend/database ready'
            : 'Backend/database not ready (HTTP 503).'}
        {current?.ready.state === 'success' && current.ready.value.status === 'not_ready' &&
          <ul>{current.ready.value.reasons.map((reason, index) => <li key={`${index}:${reason}`}>{reason}</li>)}</ul>}
      </div>
      <p className="scope-note">
        Readiness includes database access, schema, history, runtime privileges,
        and checkpoint freshness; it is not a database-only check.
      </p>
      <h4>Authenticated database read</h4>
      <div className={`connection-result ${authenticated && current?.database.state === 'success' ? 'live' : authenticated && current ? 'failed' : ''}`} role="status">
        {!authenticated
          ? expired ? 'Session expired (HTTP 401). Sign in again.' : 'Requires a verified signed-in session.'
          : !current ? 'Checking authenticated database access...'
            : current.database.state === 'failed' ? `Authenticated database read failed: ${current.database.message}`
              : 'Authenticated database read succeeded'}
      </div>
      {authenticated && current?.database.state === 'success' && current.database.value && (
        <dl>
          <dt>Service</dt><dd>{current.database.value.service}</dd>
          <dt>Service version</dt><dd>{current.database.value.version}</dd>
          <dt>Schema version</dt><dd>{current.database.value.schema_version}</dd>
        </dl>
      )}
      <button type="button" disabled={!current} onClick={() => setAttempt((value) => value + 1)}>
        Check health again
      </button>
    </section>
  )
}
