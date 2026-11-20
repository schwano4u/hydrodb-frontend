import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, checkLiveness, checkReadiness, getDatabaseStatus } from './api'
import type { Readiness } from './api'
import HealthPanel from './HealthPanel'

vi.mock('./api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./api')>(),
  checkLiveness: vi.fn(),
  checkReadiness: vi.fn(),
  getDatabaseStatus: vi.fn(),
}))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(checkLiveness).mockResolvedValue(undefined)
  vi.mocked(checkReadiness).mockResolvedValue({ status: 'ready' })
  vi.mocked(getDatabaseStatus).mockResolvedValue({ service: 'hydrodb', version: '0.1.0', schema_version: 25 })
})
afterEach(() => vi.useRealTimers())

describe('health reporting', () => {
  it('separates liveness from not-ready reasons and skips unauthenticated reads', async () => {
    vi.mocked(checkReadiness).mockResolvedValue({ status: 'not_ready', reasons: ['history_fenced', 'draining'] })
    render(<HealthPanel authenticated={false} expired={false} refreshKey={0} onSessionExpired={vi.fn()} />)
    expect(await screen.findByText('API process reachable')).toBeInTheDocument()
    expect(screen.getByText('Backend/database not ready (HTTP 503).')).toBeInTheDocument()
    expect(screen.getByText('history_fenced')).toBeInTheDocument()
    expect(screen.queryByText('Backend/database ready')).not.toBeInTheDocument()
    expect(getDatabaseStatus).not.toHaveBeenCalled()
    expect(screen.getByText('Requires a verified signed-in session.')).toBeInTheDocument()
  })

  it.each([403, 503])('keeps a failed authenticated read visible beside successful readiness (HTTP %i)', async (status) => {
    vi.mocked(getDatabaseStatus).mockRejectedValue(new ApiError('http', `API request failed (HTTP ${status}).`, status))
    render(<HealthPanel authenticated expired={false} refreshKey={0} onSessionExpired={vi.fn()} />)
    expect(await screen.findByText(/Authenticated database read failed/)).toHaveTextContent(`HTTP ${status}`)
    expect(screen.getByText('Backend/database ready')).toBeInTheDocument()
    expect(screen.queryByText('Authenticated database read succeeded')).not.toBeInTheDocument()
    expect(screen.queryByText('Schema version')).not.toBeInTheDocument()
  })

  it('shows service/schema versions only after a successful authenticated request', async () => {
    render(<HealthPanel authenticated expired={false} refreshKey={0} onSessionExpired={vi.fn()} />)
    expect(await screen.findByText('Authenticated database read succeeded')).toBeInTheDocument()
    expect(screen.getByText('0.1.0')).toBeInTheDocument()
    expect(screen.getByText('25')).toBeInTheDocument()
    expect(screen.queryByText(/read_cutoff/)).not.toBeInTheDocument()
  })

  it('invalidates old healthy results during refresh and timestamps failed checks', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-11-20T08:00:00Z'))
    const { container } = render(<HealthPanel authenticated={false} expired={false} refreshKey={0} onSessionExpired={vi.fn()} />)
    await screen.findByText('Backend/database ready')
    const firstTime = container.querySelector('time')?.dateTime
    expect(firstTime).toBe('2026-11-20T08:00:00.000Z')
    vi.setSystemTime(new Date('2026-11-20T08:01:00Z'))
    let reject: ((reason: ApiError) => void) | undefined
    vi.mocked(checkReadiness).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    fireEvent.click(screen.getByRole('button', { name: 'Check health again' }))
    expect(screen.queryByText('Backend/database ready')).not.toBeInTheDocument()
    expect(screen.getByText('Checking backend readiness...')).toBeInTheDocument()
    expect(container.querySelector('time')).toBeNull()
    await act(async () => reject?.(new ApiError('timeout', 'The API did not respond within 10 seconds.')))
    expect(await screen.findByText(/Readiness check failed/)).toHaveTextContent('10 seconds')
    expect(container.querySelector('time')?.dateTime).toBeTruthy()
    expect(container.querySelector('time')?.dateTime).not.toBe(firstTime)
  })

  it('ignores a superseded ready response after logout and clears protected versions', async () => {
    let finish: ((value: Readiness) => void) | undefined
    vi.mocked(checkReadiness).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const expired = vi.fn()
    const { rerender } = render(<HealthPanel authenticated expired={false} refreshKey={0} onSessionExpired={expired} />)
    const obsoleteSignal = vi.mocked(getDatabaseStatus).mock.calls[0]?.[0]
    vi.mocked(checkReadiness).mockResolvedValue({ status: 'not_ready', reasons: ['database_unavailable'] })
    rerender(<HealthPanel authenticated={false} expired={false} refreshKey={1} onSessionExpired={expired} />)
    await screen.findByText('database_unavailable')
    expect(obsoleteSignal?.aborted).toBe(true)
    await act(async () => finish?.({ status: 'ready' }))
    expect(screen.queryByText('Backend/database ready')).not.toBeInTheDocument()
    expect(screen.queryByText('Schema version')).not.toBeInTheDocument()
  })

  it('notifies session expiry only for a current 401, not a superseded response', async () => {
    let reject: ((reason: ApiError) => void) | undefined
    vi.mocked(getDatabaseStatus).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    const expired = vi.fn()
    const { rerender } = render(<HealthPanel authenticated expired={false} refreshKey={0} onSessionExpired={expired} />)
    rerender(<HealthPanel authenticated={false} expired={false} refreshKey={1} onSessionExpired={expired} />)
    await act(async () => reject?.(new ApiError('http', 'Sign-in required.', 401)))
    expect(expired).not.toHaveBeenCalled()
    vi.mocked(getDatabaseStatus).mockRejectedValueOnce(new ApiError('http', 'Sign-in required.', 401))
    rerender(<HealthPanel authenticated expired={false} refreshKey={2} onSessionExpired={expired} />)
    await waitFor(() => expect(expired).toHaveBeenCalledTimes(1))
  })
})
