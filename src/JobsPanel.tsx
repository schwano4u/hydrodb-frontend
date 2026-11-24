import { useEffect, useId, useRef, useState } from 'react'
import IconButton from './components/IconButton'
import { downloadBlob } from './downloadBlob'
import TableToolbar from './components/TableToolbar'
import type { ReactNode } from 'react'
import ColumnVisibility from './ColumnVisibility'
import DataTable from './DataTable'
import type { TableColumn, TableSort } from './DataTable'
import DownloadIcon from './DownloadIcon'
import { TablePaging } from './TablePaging'
import TableRefresh from './TableRefresh'
import { ApiError, jobsGet } from './api'
import type { JobsPath } from './api'
import { object } from './metadata'
import { csvCell } from './metadataExport'

const refreshMs = 15_000
const statuses = ['running', 'succeeded', 'partial', 'failed', 'cancelled', 'skipped']
const timedStages = ['discovery', 'acquisition', 'source_wait', 'bind_validate', 'batch_prepare', 'delivery']
const stages = ['initializing', ...timedStages, 'finished']
const countNames = ['source_records', 'captured', 'submitted', 'accepted', 'committed', 'revised', 'unchanged',
  'superseded', 'rejected', 'unconfirmed', 'quarantined', 'retries', 'batches']
const staleMs = 120_000
const overdueMs = 90_000

type RunSummary = {
  run_id: string; job_id: string; trigger: string; config_version: string; status: string; stage: string
  started_at: string; finished_at: string | null; reported_at: string; progress_at: string
}
type Run = RunSummary & {
  window_start: string | null; window_end: string | null
  counts: Record<string, number | null>; stage_seconds: Record<string, number | null>
}
type Job = {
  job_id: string; name: string; feed: string; runner: string; purpose: string; config_version: string
  enabled: boolean | null; cron: string | null; next_scheduled_at: string | null
  last_scheduled_at: string | null; last_success_at: string | null; latest_run: RunSummary | null
}
type Log = { seq: number; logged_at: string; stage: string; severity: string; message: string
  request_id: string | null; backend_job_id: string | null }
type Page<T, C = string> = { items: T[]; next_after: C | null; observed_at: string; total?: number }
type LogsPage = Page<Log, number> & { availability: 'available' | 'expired'; truncated: boolean; retention_days: number }

