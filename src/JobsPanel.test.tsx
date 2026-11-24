import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import JobsPanel from './JobsPanel'

const jobId = '10000000-0000-4000-8000-000000000001'
const runId = '20000000-0000-4000-8000-000000000001'
const requestId = '30000000-0000-4000-8000-000000000001'
const now = new Date().toISOString()
const windowStart = '2026-11-21T09:00:00.000Z'
const detail = {
  job_id: jobId, run_id: runId, trigger: 'scheduled', config_version: 'release-1',
  status: 'partial', stage: 'delivery', started_at: now, finished_at: now,
  reported_at: now, progress_at: now, window_start: windowStart, window_end: now,
  counts: { committed: 7, unconfirmed: 1, retries: 0 }, stage_seconds: { discovery: null, delivery: 1.5 },
}
const listing = (items: unknown[], next_after: string | number | null = null, total = items.length) => ({
  items, next_after, observed_at: now, total,
})
const definition = {
  job_id: jobId, name: 'Hydrology', feed: 'pegelonline', runner: 'test-runner', purpose: 'samples',
  config_version: 'release-2', cron: '*/5 * * * *', enabled: true, next_scheduled_at: now,
  last_scheduled_at: now, last_success_at: null, latest_run: detail,
}
const log = {
  seq: 1, logged_at: now, stage: 'delivery', severity: 'warn', message: '<script>test</script>',
  request_id: requestId, backend_job_id: null,
}

beforeEach(() => vi.stubGlobal('ResizeObserver', class {
  readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) { this.callback = callback }
  observe(target: Element) {
    this.callback([{ target, contentRect: { width: 1510 } } as ResizeObserverEntry], this)
  }
  unobserve() {}
  disconnect() {}
}))
afterEach(() => vi.unstubAllGlobals())

function http(path: string) {
  const url = new URL(path, 'https://test.invalid')
  if (url.pathname === '/api/v1/etl/jobs') return Response.json(listing([definition]))
  if (url.pathname.endsWith('/runs')) return Response.json(listing([detail]))
  if (url.pathname.endsWith('/logs')) {
    const entries = [log, ...Array.from({ length: 50 }, (_, index) => ({
      ...log, seq: index + 2, message: `Log event ${index + 2}`, request_id: null,
    }))]
    const limit = Number(url.searchParams.get('limit'))
    const offset = (Number(url.searchParams.get('page')) - 1) * limit
    return Response.json({ ...listing(entries.slice(offset, offset + limit), null, entries.length),
      availability: 'available', truncated: false, retention_days: 7 })
  }
  return Response.json(detail)
}

