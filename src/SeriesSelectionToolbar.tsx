import { useEffect, useId, useRef, useState } from 'react'
import IconButton from './components/IconButton'
import { downloadBlob } from './downloadBlob'
import SelectionActionBar from './components/SelectionActionBar'
import DownloadIcon from './DownloadIcon'
import { ApiError } from './api'
import type { DetailSelection, MetadataClient, SelectedSeries } from './metadata'
import type { ExportFormat } from './metadataExport'
import { exportSelectedSamples } from './sampleExport'
import { defaultSampleQuery, readSelectedSeries, seriesSelectionLimit } from './sampleViewer'

export default function SeriesSelectionToolbar({ selections, client, onExpired, onOpen, onClear, onRemove }: {
  selections: SelectedSeries[]; client: MetadataClient; onExpired: () => void
  onOpen: () => void; onClear: () => void; onRemove: (id: string) => void
}) {
  return <SelectionActionBar label="Floating Selection Toolbar" selections={selections} limit={seriesSelectionLimit}
    onOpen={onOpen} onClear={onClear} onRemove={onRemove}
    downloadAction={<SeriesDownload key={JSON.stringify(selections.map(({ id, asOf }) => [id, asOf]))}
      selections={selections} client={client} onExpired={onExpired} />} />
}

function SeriesDownload({ selections, client, onExpired }: {
  selections: DetailSelection[]; client: MetadataClient; onExpired: () => void
}) {
  const [query, setQuery] = useState(() => defaultSampleQuery(selections[0]?.asOf))
  const [format, setFormat] = useState<ExportFormat>('csv')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef<AbortController | null>(null)
  const popup = useRef<HTMLDivElement>(null)
  const id = useId()
  useEffect(() => () => pending.current?.abort(), [])

  async function download() {
    if (pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setBusy(true); setError(''); setStatus('Preparing sample download...')
    try {
      const datasets = await readSelectedSeries(client, selections, query, controller.signal)
      const blob = await exportSelectedSamples(datasets, format, controller.signal)
      controller.signal.throwIfAborted()
      downloadBlob(blob, `hydrodb-samples.${format}`)
      popup.current?.hidePopover()
      setStatus('Sample download prepared.')
    } catch (failure: unknown) {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) { client.clear(); onExpired() }
      setStatus('')
      setError(failure instanceof ApiError ? failure.message : 'The sample download could not be prepared. Try again.')
    } finally {
      if (pending.current === controller) {
        pending.current = null
        setBusy(false)
      }
    }
  }

  return <>
    <IconButton label="Download samples" popoverTarget={id} aria-haspopup="dialog">
      <DownloadIcon />
    </IconButton>
    <div className="series-download-popover" id={id} ref={popup} popover="auto" role="dialog" aria-label="Download selected samples">
      <form className="sample-query" onSubmit={(event) => { event.preventDefault(); void download() }}>
        {(['start', 'end'] as const).map((field) => <label key={field}>
          {field === 'start' ? 'Start UTC (inclusive)' : 'End UTC (exclusive)'}
          <input type="text" required value={query[field]} disabled={busy}
            onChange={(event) => setQuery({ ...query, [field]: event.target.value })} />
        </label>)}
        <label>Format<select value={format} disabled={busy} onChange={(event) => {
          const value = event.target.value
          if (value === 'csv' || value === 'json' || value === 'parquet') setFormat(value)
        }}><option value="csv">CSV</option><option value="json">JSON</option><option value="parquet">Parquet</option></select></label>
        <div className="session-actions"><button type="submit" disabled={busy}>Download</button>
          {busy && <button type="button" onClick={() => {
            pending.current?.abort(); pending.current = null; setBusy(false); setStatus('Download cancelled.')
          }}>Cancel download</button>}</div>
        {error && <p role="alert">{error}</p>}
      </form>
    </div>
    {status && <span role="status">{status}</span>}
  </>
}