function malformed(): never { throw new ApiError('malformed', 'The API returned an invalid ETL monitoring response.') }
function string(value: unknown): string { return typeof value === 'string' && value.length <= 1024 ? value : malformed() }
function id(value: unknown) {
  return typeof value === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value) ? value : malformed()
}
function time(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : malformed()
}
function nullable<T>(value: unknown, decode: (value: unknown) => T): T | null {
  return value === null ? null : decode(value)
}
function boolean(value: unknown) { return typeof value === 'boolean' ? value : malformed() }
function sequence(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : malformed()
}
function fields(value: unknown): Record<string, unknown> { return object(value) ? value : malformed() }
function numericFields(value: unknown) {
  return Object.fromEntries(Object.entries(fields(value)).map(([key, count]) => [
    key, nullable(count, (number) => typeof number === 'number' && Number.isFinite(number) && number >= 0 ? number : malformed()),
  ]))
}
function summary(value: unknown): RunSummary {
  const r = fields(value)
  return { run_id: id(r.run_id), job_id: id(r.job_id), trigger: string(r.trigger),
    config_version: string(r.config_version), status: string(r.status), stage: string(r.stage),
    started_at: time(r.started_at), finished_at: nullable(r.finished_at, time),
    reported_at: time(r.reported_at), progress_at: time(r.progress_at) }
}
function run(value: unknown): Run {
  const r = fields(value)
  return { ...summary(r), window_start: nullable(r.window_start, time), window_end: nullable(r.window_end, time),
    counts: numericFields(r.counts), stage_seconds: numericFields(r.stage_seconds) }
}
function job(value: unknown): Job {
  const j = fields(value)
  return { job_id: id(j.job_id), name: string(j.name), feed: string(j.feed), runner: string(j.runner),
    purpose: string(j.purpose), config_version: string(j.config_version), enabled: nullable(j.enabled, boolean),
    cron: nullable(j.cron, string), next_scheduled_at: nullable(j.next_scheduled_at, time),
    last_scheduled_at: nullable(j.last_scheduled_at, time), last_success_at: nullable(j.last_success_at, time),
    latest_run: nullable(j.latest_run, summary) }
}
function log(value: unknown): Log {
  const l = fields(value)
  return { seq: sequence(l.seq), logged_at: time(l.logged_at), stage: string(l.stage), severity: string(l.severity),
    message: string(l.message), request_id: nullable(l.request_id, id), backend_job_id: nullable(l.backend_job_id, id) }
}
function page<T, C>(value: unknown, item: (value: unknown) => T, cursor: (value: unknown) => C): Page<T, C> {
  const p = fields(value)
  if (!Array.isArray(p.items) || p.items.length > 50) malformed()
  return { items: p.items.map(item), next_after: nullable(p.next_after, cursor), observed_at: time(p.observed_at),
    total: p.total === undefined ? undefined : sequence(p.total) }
}
function numbered<T extends { total?: number }>(decode: (value: unknown) => T) {
  return (value: unknown) => {
    const page = decode(value)
    if (page.total === undefined) malformed()
    return page
  }
}
const jobsPage = numbered((value) => page(value, job, id))
const runsPage = numbered((value) => page(value, run, id))
function logsPage(value: unknown): LogsPage {
  const l = fields(value)
  if (l.availability !== 'available' && l.availability !== 'expired') malformed()
  const decoded = page(l, log, sequence)
  if (decoded.items.some((entry, i) => i > 0 && entry.seq <= decoded.items[i - 1]!.seq) ||
    (decoded.next_after !== null && decoded.next_after !== decoded.items.at(-1)?.seq)) malformed()
  return { ...decoded, availability: l.availability, truncated: boolean(l.truncated), retention_days: sequence(l.retention_days) }
}
const logHistoryPage = numbered(logsPage)

type Read<T> = { path: JobsPath; data?: T; error?: string }
type ReadOptions = { active: boolean; revision: number; onExpired: () => void }
function reportError(error: unknown, onExpired: () => void) {
  if (error instanceof ApiError && error.status === 401) onExpired()
  if (error instanceof ApiError && error.status === 403) return 'You do not have permission to view this ETL information.'
  if (error instanceof ApiError && error.status === 404) return 'The requested ETL information is unavailable.'
  return error instanceof ApiError ? error.message : 'Unable to load ETL information.'
}
function mustClear(error: unknown) {
  return error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 404)
}
function useRead<T>(path: JobsPath, decode: (value: unknown) => T, { active, revision, onExpired }: ReadOptions,
  shouldPoll: false | ((data: T) => boolean) = () => true) {
  const [read, setRead] = useState<Read<T> & { revision: number }>()
  const expired = useRef(onExpired)
  const poll = useRef(shouldPoll)
  useEffect(() => { expired.current = onExpired; poll.current = shouldPoll })
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    async function load() {
      try {
        const data = await jobsGet(path, decode, controller.signal)
        if (controller.signal.aborted) return
        setRead({ path, revision, data })
        if (poll.current && poll.current(data)) timer = setTimeout(load, refreshMs)
      } catch (error) {
        if (controller.signal.aborted) return
        const message = reportError(error, expired.current)
        setRead((previous) => ({ path, revision, error: message,
          data: previous?.path === path && !mustClear(error) ? previous.data : undefined }))
        if (poll.current && !mustClear(error)) timer = setTimeout(load, refreshMs)
      }
    }
    void load()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [path, decode, active, revision])
  return read?.path === path ? read : undefined
}
function ReadState<T>({ read, label }: { read?: Read<T>; label: string }) {
  if (read?.error) return <p role="alert">{read.data ? 'Showing last known data. ' : ''}{read.error}</p>
  return read?.data ? null : <p role="status">Loading {label}…</p>
}
function date(value: string | null | undefined) { return value ? new Date(value).toISOString() : 'Unknown' }
function words(value: string) { return value.replaceAll('_', ' ') }
function schedule(job: Job, now: number) {
  if (job.enabled === false) return 'Paused'
  if (!job.enabled || !job.next_scheduled_at) return 'Unknown'
  return now - Date.parse(job.next_scheduled_at) > overdueMs ? 'Missed or overdue tick' : 'Enabled'
}
function runState(run: RunSummary, now: number) {
  if (run.status !== 'running') return words(run.status)
  if (now - Date.parse(run.reported_at) > staleMs) return 'Running · telemetry stale'
  if (now - Date.parse(run.progress_at) > staleMs) return 'Running · progress stalled'
  return 'Running'
}

