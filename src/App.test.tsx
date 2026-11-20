import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from './App'

describe('browser foundation', () => {
  it('keeps process liveness separate from unauthenticated session restoration', async () => {
    const request = vi.fn().mockImplementation((path: string) => Promise.resolve(
      path === '/health/live'
        ? new Response(JSON.stringify({ status: 'live' }), { status: 200 })
        : path === '/health/ready'
          ? new Response(JSON.stringify({ status: 'ready' }), { status: 200 })
        : new Response(JSON.stringify({ code: 'AUTHENTICATION_REQUIRED', message: 'Sign in', request_id: null }), { status: 401 }),
    ))
    vi.stubGlobal('fetch', request)
    render(<App />)
    expect(await screen.findByText('API process reachable')).toBeInTheDocument()
    expect(request).toHaveBeenCalledWith('/health/live', expect.objectContaining({
      credentials: 'same-origin',
      redirect: 'error',
    }))
    expect(screen.getByText(/Session identity is shown separately/)).toBeInTheDocument()
    expect(await screen.findByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByText('Backend/database ready')).toBeInTheDocument()
    expect(request.mock.calls.some(([path]) => path === '/api/v1/status')).toBe(false)
  })

  it.each([
    [503, { status: 'not_ready' }, 'HTTP 503'],
    [200, { status: 'ready' }, 'unexpected liveness response'],
  ])('reports failed or invalid responses rather than connectivity success', async (status, body, message) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((path: string) => Promise.resolve(
      path === '/health/live'
        ? new Response(JSON.stringify(body), { status })
        : path === '/health/ready'
          ? new Response(JSON.stringify({ status: 'not_ready', reasons: ['database_unavailable'] }), { status: 503 })
        : new Response(JSON.stringify({ code: 'AUTHENTICATION_REQUIRED', message: 'Sign in', request_id: null }), { status: 401 }),
    )))
    render(<App />)
    expect(await screen.findByText(new RegExp(`Liveness check failed:.*${message}`))).toBeInTheDocument()
    expect(screen.queryByText('API process reachable')).not.toBeInTheDocument()
  })
})
