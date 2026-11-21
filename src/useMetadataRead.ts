import { useEffect, useState } from 'react'
import { ApiError } from './api'
import type { MetadataPath } from './api'
import type { MetadataClient } from './metadata'

export function useMetadataRead<T>(
  path: MetadataPath | null, decode: (body: unknown) => T, client: MetadataClient, onExpired: () => void, onRead?: (data: T) => void,
) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ path: string | null; loading: boolean; data?: T; error?: string }>({ path: null, loading: false })
  useEffect(() => {
    if (!path) return
    const controller = new AbortController()
    void client.read(path, decode, controller.signal).then(
      (data) => { if (!controller.signal.aborted) { onRead?.(data); setState({ path, loading: false, data }) } },
      (error: unknown) => {
        if (controller.signal.aborted) return
        if (error instanceof ApiError && error.status === 401) { client.clear(); onExpired() }
        setState({ path, loading: false, error: error instanceof ApiError
          ? error.message : 'Metadata could not be read. Retry or explicitly refresh the catalog.' })
      },
    )
    return () => controller.abort()
  }, [path, decode, client, onExpired, onRead, attempt])
  return {
    ...(state.path === path ? state : { loading: path !== null, data: undefined, error: undefined }),
    retry: () => { setState({ path, loading: path !== null }); setAttempt((value) => value + 1) },
  }
}