type JobsColumn<Row, Value = ReactNode> = TableColumn & { value?: (row: Row, now: number) => Value; code?: boolean }
type JobDefinitionColumn = JobsColumn<Job, string>

const jobColumns: readonly JobDefinitionColumn[] = [
  { id: 'name', label: 'Job', width: 245, required: true },
  { id: 'job_id', label: 'Job ID', width: 300, code: true, value: (job) => job.job_id },
  { id: 'purpose', label: 'Purpose', width: 145, value: (job) => job.purpose === 'metadata' ? 'Metadata refresh' : 'Sample acquisition' },
  { id: 'feed', label: 'Feed', width: 105, value: (job) => job.feed },
  { id: 'runner', label: 'Runner', width: 155, value: (job) => job.runner },
  { id: 'config_version', label: 'Configuration version', width: 270, code: true, value: (job) => job.config_version },
  { id: 'cron', label: 'Cron (UTC)', width: 105, value: (job) => job.cron ?? 'Unknown' },
  { id: 'last_scheduled_at', label: 'Last scheduled launch', width: 200, value: (job) => date(job.last_scheduled_at) },
  { id: 'next_scheduled_at', label: 'Next scheduled time', width: 200, value: (job) => date(job.next_scheduled_at) },
  { id: 'last_success_at', label: 'Last successful run', width: 200, value: (job) => date(job.last_success_at) },
  { id: 'schedule_health', label: 'Schedule health', width: 155, value: schedule },
  { id: 'latest_run', label: 'Latest run', width: 175, value: (job, now) => job.latest_run ? runState(job.latest_run, now) : 'No recorded runs' },
]

function duration(start: string, end: string | null, now: number) {
  const seconds = Math.max(0, Math.floor(((end ? Date.parse(end) : now) - Date.parse(start)) / 1000))
  const hours = Math.floor(seconds / 3600)
  return `${hours}h ${Math.floor(seconds / 60) % 60}m ${seconds % 60}s`
}

const defaultRunColumns: readonly JobsColumn<Run>[] = [
  { id: 'run_id', label: 'Run', width: 315, required: true },
  { id: 'started_at', label: 'Started (UTC)', width: 190, value: (run) => date(run.started_at) },
  { id: 'duration', label: 'Duration', width: 105, value: (run, now) => duration(run.started_at, run.finished_at, now) },
  { id: 'trigger', label: 'Trigger', width: 105, value: (run) => run.trigger },
  { id: 'status', label: 'Outcome', width: 170, value: runState },
  { id: 'config_version', label: 'Config', width: 250, value: (run) => <code>{run.config_version}</code> },
]