describe('P0 Jobs', () => {
  it('downloads every job definitions page in the selected sort and visible columns', async () => {
    const definitions = Array.from({ length: 51 }, (_, index) => ({
      ...definition, job_id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      name: index === 50 ? '=last, "quoted"' : `Job ${String(index + 1).padStart(2, '0')}`,
    }))
    const fetch = vi.fn(async (path: string) => {
      const { searchParams } = new URL(path, 'https://test.invalid')
      const limit = Number(searchParams.get('limit'))
      const offset = (Number(searchParams.get('page')) - 1) * limit
      return Response.json(listing(definitions.slice(offset, offset + limit), null, definitions.length))
    })
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:job-definitions')
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = createObjectURL
      static revokeObjectURL = vi.fn()
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      render(<JobsPanel active onExpired={vi.fn()} />)
      const table = await screen.findByRole('table', { name: 'Job definitions' })
      fireEvent.click(screen.getByRole('button', { name: 'Columns' }))
      fireEvent.click(screen.getByLabelText('Runner', { selector: 'input' }))
      fireEvent.click(within(table).getByRole('button', { name: /^Job ID$/ }))
      const download = screen.getByRole('button', { name: 'Download job definitions as CSV' })
      expect(download.previousElementSibling).toContainElement(screen.getByRole('button', { name: 'Refresh jobs' }))
      await waitFor(() => expect(download).toBeEnabled())
      fireEvent.click(download)
      await waitFor(() => expect(click).toHaveBeenCalledOnce())
      expect(click.mock.contexts[0]).toHaveAttribute('download', 'hydrodb-job-definitions.csv')
      expect(fetch.mock.calls.slice(-2).map(([path]) => path)).toEqual([
        '/api/v1/etl/jobs?limit=50&page=1&sort=job_id&direction=asc',
        '/api/v1/etl/jobs?limit=50&page=2&sort=job_id&direction=asc',
      ])
      const blob = createObjectURL.mock.calls[0]![0]
      const lines = (await blob.text()).trimEnd().split('\r\n')
      expect(lines).toHaveLength(52)
      expect(lines[0]).toBe(within(await screen.findByRole('table', { name: 'Job definitions' }))
        .getAllByRole('columnheader').map((header) => `"${header.textContent}"`).join(','))
      expect(lines[1]).toMatch(/^"Job 01","10000000-0000-4000-8000-000000000001",/)
      expect(lines.at(-1)).toContain(`"'=last, ""quoted"""`)
    } finally {
      click.mockRestore()
    }
  })

  it('sorts and resizes both tables and collapses each section independently', async () => {
    const fetch = vi.fn(async (path: string) => http(path))
    vi.stubGlobal('fetch', fetch)
    const { container } = render(<JobsPanel active onExpired={vi.fn()} />)
    const jobTable = await screen.findByRole('table', { name: 'Job definitions' })
    const jobs = within(jobTable)
    const heading = screen.getByRole('heading', { name: 'Job definitions' })
    expect(heading.compareDocumentPosition(screen.getByRole('button', { name: 'Columns' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const resizeJob = await jobs.findByRole('separator', { name: 'Resize Job' })
    const jobWidth = Number(resizeJob.getAttribute('aria-valuenow'))
    const displayedWidth = () => Array.from(jobTable.querySelectorAll('col'), (col) => parseFloat(col.style.width))
    const beforeResize = displayedWidth()
    fireEvent.keyDown(resizeJob, { key: 'ArrowRight' })
    expect(resizeJob).toHaveAttribute('aria-valuenow', String(jobWidth + 10))
    const resized = displayedWidth()
    expect(resized[1]).toBeLessThan(beforeResize[1]!)
    expect(resized.reduce((total, width) => total + width, 0)).toBeCloseTo(100)
    expect(jobs.getByRole('button', { name: /^Job$/ }).querySelector('svg')).toHaveAttribute('data-sort', 'none')
    fireEvent.click(jobs.getByRole('button', { name: /^Job$/ }))
    let table = within(await screen.findByRole('table', { name: 'Job definitions' }))
    expect(table.getByRole('columnheader', { name: /^Job$/ })).toHaveAttribute('aria-sort', 'ascending')
    expect(table.getByRole('button', { name: /^Job$/ }).querySelector('svg')).toHaveAttribute('data-sort', 'asc')
    expect(await table.findByRole('separator', { name: 'Resize Job' })).toHaveAttribute('aria-valuenow', String(jobWidth + 10))
    fireEvent.click(table.getByRole('button', { name: /^Job$/ }))
    table = within(await screen.findByRole('table', { name: 'Job definitions' }))
    expect(table.getByRole('columnheader', { name: /^Job$/ })).toHaveAttribute('aria-sort', 'descending')
    expect(table.getByRole('button', { name: /^Job$/ }).querySelector('svg')).toHaveAttribute('data-sort', 'desc')
    expect(fetch.mock.calls.some(([path]) => path.includes('sort=name&direction=desc'))).toBe(true)
    fireEvent.click(table.getByRole('button', { name: /^Job$/ }))
    table = within(await screen.findByRole('table', { name: 'Job definitions' }))
    expect(table.getByRole('columnheader', { name: /^Job$/ })).not.toHaveAttribute('aria-sort')
    expect(table.getByRole('button', { name: /^Job$/ }).querySelector('svg')).toHaveAttribute('data-sort', 'none')
    expect(fetch.mock.calls.at(-1)?.[0]).toBe('/api/v1/etl/jobs?limit=10&page=1')

    fireEvent.click(table.getByRole('button', { name: /Hydrology/ }))
    const history = within(await screen.findByRole('region', { name: 'Job instances' }))
    expect(history.getByRole('heading', { name: 'Job instances for Hydrology' })).toBeVisible()
    const runTable = await history.findByRole('table', { name: 'Job instances' })
    let runs = within(runTable)
    expect(container.querySelector('hr.jobs-section-divider')).toBeInTheDocument()
    const resizeRun = await runs.findByRole('separator', { name: 'Resize Duration' })
    const runWidth = Number(resizeRun.getAttribute('aria-valuenow'))
    const runWidths = () => Array.from(runTable.querySelectorAll('col'), (col) => parseFloat(col.style.width))
    const beforeRunResize = runWidths()
    fireEvent.keyDown(resizeRun, { key: 'ArrowLeft' })
    const afterRunResize = runWidths()
    expect(afterRunResize.slice(0, 2)).toEqual(beforeRunResize.slice(0, 2))
    expect(afterRunResize[3]).toBeGreaterThan(beforeRunResize[3]!)
    for (let index = 4; index < afterRunResize.length; index++) {
      expect(afterRunResize[index]! / beforeRunResize[index]!).toBeCloseTo(afterRunResize[3]! / beforeRunResize[3]!, 10)
    }
    expect(afterRunResize.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100)
    expect(runs.queryByRole('separator', { name: 'Resize Config' })).not.toBeInTheDocument()
    fireEvent.keyDown(resizeRun, { key: 'End' })
    expect(resizeRun.getAttribute('aria-valuenow')).toBe(resizeRun.getAttribute('aria-valuemax'))
    fireEvent.keyDown(resizeRun, { key: 'ArrowRight' })
    expect(resizeRun.getAttribute('aria-valuenow')).toBe(resizeRun.getAttribute('aria-valuemax'))
    const clampedRunWidth = resizeRun.getAttribute('aria-valuenow')!
    expect(Number(clampedRunWidth)).toBeGreaterThan(runWidth - 10)
    fireEvent.click(runs.getByRole('button', { name: /^Duration$/ }))
    runs = within(await history.findByRole('table', { name: 'Job instances' }))
    expect(runs.getByRole('columnheader', { name: /^Duration$/ })).toHaveAttribute('aria-sort', 'ascending')
    expect(fetch.mock.calls.some(([path]) => path.includes('/runs?') && path.includes('sort=duration&direction=asc'))).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Collapse job definitions' }))
    expect(screen.queryByRole('table', { name: 'Job definitions' })).not.toBeInTheDocument()
    expect(history.getByRole('table', { name: 'Job instances' })).toBeVisible()
    fireEvent.click(history.getByRole('button', { name: 'Collapse job instances' }))
    expect(history.queryByRole('table', { name: 'Job instances' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Expand job definitions' }))
    expect(screen.getByRole('table', { name: 'Job definitions' })).toBeVisible()
    expect(history.queryByRole('table', { name: 'Job instances' })).not.toBeInTheDocument()
    fireEvent.click(history.getByRole('button', { name: 'Expand job instances' }))
    expect(await history.findByRole('separator', { name: 'Resize Duration' }))
      .toHaveAttribute('aria-valuenow', clampedRunWidth)
  })

  it('uses Metadata-style page sizing and first and last page navigation', async () => {
    const rows = Array.from({ length: 26 }, (_, index) => ({ ...definition,
      name: `Fixture job ${index + 1}`, job_id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    }))
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      const params = new URL(path, 'https://test.invalid').searchParams
      const limit = Number(params.get('limit'))
      const offset = (Number(params.get('page')) - 1) * limit
      return Response.json(listing(rows.slice(offset, offset + limit), null, rows.length))
    }))
    render(<JobsPanel active onExpired={vi.fn()} />)
    const nav = within(screen.getByRole('navigation', { name: 'Job pages' }))
    await nav.findByText('Page 1 / 3')
    expect(nav.getByText('of 26 total rows')).toBeInTheDocument()
    expect(nav.getByLabelText('Rows per page')).toHaveValue('10')
    fireEvent.click(nav.getByRole('button', { name: 'Last page' }))
    await nav.findByText('Page 3 / 3')
    expect(await screen.findByRole('button', { name: /Fixture job 26/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Fixture job 20/ })).not.toBeInTheDocument()
    fireEvent.click(nav.getByRole('button', { name: 'First page' }))
    await nav.findByText('Page 1 / 3')
    expect(await screen.findByRole('button', { name: /Fixture job 1 \/ / })).toBeInTheDocument()
    fireEvent.change(nav.getByLabelText('Rows per page'), { target: { value: '50' } })
    await nav.findByText('Page 1 / 1')
  })

  it('puts job details in configurable columns and hides the configuration version by default', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => http(path)))
    render(<JobsPanel active onExpired={vi.fn()} />)
    const table = await screen.findByRole('table', { name: 'Job definitions' })
    const rows = within(table)
    expect(rows.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Job', 'Job ID', 'Purpose', 'Feed', 'Runner', 'Cron (UTC)', 'Last scheduled launch',
      'Next scheduled time', 'Last successful run', 'Schedule health', 'Latest run',
    ])
    expect(rows.getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      'Hydrology', jobId, 'Sample acquisition', 'pegelonline', 'test-runner', '*/5 * * * *', now, now,
      'Unknown', 'Enabled', 'partial',
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }))
    const configuration = screen.getByLabelText('Configuration version', { selector: 'input' })
    expect(configuration).not.toBeChecked()
    expect(screen.getByLabelText('Job', { selector: 'input', exact: true })).toBeDisabled()
    fireEvent.click(configuration)
    expect(rows.getByRole('columnheader', { name: 'Configuration version' })).toBeInTheDocument()
    expect(rows.getByText('release-2')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Runner', { selector: 'input' }))
    expect(rows.queryByRole('columnheader', { name: 'Runner' })).not.toBeInTheDocument()
    fireEvent.click(rows.getByRole('button', { name: /Hydrology/ }))
    const instances = within(screen.getByRole('region', { name: 'Job instances' }))
    const heading = instances.getByRole('heading', { name: 'Job instances for Hydrology' })
    const picker = instances.getByRole('button', { name: 'Columns' })
    expect(heading.nextElementSibling).toContainElement(picker)
    const runRows = within(await instances.findByRole('table', { name: 'Job instances' }))
    fireEvent.click(picker)
    expect(instances.getByLabelText('Run', { selector: 'input' })).toBeDisabled()
    expect(runRows.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Run', 'Started (UTC)', 'Duration', 'Trigger', 'Outcome', 'Config',
    ])
    for (const field of ['Stage', 'Finished (UTC)', 'Last report (UTC)', 'Last progress (UTC)', 'Source window',
      'source records', 'captured', 'submitted', 'accepted', 'committed', 'revised', 'unchanged', 'superseded',
      'rejected', 'unconfirmed', 'quarantined', 'retries', 'batches', 'discovery time', 'acquisition time',
      'source wait time', 'bind validate time', 'batch prepare time', 'delivery time']) {
      expect(instances.getByLabelText(field, { selector: 'input', exact: true })).not.toBeChecked()
    }
    for (const [field, value] of Object.entries({ Stage: 'delivery', 'Source window': `${windowStart} to ${now}`,
      retries: '0', committed: '7', 'discovery time': 'Unknown', 'delivery time': '1.50 s' })) {
      fireEvent.click(instances.getByLabelText(field, { selector: 'input', exact: true }))
      const header = runRows.getByRole('columnheader', { name: field })
      const index = runRows.getAllByRole('columnheader').indexOf(header)
      expect(runRows.getAllByRole('cell')[index]).toHaveTextContent(value)
    }
    fireEvent.click(instances.getByLabelText('Trigger', { selector: 'input' }))
    expect(runRows.queryByRole('columnheader', { name: 'Trigger' })).not.toBeInTheDocument()
    expect(rows.getByRole('columnheader', { name: 'Configuration version' })).toBeInTheDocument()
    expect(screen.getAllByText('release-2')).toHaveLength(1)
  })

  it('pages correlated logs and collapses them independently of the selected run using GET only', async () => {
    const fetch = vi.fn(async (path: string) => http(path))
    vi.stubGlobal('fetch', fetch)
    render(<JobsPanel active onExpired={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /Hydrology/ }))
    const period = within(screen.getByRole('group', { name: 'Period' }))
    fireEvent.change(period.getByLabelText('Period start (UTC)'), { target: { value: '2026-11-22T09:00' } })
    fireEvent.change(period.getByLabelText('Period end (UTC)'), { target: { value: '2026-11-22T10:00' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Outcome' }), { target: { value: 'partial' } })
    fireEvent.click(screen.getByRole('button', { name: 'Filter runs' }))
    fireEvent.click(await screen.findByRole('button', { name: runId }))
    const entries = await screen.findByRole('table', { name: 'Run log entries' })
    expect(screen.queryByRole('heading', { name: 'Run details' })).not.toBeInTheDocument()
    const runTable = screen.getByRole('table', { name: 'Job instances' })
    expect(runTable.compareDocumentPosition(entries) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const runPager = within(screen.getByRole('navigation', { name: 'Run pages' }))
    expect(runPager.getByLabelText('Rows per page')).toHaveValue('10')
    expect(within(entries).getByText('<script>test</script>')).toBeInTheDocument()
    expect(within(entries).getByText(requestId)).toBeInTheDocument()
    const logSection = screen.getByRole('region', { name: 'ETL run logs' })
    expect(logSection.previousElementSibling).toHaveClass('jobs-section-divider')
    const logs = within(logSection)
    fireEvent.click(logs.getByRole('button', { name: 'Columns' }))
    const picker = within(logs.getByRole('dialog', { hidden: true }))
    expect(picker.getByLabelText('Message and correlation')).toBeDisabled()
    fireEvent.click(picker.getByLabelText('Stage'))
    expect(await within(entries).findByRole('separator', { name: 'Resize Severity' })).toBeInTheDocument()
    const nav = within(screen.getByRole('navigation', { name: 'Log pages' }))
    expect(nav.getByLabelText('Rows per page')).toHaveValue('10')
    fireEvent.click(nav.getByRole('button', { name: 'Next page' }))
    await nav.findByText('Page 2 / 6')
    expect(within(await logs.findByRole('table')).queryByRole('columnheader', { name: 'Stage' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse job instances' }))
    expect(runTable).not.toBeVisible()
    expect(logs.getByRole('table')).toBeVisible()
    fireEvent.click(logs.getByRole('button', { name: 'Collapse run logs' }))
    expect(logs.queryByRole('table')).not.toBeInTheDocument()
    expect(logs.getByRole('heading', { name: 'Run logs', level: 3 })).toBeVisible()
    fireEvent.click(logs.getByRole('button', { name: 'Expand run logs' }))
    expect(await nav.findByText('Page 2 / 6')).toBeVisible()
    expect(within(await logs.findByRole('table')).queryByRole('columnheader', { name: 'Stage' })).not.toBeInTheDocument()
    expect(runTable).not.toBeVisible()
    expect(fetch.mock.calls.some(([path]) => path.includes('/logs?') && path.includes('page=2'))).toBe(true)
    expect(fetch.mock.calls.some(([path]) => {
      const url = new URL(path, 'https://test.invalid')
      return url.pathname.endsWith('/runs') && url.searchParams.get('limit') === '10' && url.searchParams.get('status') === 'partial' &&
        url.searchParams.get('start') === '2026-11-22T09:00:00.000Z' && url.searchParams.get('end') === '2026-11-22T10:00:00.000Z'
    })).toBe(true)
    expect(fetch.mock.calls.every(([, init]: unknown[]) => (init as RequestInit).method === 'GET')).toBe(true)
  })

  it('shows access denial as an error and cancels pending reads when the panel is closed', async () => {
    const fetch = vi.fn(async (_path, options: RequestInit) => {
      if (fetch.mock.calls.length === 1) {
        return Response.json({ code: 'INSUFFICIENT_CAPABILITY', message: 'Denied', request_id: null }, { status: 403 })
      }
      return new Promise<Response>((_resolve, reject) => options.signal?.addEventListener('abort', reject))
    })
    vi.stubGlobal('fetch', fetch)
    const panel = render(<JobsPanel active onExpired={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('permission')
    expect(screen.queryByText('No ETL jobs on this page.')).not.toBeInTheDocument()
    const refresh = screen.getByRole('button', { name: 'Refresh jobs' })
    expect(refresh.querySelector('svg')).toBeInTheDocument()
    expect(refresh).toHaveTextContent(/^$/)
    fireEvent.click(refresh)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    panel.unmount()
    expect(fetch.mock.calls[1]?.[1]?.signal?.aborted).toBe(true)
  })

  it('resumes following a running job from its last log sequence', async () => {
    const logReads: string[] = []
    const fetch = vi.fn(async (path: string) => {
      const url = new URL(path, 'https://test.invalid')
      if (url.pathname.endsWith(`/runs/${runId}`)) {
        return Response.json({ ...detail, status: 'running', finished_at: null })
      }
      if (url.pathname.endsWith('/logs')) {
        const after = url.searchParams.get('after')
        logReads.push(after ?? '')
        return Response.json({ ...listing([{ ...log, seq: after ? 2 : 1, message: after ? 'Second event' : 'First event' }]),
          availability: 'available', truncated: false, retention_days: 7 })
      }
      return http(path)
    })
    vi.stubGlobal('fetch', fetch)
    render(<JobsPanel active onExpired={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /Hydrology/ }))
    fireEvent.click(await screen.findByRole('button', { name: runId }))
    await screen.findByText('First event')
    fireEvent.click(screen.getByRole('button', { name: 'Pause follow' }))
    expect(logReads).toEqual([''])
    fireEvent.click(screen.getByRole('button', { name: 'Follow new entries' }))
    await screen.findByText('Second event')
    expect(logReads).toEqual(['', '1'])
    expect(screen.getAllByText('First event')).toHaveLength(1)
  })
})
