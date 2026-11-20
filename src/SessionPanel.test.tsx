import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, checkLiveness, checkReadiness, getCurrentSession, getDatabaseStatus, signIn, signOut } from './api'
import type { CurrentSession, SignInResult } from './api'
import SessionPanel from './SessionPanel'

vi.mock('./api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./api')>(),
  getCurrentSession: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  checkLiveness: vi.fn(),
  checkReadiness: vi.fn(),
  getDatabaseStatus: vi.fn(),
}))

const token = 'c'.repeat(43)
const identity = { principal_id: 'f3d53263-1166-40cf-b856-30093df11d6d', kind: 'user' as const, display_name: 'Test Reader' }
const current: CurrentSession = {
  ...identity, username: 'reader',
  credential: {
    type: 'session', csrf_token: token,
    absolute_expires_at: '2026-11-21T08:00:00Z', idle_expires_at: '2026-11-20T09:00:00Z',
  },
}
const login: SignInResult = {
  principal: identity, csrf_token: token,
  session: { absolute_expires_at: '2026-11-21T08:00:00Z', idle_timeout_seconds: 1800 },
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getCurrentSession).mockRejectedValue(new ApiError('http', 'Sign-in required.', 401))
  vi.mocked(signIn).mockResolvedValue(login)
  vi.mocked(signOut).mockResolvedValue(undefined)
  vi.mocked(checkLiveness).mockResolvedValue(undefined)
  vi.mocked(checkReadiness).mockResolvedValue({ status: 'ready' })
  vi.mocked(getDatabaseStatus).mockResolvedValue({ service: 'hydrodb', version: '0.1.0', schema_version: 25 })
})

async function fillLogin() {
  fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'reader' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'test-password' } })
}

describe('browser sessions', () => {
  it('restores an existing cookie session without showing a password or CSRF token', async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(current)
    render(<SessionPanel />)
    expect(await screen.findByText('Test Reader')).toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(screen.queryByText(token)).not.toBeInTheDocument()
  })

  it('submits once and confirms sign-out using the returned CSRF token', async () => {
    render(<SessionPanel />)
    await fillLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Test Reader')).toBeInTheDocument()
    expect(signIn).toHaveBeenCalledExactlyOnceWith('reader', 'test-password', expect.any(AbortSignal))
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByText('Signed out. Server session revoked.')).toBeInTheDocument()
    expect(signOut).toHaveBeenCalledExactlyOnceWith(token, expect.any(AbortSignal))
    expect(screen.getByLabelText('Password')).toHaveValue('')
    expect(screen.queryByText('Authenticated database read succeeded')).not.toBeInTheDocument()
  })

  it.each([
    new ApiError('http', 'Invalid username or password.', 401),
    new ApiError('http', 'Too many sign-in attempts.', 429, 'SIGN_IN_THROTTLED', undefined, 60),
    new ApiError('network', 'Unable to reach the API.'),
  ])('clears submitted passwords and exposes distinct sign-in failures %#', async (error) => {
    vi.mocked(signIn).mockRejectedValue(error)
    render(<SessionPanel />)
    await fillLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText(new RegExp(error.message))).toBeInTheDocument()
    if (error.kind === 'network') {
      expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
      vi.mocked(getCurrentSession).mockResolvedValue(current)
      fireEvent.click(screen.getByRole('button', { name: 'Retry session check' }))
      expect(await screen.findByText('Test Reader')).toBeInTheDocument()
    } else {
      expect(screen.getByLabelText('Password')).toHaveValue('')
    }
    expect(signIn).toHaveBeenCalledTimes(1)
    if (error.status === 429) expect(screen.getByText(/Retry in 60 seconds/)).toBeInTheDocument()
  })

  it('does not turn restoration network failure into signed-out state; explicit retry recovers', async () => {
    vi.mocked(getCurrentSession).mockRejectedValueOnce(new ApiError('network', 'Unable to reach the API.'))
    render(<SessionPanel />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to reach the API.')
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    vi.mocked(getCurrentSession).mockResolvedValue(current)
    fireEvent.click(screen.getByRole('button', { name: 'Retry session check' }))
    expect(await screen.findByText('Test Reader')).toBeInTheDocument()
  })

  it('clears identity and token on a confirmed expired session', async () => {
    vi.mocked(getCurrentSession).mockResolvedValueOnce(current)
    render(<SessionPanel />)
    await screen.findByText('Test Reader')
    fireEvent.click(screen.getByRole('button', { name: 'Check session' }))
    expect(await screen.findByText('Your session has expired. Sign in again.')).toBeInTheDocument()
    expect(screen.queryByText('Test Reader')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })

  it('does not claim revocation after failed logout and allows retry', async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(current)
    vi.mocked(signOut).mockRejectedValueOnce(new ApiError('network', 'Unable to reach the API.'))
    render(<SessionPanel />)
    await screen.findByText('Test Reader')
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('server-session revocation is not confirmed')
    expect(screen.getByText('Test Reader')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByText('Signed out. Server session revoked.')).toBeInTheDocument()
  })

  it('prevents duplicate submissions and ignores completion after unmount', async () => {
    let finish: ((value: SignInResult) => void) | undefined
    vi.mocked(signIn).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const { unmount } = render(<SessionPanel />)
    await fillLogin()
    const form = screen.getByRole('button', { name: 'Sign in' }).closest('form')
    expect(form).not.toBeNull()
    if (!form) throw new Error('Login form missing')
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(signIn).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Password')).toBeDisabled()
    const signal = vi.mocked(signIn).mock.calls[0]?.[2]
    unmount()
    expect(signal?.aborted).toBe(true)
    await act(async () => finish?.(login))
    await waitFor(() => expect(getDatabaseStatus).not.toHaveBeenCalled())
  })

  it('expires the session when its authenticated health read returns 401', async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(current)
    vi.mocked(getDatabaseStatus).mockRejectedValue(new ApiError('http', 'Sign-in required.', 401))
    render(<SessionPanel />)
    expect(await screen.findByText('Your session has expired. Sign in again.')).toBeInTheDocument()
    expect(screen.getByText('Session expired (HTTP 401). Sign in again.')).toBeInTheDocument()
    expect(screen.queryByText('Test Reader')).not.toBeInTheDocument()
  })
})