function finished(run: Run) { return run.finished_at ? date(run.finished_at) : 'Pending' }
function sourceWindow(run: Run) {
  return run.window_start ? `${date(run.window_start)} to ${date(run.window_end)}` : 'Unknown'
}
function count(run: Run, name: string) { return run.counts[name]?.toLocaleString() ?? 'Unknown' }
function stageTime(run: Run, stage: string) {
  const seconds = run.stage_seconds[stage]
  return seconds == null ? 'Unknown' : `${seconds.toFixed(2)} s`
}

const runColumns: readonly JobsColumn<Run>[] = [
  ...defaultRunColumns,
  { id: 'stage', label: 'Stage', width: 145, sortable: false, value: (run) => words(run.stage) },
  { id: 'finished_at', label: 'Finished (UTC)', width: 190, sortable: false, value: finished },
  { id: 'reported_at', label: 'Last report (UTC)', width: 190, sortable: false, value: (run) => date(run.reported_at) },
  { id: 'progress_at', label: 'Last progress (UTC)', width: 190, sortable: false, value: (run) => date(run.progress_at) },
  { id: 'source_window', label: 'Source window', width: 250, sortable: false, value: sourceWindow },
  ...countNames.map((name) => ({ id: `count:${name}`, label: words(name), width: 120, sortable: false,
    value: (run: Run) => count(run, name) })),
  ...timedStages.map((stage) => ({ id: `time:${stage}`, label: `${words(stage)} time`, width: 140, sortable: false,
    value: (run: Run) => stageTime(run, stage) })),
]

type ColumnWidths = Record<string, number>

function JobsTable<Row>({ caption, region, rows, columns, now, rowId, renderName, sort, changeSort, widths, changeWidths }: {
  caption: string; region: string; rows: readonly Row[]; columns: readonly JobsColumn<Row>[]; now: number
  rowId: (row: Row) => string; renderName: (row: Row) => ReactNode; sort?: TableSort
  changeSort: (sort?: TableSort) => void; widths: ColumnWidths; changeWidths: (widths: ColumnWidths) => void
}) {
  const byId = new Map(columns.map((column) => [column.id, column]))
  return <DataTable caption={caption} region={region} rows={rows} rowKey={rowId}
    columns={columns.map((column) => ({ ...column, sortable: column.sortable ?? true }))}
    sort={sort} changeSort={changeSort} widths={widths} changeWidths={changeWidths}
    cell={(row, id) => {
      const column = byId.get(id)
      if (!column?.value) return renderName(row)
      const value = column.value(row, now)
      return column.code ? <code>{value}</code> : value
    }} />
}

function SectionToggle({ expanded, section, content, toggle }: {
  expanded: boolean; section: string; content: string; toggle: () => void
}) {
  const label = `${expanded ? 'Collapse' : 'Expand'} ${section}`
  return <IconButton label={label}
    aria-expanded={expanded} aria-controls={content} onClick={toggle}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d={expanded ? 'm6 9 6 6 6-6' : 'm9 6 6 6-6 6'} /></svg>
  </IconButton>
}

function usePaging() {
  const [index, changePage] = useState(1)
  const [size, setSize] = useState(10)
  return { index, size, changePage, changeSize: (size: number) => { setSize(size); changePage(1) } }
}
function choice(options: string[]) {
  return <><option value="">All</option>{options.map((option) => <option key={option} value={option}>{words(option)}</option>)}</>
}
function queryString(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams({ limit: '50' })
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  return params.toString()
}

