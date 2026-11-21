import { Component, lazy, Suspense } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { WorkspaceMenus } from './ApplicationMenu'

const Workspace = lazy(() => import('./Workspace'))

class WorkspaceBoundary extends Component<{ children: ReactNode; health: ReactNode; menuHost?: HTMLElement | null }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed
      ? <section className="workspace-card" role="alert">
        The workspace could not be opened. Login and health checks remain available.
        <button type="button" onClick={() => window.location.reload()}>Reload workspace</button>
        {this.props.health}
        {this.props.menuHost && createPortal(<WorkspaceMenus />, this.props.menuHost)}
      </section>
      : this.props.children
  }
}

export default function WorkspaceSlot({ principalId, onSessionExpired, health, menuHost }: { principalId: string; onSessionExpired: () => void; health: ReactNode; menuHost?: HTMLElement | null }) {
  return (
    <WorkspaceBoundary health={health} menuHost={menuHost}>
      <Suspense fallback={<><p role="status">Opening the read-only workspace...</p>{health}{menuHost && createPortal(<WorkspaceMenus />, menuHost)}</>}>
        <Workspace principalId={principalId} onSessionExpired={onSessionExpired} health={health} menuHost={menuHost} />
      </Suspense>
    </WorkspaceBoundary>
  )
}
