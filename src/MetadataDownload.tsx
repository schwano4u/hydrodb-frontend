import { useEffect, useId, useRef, useState } from 'react'
import { ApiError } from './api'
import { exportMetadata } from './metadataExport'
import type { ExportFormat } from './metadataExport'
import type { CatalogSort, Collection, MetadataClient, Selection } from './metadata'

export default function MetadataDownload({ client, selection, collection, cutoff, onExpired, columns, sort }: {
  client: MetadataClient; selection: Selection; collection: Collection; cutoff?: string; onExpired: () => void
  columns: string[]; sort?: CatalogSort
}) {
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  useEffect(() => () => controller.current?.abort(), [])

  async function download(format: ExportFormat) {
    if (!cutoff || controller.current) return
    const current = new AbortController()
    controller.current = current
    setBusy(true); setError(''); setMessage('Preparing download...')
    try {
      const blob = await exportMetadata({
        client, selection, collection, cutoff, format, columns, sort, signal: current.signal,
        progress: (rows) => setMessage(`Preparing download: ${rows} matching rows read.`),
      })
      current.signal.throwIfAborted()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url; link.download = `hydrodb-${collection}.${format}`
      document.body.append(link)
      try { link.click() } finally {
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
      setMessage('Download prepared for all matching rows.')
      popup.current?.hidePopover()
    } catch (failure: unknown) {
      if (current.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) { client.clear(); onExpired() }
      setMessage('')
      setError(failure instanceof ApiError ? failure.message : 'The metadata download could not be prepared. Try again.')
    } finally {
      if (controller.current === current) controller.current = null
      if (!current.signal.aborted) setBusy(false)
    }
  }

  return <div className="metadata-download">
    <button type="button" ref={trigger} popoverTarget={id} className="metadata-reload" aria-label="Download table" title="Download table"
      aria-haspopup="dialog" aria-expanded={expanded} disabled={!cutoff}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></svg>
    </button>
    <div id={id} ref={popup} popover="auto" className="metadata-export-popup" role="dialog" aria-label="Download format"
      onToggle={(event) => {
        setExpanded(event.newState === 'open')
        if (event.newState !== 'open') return
        const menu = event.currentTarget
        const bounds = trigger.current!.getBoundingClientRect()
        menu.style.left = `${Math.max(8, Math.min(bounds.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`
        menu.style.top = `${bounds.bottom + 4}px`
        menu.style.maxHeight = `${Math.max(80, innerHeight - bounds.bottom - 12)}px`
        menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
      }}>
    <div className="metadata-export-formats">
      {(['csv', 'json', 'parquet'] as const).map((format) =>
        <button key={format} type="button" disabled={busy} onClick={() => void download(format)}>{format.toUpperCase()}</button>)}
    </div>
    {busy && <p>{message}</p>}
    {busy && <button type="button" onClick={() => {
      controller.current?.abort()
      controller.current = null
      setBusy(false); setMessage('Download cancelled. No file was downloaded.')
    }}>Cancel download</button>}
    </div>
    {message && <p className="identity-label" role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </div>
}