async function jobDefinitionsCsv(columns: readonly JobDefinitionColumn[], sort: TableSort | undefined, signal: AbortSignal) {
  const lines = [columns.map(({ label }) => csvCell(label)).join(',')]
  const limit = 50
  const seen = new Set<string>()
  let total: number | undefined
  for (let pageIndex = 1; total === undefined || seen.size < total; pageIndex++) {
    const params = queryString({ page: pageIndex, limit, sort: sort?.column, direction: sort?.direction })
    const page = await jobsGet(`/api/v1/etl/jobs?${params}`, jobsPage, signal)
    total ??= page.total!
    if (page.total !== total || page.items.length !== Math.min(limit, total - seen.size)) {
      throw new ApiError('malformed', 'Job definitions changed during the download. Try again.')
    }
    const now = Date.parse(page.observed_at)
    for (const job of page.items) {
      if (seen.has(job.job_id)) throw new ApiError('malformed', 'Job definitions changed during the download. Try again.')
      seen.add(job.job_id)
      lines.push(columns.map(({ value }) => csvCell(value?.(job, now) ?? job.name)).join(','))
    }
  }
  return new Blob([`${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' })
}

export default function JobsPanel({ active, onExpired }: Omit<ReadOptions, 'revision'>) {
  const content = useId()
  const [expanded, setExpanded] = useState(true)
  const [revision, setRevision] = useState(0)
  const paging = usePaging()
  const [selected, setSelected] = useState<Job>()
  const [visible, setVisible] = useState(() => jobColumns.filter(({ id }) => id !== 'config_version').map(({ id }) => id))
  const [sort, setSort] = useState<TableSort>()
  const [widths, setWidths] = useState<ColumnWidths>({})
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const downloadRequest = useRef<AbortController | null>(null)
  useEffect(() => () => downloadRequest.current?.abort(), [active])
  const options = { active, revision, onExpired }
  const params = queryString({ page: paging.index, limit: paging.size, sort: sort?.column, direction: sort?.direction })
  const read = useRead(`/api/v1/etl/jobs?${params}`, jobsPage, options, false)
  const data = read?.data
  const current = read?.error && !data ? undefined : data?.items.find(({ job_id }) => job_id === selected?.job_id) ?? selected
  const now = data ? Date.parse(data.observed_at) : 0
  const columns = jobColumns.filter(({ id }) => visible.includes(id))

  async function download() {
    if (downloadRequest.current) return
    const controller = new AbortController()
    downloadRequest.current = controller
    setDownloading(true)
    setDownloadError('')
    try {
      const blob = await jobDefinitionsCsv(columns, sort, controller.signal)
      controller.signal.throwIfAborted()
      downloadBlob(blob, 'hydrodb-job-definitions.csv')
    } catch (error) {
      if (!controller.signal.aborted) {
        setDownloadError(error instanceof ApiError ? reportError(error, onExpired) : 'Unable to download job definitions.')
      }
    } finally {
      downloadRequest.current = null
      setDownloading(false)
    }
  }

  return <section className="metadata-panel jobs-panel table-panel" aria-label="ETL Jobs">
    <TableToolbar as="header" controls={<>
      <div className="jobs-section-heading">
        <SectionToggle expanded={expanded} section="job definitions" content={content} toggle={() => setExpanded((value) => !value)} />
        <h3>Job definitions</h3>
      </div>
      {expanded && <ColumnVisibility columns={jobColumns} visible={visible} toggle={(id, checked) => {
        setVisible((current) => checked ? [...current, id] : current.filter((column) => column !== id))
        if (!checked && id === sort?.column) { setSort(undefined); paging.changePage(1) }
      }} />}
    </>} actions={<>
      <TableRefresh label="Refresh jobs" updatedAt={data && date(data.observed_at)}
        disabled={!active} busy={active && read?.revision !== revision}
        onRefresh={() => setRevision((value) => value + 1)} />
      <IconButton label="Download job definitions as CSV" onClick={() => void download()}
        aria-busy={downloading} disabled={!active || !data?.total || downloading}>
        <DownloadIcon />
      </IconButton>
    </>} />
    {downloadError && <p role="alert">{downloadError}</p>}
    <div id={content} hidden={!expanded}>
      <ReadState read={read} label="ETL jobs" />
      <TablePaging {...paging} total={data?.total} ariaLabel="Job pages" />
      {data && (data.items.length ? <JobsTable caption="Job definitions" region="Job definitions" rows={data.items}
        columns={columns} now={now} rowId={(entry) => entry.job_id} sort={sort} widths={widths} changeWidths={setWidths}
        changeSort={(next) => { setSort(next); paging.changePage(1) }}
        renderName={(entry) => <button type="button" className="metadata-link" aria-pressed={entry.job_id === selected?.job_id}
          aria-label={`${entry.name} / ${entry.job_id}`} onClick={() => setSelected(entry)}>{entry.name}</button>} />
        : <p>No ETL jobs on this page.</p>)}
    </div>
    {current && <><hr className="jobs-section-divider" /><JobHistory key={current.job_id} job={current} options={options} /></>}
  </section>
}

function JobHistory({ job, options }: { job: Job; options: ReadOptions }) {
  const content = useId()
  const [expanded, setExpanded] = useState(true)
  const [filters, setFilters] = useState({ start: '', end: '', trigger: '', status: '' })
  const [invalid, setInvalid] = useState(false)
  const paging = usePaging()
  const [selected, setSelected] = useState<string>()
  const [visible, setVisible] = useState(() => defaultRunColumns.map(({ id }) => id))
  const [sort, setSort] = useState<TableSort>()
  const [widths, setWidths] = useState<ColumnWidths>({})
  const params = queryString({ ...filters, page: paging.index, limit: paging.size, sort: sort?.column, direction: sort?.direction })
  const viewOptions = { ...options, active: options.active && expanded }
  const read = useRead(`/api/v1/etl/jobs/${job.job_id}/runs?${params}`, runsPage, viewOptions)
  const data = read?.data
  return <>
    <section aria-label="Job instances">
      <div className="jobs-section-heading">
        <SectionToggle expanded={expanded} section="job instances" content={content} toggle={() => setExpanded((value) => !value)} />
        <h3>Job instances for {job.name}</h3>
        {expanded && <ColumnVisibility columns={runColumns} visible={visible} toggle={(id, checked) => {
          setVisible((current) => checked ? [...current, id] : current.filter((column) => column !== id))
          if (!checked && id === sort?.column) { setSort(undefined); paging.changePage(1) }
        }} />}
      </div>
      <div id={content} hidden={!expanded}>
        <form className="jobs-controls jobs-run-filters" onSubmit={(event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          const utc = (key: string) => {
            const value = String(form.get(key) ?? '')
            return value ? new Date(`${value}Z`).toISOString() : ''
          }
          const start = utc('start')
          const end = utc('end')
          const invalid = Boolean(start && end && Date.parse(start) >= Date.parse(end))
          setInvalid(invalid)
          if (invalid) return
          setFilters({ start, end, trigger: String(form.get('trigger')), status: String(form.get('status')) })
          paging.changePage(1)
          setSelected(undefined)
        }}>
          <div className="jobs-period" role="group" aria-label="Period">
            <span>Period</span>
            <div className="jobs-period-inputs">
              <input name="start" type="datetime-local" aria-label="Period start (UTC)" title="Period start (UTC)" />
              <input name="end" type="datetime-local" aria-label="Period end (UTC)" title="Period end (UTC)" />
            </div>
          </div>
          <label>Trigger <select name="trigger">{choice(['manual', 'scheduled'])}</select></label>
          <label>Outcome <select name="status">{choice(statuses)}</select></label>
          <button type="submit">Filter runs</button>
        </form>
        {invalid && <p role="alert">The end time must be after the start time.</p>}
        <ReadState read={read} label="job instances" />
        <TablePaging {...paging} total={data?.total} ariaLabel="Run pages" />
        {data && (data.items.length ? <JobsTable caption="Job instances" region="Job instance table" rows={data.items}
          columns={runColumns.filter(({ id }) => visible.includes(id))} now={Date.parse(data.observed_at)} rowId={(entry) => entry.run_id}
          sort={sort} widths={widths} changeWidths={setWidths} changeSort={(next) => { setSort(next); paging.changePage(1) }}
          renderName={(entry) => <button type="button" className="metadata-link" aria-pressed={entry.run_id === selected}
            onClick={() => setSelected(entry.run_id)}>{entry.run_id}</button>} /> : <p>No runs match these filters.</p>)}
      </div>
    </section>
    {selected && <>
      <hr className="jobs-section-divider" />
      <SelectedRunLogs key={selected} runId={selected} options={options} />
    </>}
  </>
}

function SelectedRunLogs({ runId, options }: { runId: string; options: ReadOptions }) {
  const content = useId()
  const [expanded, setExpanded] = useState(true)
  const viewOptions = { ...options, active: options.active && expanded }
  const read = useRead(`/api/v1/etl/runs/${runId}`, summary, viewOptions, (run) => run.status === 'running')
  const heading = <>
    <SectionToggle expanded={expanded} section="run logs" content={content} toggle={() => setExpanded((value) => !value)} />
    <h3>Run logs</h3>
  </>
  const status = <ReadState read={read} label="selected run" />
  return <section aria-label="ETL run logs">
    {read?.data ? <RunLogs runId={runId} running={read.data.status === 'running'} options={viewOptions}
      heading={heading} status={status} content={content} expanded={expanded} /> : <>
      <header className="jobs-section-heading">{heading}</header>
      <div id={content} hidden={!expanded}>{status}</div>
    </>}
  </section>
}

function useFollow(path: JobsPath, options: ReadOptions, following: boolean, running: boolean) {
  const [read, setRead] = useState<Read<LogsPage>>()
  const previous = useRef<Read<LogsPage> | undefined>(undefined)
  const expired = useRef(options.onExpired)
  useEffect(() => { expired.current = options.onExpired })
  useEffect(() => {
    if (!options.active || !following) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let before = previous.current?.path === path ? previous.current?.data : undefined
    let cursor = before?.items.at(-1)?.seq
    async function load() {
      try {
        const next = await jobsGet(cursor === undefined ? path : `${path}&after=${cursor}`, logsPage, controller.signal)
        if (controller.signal.aborted) return
        if (cursor !== undefined && next.items.some((entry) => entry.seq <= cursor!)) malformed()
        const buffer = [...(before?.items ?? []), ...next.items]
        const data = { ...next, items: next.availability === 'expired' ? [] : buffer.slice(-200),
          truncated: next.truncated || Boolean(before?.truncated) || buffer.length > 200 }
        before = data
        cursor = data.items.at(-1)?.seq
        previous.current = { path, data }
        setRead(previous.current)
        if (next.next_after !== null || running) timer = setTimeout(load, next.next_after !== null ? 200 : refreshMs)
      } catch (error) {
        if (controller.signal.aborted) return
        if (mustClear(error)) { before = undefined; previous.current = undefined }
        setRead({ path, data: before, error: reportError(error, expired.current) })
        if (!mustClear(error) && running) timer = setTimeout(load, refreshMs)
      }
    }
    void load()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [path, options.active, options.revision, following, running])
  return read?.path === path ? read : undefined
}

const logColumns = [
  { id: 'time', label: 'Timestamp (UTC)', width: 190, required: true },
  { id: 'severity', label: 'Severity', width: 90 },
  { id: 'stage', label: 'Stage', width: 135 },
  { id: 'message', label: 'Message and correlation', width: 430, required: true },
]

function LogTable({ data, follow, visible, widths, changeWidths }: {
  data: LogsPage; follow: boolean; visible: string[]; widths: ColumnWidths; changeWidths: (widths: ColumnWidths) => void
}) {
  const scroll = useRef<HTMLDivElement>(null)
  const last = data.items.at(-1)?.seq
  useEffect(() => {
    if (follow && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [follow, last])
  return <>
    {data.availability === 'expired' && <p role="status">Logs have expired under the {data.retention_days}-day retention policy.</p>}
    {follow && data.truncated && <p role="status">Earlier entries are outside the follow window or no longer retained.</p>}
    {data.availability === 'available' && (data.items.length ? <div ref={scroll} className="jobs-log-scroll" tabIndex={0} aria-label="Log entries">
      <DataTable caption="Run log entries" region="Run log table" rows={data.items} rowKey={(entry) => entry.seq}
        columns={logColumns.filter(({ id }) => visible.includes(id))} widths={widths} changeWidths={changeWidths}
        cell={(entry, column) => {
          switch (column) {
            case 'time': return date(entry.logged_at)
            case 'severity': return entry.severity
            case 'stage': return words(entry.stage)
            default: return <>
              {entry.message}
              {entry.request_id && <div>Request <code>{entry.request_id}</code></div>}
              {entry.backend_job_id && <div><a href={`/api/v1/jobs/${entry.backend_job_id}`} target="_blank" rel="noreferrer">
                Backend job {entry.backend_job_id}<span className="identity-label"> (opens in a new tab)</span>
                <svg className="table-external-link-icon" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M8 3H3v10h10V8m-3-5h3v3m0-3L7.5 8.5" />
                </svg>
              </a></div>}
            </>
          }
        }} />
    </div> : <p>No log entries match these filters.</p>)}
  </>
}

function RunLogs({ runId, running, options, heading, status, content, expanded }: {
  runId: string; running: boolean; options: ReadOptions
  heading: ReactNode; status: ReactNode; content: string; expanded: boolean
}) {
  const [following, setFollowing] = useState(running)
  const [history, setHistory] = useState(!running)
  const [severity, setSeverity] = useState('')
  const [stage, setStage] = useState('')
  const [visible, setVisible] = useState(() => logColumns.map(({ id }) => id))
  const [widths, setWidths] = useState<ColumnWidths>({})
  const paging = usePaging()
  const path: JobsPath = `/api/v1/etl/runs/${runId}/logs?${queryString({ severity, stage })}`
  const feed = useFollow(path, options, following && !history, running)
  const archivePath: JobsPath = `/api/v1/etl/runs/${runId}/logs?${queryString({ severity, stage, page: paging.index, limit: paging.size })}`
  const archive = useRead(archivePath, logHistoryPage,
    { ...options, active: options.active && history }, () => false)
  const read = history ? archive : feed
  return <>
    <header className="jobs-section-heading jobs-logs-heading">
      {heading}
      {expanded && <div className="jobs-controls">
        <ColumnVisibility columns={logColumns} visible={visible} toggle={(id, checked) => {
          setVisible((current) => checked ? [...current, id] : current.filter((column) => column !== id))
        }} />
        <label>Severity <select value={severity} onChange={(event) => { setSeverity(event.target.value); paging.changePage(1); if (!following) setHistory(true) }}>
          {choice(['info', 'warn', 'error'])}</select></label>
        <label>Stage <select value={stage} onChange={(event) => { setStage(event.target.value); paging.changePage(1); if (!following) setHistory(true) }}>
          {choice(stages)}</select></label>
        {(running || !history) && <button type="button" onClick={() => {
          if (following && !history) { setFollowing(false); return }
          setHistory(false); setFollowing(true)
        }}>{following && !history ? 'Pause follow' : 'Follow new entries'}</button>}
        <button type="button" disabled={history} onClick={() => { setHistory(true); setFollowing(false) }}>Browse log history</button>
      </div>}
    </header>
    <div id={content} hidden={!expanded}>
      {status}
      <ReadState read={read} label="logs" />
      {history && <TablePaging {...paging} total={read?.data?.total} ariaLabel="Log pages" />}
      {read?.data && <LogTable data={read.data} follow={following && !history} visible={visible} widths={widths} changeWidths={setWidths} />}
    </div>
  </>
}
