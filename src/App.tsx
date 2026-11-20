import SessionPanel from './SessionPanel'
import './App.css'

export default function App() {
  return (
    <div className="application">
      <header className="header">
        <div className="brand">
          <svg viewBox="0 0 32 32" aria-hidden="true" className="brand-mark">
            <path d="M3 11c5-6 8 6 13 0s8 6 13 0M3 21c5-6 8 6 13 0s8 6 13 0" />
          </svg>
          <h1>HydroDB</h1>
        </div>
        <span className="read-only">Read-only</span>
      </header>
      <main>
        <p className="milestone">P0.4 / Login and health</p>
        <h2>Your HydroDB browser workspace</h2>
        <p className="introduction">
          Sign in to HydroDB and check process liveness, backend readiness, and
          authenticated database access separately.
        </p>
        <SessionPanel />
      </main>
      <footer>Browser-first. No direct PostgreSQL connection. No data editing.</footer>
    </div>
  )
}
