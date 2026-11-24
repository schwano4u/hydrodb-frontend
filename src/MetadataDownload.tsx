import { useEffect, useId, useRef, useState } from 'react'
import IconButton from './components/IconButton'
import { downloadBlob } from './downloadBlob'
import DownloadIcon from './DownloadIcon'
import { ApiError } from './api'
import { exportMetadata } from './metadataExport'
import type { ExportFormat } from './metadataExport'
import type { CatalogSort, Collection, MetadataClient, Selection } from './metadata'
import { downloadMapGeoJson } from './metadataMap'

type Props = {
  client: MetadataClient; selection: Selection; collection: Collection; cutoff?: string; onExpired: () => void
} & ({ kind?: 'table'; columns: string[]; sort?: CatalogSort } | { kind: 'map'; complete: boolean })

export default function MetadataDownload(props: Props) {
  const { client, selection, collection, cutoff, onExpired } = props
  const isMap = props.kind === 'map'
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  useEffect(() => () => controller.current?.abort(), [])

  async function download(format: ExportFormat | 'geojson') {
    if (!cutoff || controller.current) return
    const current = new AbortController()
    controller.current = current
    setBusy(true); setError(''); setMessage('Preparing download...')
    try {
      let blob: Blob
      if (props.kind === 'map') {
        if (!props.complete || selection.asOf || format !== 'geojson') {
          throw new ApiError('invalid-input', 'Wait for the current Station map to finish loading before downloading GeoJSON.')
        }
        blob = await downloadMapGeoJson(client, selection, cutoff, current.signal)
      } else {
        if (format === 'geojson') throw new ApiError('invalid-input', 'GeoJSON is available only for the Station map.')
        blob = await exportMetadata({
          client, selection, collection, cutoff, format, columns: props.columns, sort: props.sort, signal: current.signal,
          progress: (rows) => setMessage(`Preparing download: ${rows} matching rows read.`),
        })
      }
      current.signal.throwIfAborted()
      downloadBlob(blob, `hydrodb-${collection}.${format}`)
      setMessage(isMap ? 'Download prepared for all matching Stations.' : 'Download prepared for all matching rows.')
      popup.current?.hidePopover()
    } catch (failure: unknown) {
      if (current.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) { client.clear(); onExpired() }
      setMessage('')
      setError(failure instanceof ApiError ? failure.message : 'The download could not be prepared. Try again.')
    } finally {
      if (controller.current === current) controller.current = null
      if (!current.signal.aborted) setBusy(false)
    }
  }

  return <div className="metadata-download">
    <IconButton ref={trigger} popoverTarget={id} label={isMap ? 'Download map' : 'Download table'}
      aria-haspopup="dialog" aria-expanded={expanded} disabled={!cutoff || (props.kind === 'map' && (!props.complete || !!selection.asOf))}>
      <DownloadIcon />
    </IconButton>
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
      {(isMap ? ['geojson'] as const : ['csv', 'json', 'parquet'] as const).map((format) =>
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
