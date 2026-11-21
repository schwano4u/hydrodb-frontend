import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import type { ComponentProps } from 'react'
import MetadataBrowser from './MetadataBrowser'
import { useMetadataSelection } from './useMetadataSelection'
import type { MetadataView } from './useMetadataSelection'
import MetadataDetail from './MetadataDetail'
import { entities, MetadataClient } from './metadata'
import type { Collection } from './metadata'

function node(collection: Collection, id: string) {
  const prefix = entities[collection].prefix
  return {
    collection, status: 'active', position_scope: 'unavailable', references: [],
    item: { [`${prefix}_id`]: id, [`${prefix}_name`]: 'Duplicate name', [`${prefix}_metadata_version`]: 1, [`${prefix}_validity_start`]: '2026-11-20T12:00:00Z' },
  }
}
const reply = (items: unknown[]) => new Response(JSON.stringify({ items, next_after: null, read_cutoff: 'fixed', total: items.length }))

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1510, 400))
  vi.stubGlobal('ResizeObserver', class {
    private callback: () => void
    constructor(callback: () => void) { this.callback = callback }
    observe() { this.callback() }
    disconnect() {}
  })
})
afterEach(() => vi.restoreAllMocks())

function TestBrowser(props: Pick<ComponentProps<typeof MetadataBrowser>, 'client' | 'onExpired' | 'onOpen'>) {
  const state = useMetadataSelection(props)
  const [view, setView] = useState<MetadataView>('By instance type')
  return <>
    <nav>{(['Filters', 'Tree view', 'By instance type'] as const).map((name) =>
      <button key={name} type="button" onClick={() => setView(name)}>{name}</button>)}</nav>
    <MetadataBrowser {...props} state={state} view={view} />
  </>
}

function TestPanels(props: Pick<ComponentProps<typeof MetadataBrowser>, 'client' | 'onExpired' | 'onOpen'>) {
  const state = useMetadataSelection(props)
  return <>{(['Filters', 'Tree view', 'By instance type'] as const).map((view) =>
    <MetadataBrowser key={view} {...props} state={state} view={view} />)}</>
}

describe('shared metadata selection', () => {
  it('paginates only first-level Stations with standard controls and loads every child batch', async () => {
    const requests: URL[] = []
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      const url = new URL(path, 'https://test'); requests.push(url)
      if (url.searchParams.get('mode') === 'values') return reply([{ value: 'A', label: 'Station / A' }])
      if (url.searchParams.get('mode') === 'branches') {
        const after = url.searchParams.get('after')
        return new Response(JSON.stringify({
          items: after ? [{ path: [node('sampling_positions', 'second-child'), node('series', 'second-series')] }]
            : Array.from({ length: 25 }, (_, index) => ({ path: [
              node('sampling_positions', `first-child-${index}`), node('series', index ? `first-series-${index}` : 'first-series'),
            ] })),
          next_after: after ? null : 'child-next', read_cutoff: 'fixed',
        }))
      }
      if (url.searchParams.get('collection') !== 'stations') return reply([node('series', 'initial')])
      const index = Number(url.searchParams.get('page'))
      return new Response(JSON.stringify({
        items: [node('stations', `station-${index}`)], next_after: index < 3 ? 'next' : null,
        read_cutoff: 'fixed', total: 120,
      }))
    }))
    render(<TestPanels client={new MetadataClient()} onExpired={vi.fn()} onOpen={vi.fn()} />)
    const treeElement = screen.getByRole('article', { name: 'Tree view' })
    await within(treeElement).findByRole('region', { name: 'Tree view results' })
    const tree = within(treeElement)
    const paginationElement = tree.getByRole('navigation', { name: 'Tree pagination' })
    const pagination = within(paginationElement)
    const station = await tree.findByRole('button', { name: 'Expand Duplicate name / station-1' })
    expect(pagination.getByLabelText('Rows per page')).toHaveValue('50')
    expect(pagination.getByText('of 120 total rows')).toBeInTheDocument()
    expect(pagination.getByText('Page 1 / 3')).toBeInTheDocument()
    expect(paginationElement.compareDocumentPosition(station) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(pagination.getByRole('button', { name: 'First page' })).toBeDisabled()
    expect(pagination.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    fireEvent.click(station)
    await tree.findByRole('button', { name: 'Duplicate name / second-series' })
    expect(tree.getByRole('button', { name: 'Duplicate name / first-series' })).toBeVisible()
    expect(tree.getAllByRole('button', { name: /^Duplicate name \/ (first-series|second-series)/ })).toHaveLength(26)
    expect(tree.getAllByRole('navigation')).toHaveLength(1)
    expect(requests.filter((url) => url.searchParams.get('mode') === 'branches')
      .map((url) => [url.searchParams.get('after'), url.searchParams.get('read_cutoff')]))
      .toEqual([['', 'fixed'], ['child-next', 'fixed']])
    fireEvent.click(pagination.getByRole('button', { name: 'Last page' }))
    await tree.findByRole('button', { name: 'Expand Duplicate name / station-3' })
    expect(tree.queryByRole('button', { name: /first-series|second-series/ })).not.toBeInTheDocument()
    expect(pagination.getByText('Page 3 / 3')).toBeInTheDocument()
    expect(pagination.getByRole('button', { name: 'Next page' })).toBeDisabled()
    expect(pagination.getByRole('button', { name: 'Last page' })).toBeDisabled()
    fireEvent.click(pagination.getByRole('button', { name: 'Previous page' }))
    await tree.findByRole('button', { name: 'Expand Duplicate name / station-2' })
    fireEvent.change(pagination.getByLabelText('Rows per page'), { target: { value: '10' } })
    await tree.findByRole('button', { name: 'Expand Duplicate name / station-1' })
    const resized = within(tree.getByRole('navigation', { name: 'Tree pagination' }))
    expect(resized.getByText('Page 1 / 12')).toBeInTheDocument()
    expect(requests.at(-1)?.searchParams.get('limit')).toBe('10')
    expect(requests.at(-1)?.searchParams.get('sort')).toBe('label')
    expect(requests.at(-1)?.searchParams.has('after')).toBe(false)
    expect(within(screen.getByRole('article', { name: 'Metadata browser' })).getByLabelText('Rows per page')).toHaveValue('50')
    fireEvent.click(resized.getByRole('button', { name: 'Next page' }))
    await tree.findByRole('button', { name: 'Expand Duplicate name / station-2' })
    fireEvent.click(await within(screen.getByRole('article', { name: 'Metadata browser' })).findByRole('button', { name: 'Reload' }))
    await tree.findByRole('button', { name: 'Expand Duplicate name / station-1' })
    expect(tree.getByText('Page 1 / 12')).toBeInTheDocument()
    fireEvent.click(tree.getByRole('button', { name: 'Next page' }))
    await tree.findByRole('button', { name: 'Expand Duplicate name / station-2' })
    fireEvent.click(await within(screen.getByRole('article', { name: 'Metadata filters' })).findByLabelText('Station / A'))
    await tree.findByRole('button', { name: 'Expand Duplicate name / station-1' })
    expect(tree.getByText('Page 1 / 12')).toBeInTheDocument()
  })

  it('surfaces a later child read failure, retries all children, and cancels reads when a Station closes', async () => {
    let fail = true
    let pending = false
    let childSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      const url = new URL(path, 'https://test')
      if (url.searchParams.get('mode') !== 'branches') return reply([node('stations', 'station')])
      if (!url.searchParams.get('after')) return new Response(JSON.stringify({
        items: [{ path: [node('series', 'first')] }], next_after: 'next', read_cutoff: 'fixed',
      }))
      if (pending) {
        childSignal = init?.signal ?? undefined
        return new Promise<Response>((_resolve, reject) => childSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
      }
      if (fail) return new Response(JSON.stringify({ message: 'Child read unavailable' }), { status: 503 })
      return reply([{ path: [node('series', 'last')] }])
    }))
    const client = new MetadataClient()
    render(<TestBrowser client={client} onExpired={vi.fn()} onOpen={vi.fn()} />)
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Tree view' }))
    const tree = within(await screen.findByRole('region', { name: 'Tree view results' }))
    fireEvent.click(await tree.findByRole('button', { name: 'Expand Duplicate name / station' }))
    await tree.findByRole('alert')
    expect(tree.getByRole('button', { name: 'Duplicate name / first' })).toBeVisible()
    expect(tree.queryByText('No matching child paths. The Station itself matches.')).not.toBeInTheDocument()
    fail = false
    fireEvent.click(tree.getByRole('button', { name: 'Retry metadata read' }))
    await tree.findByRole('button', { name: 'Duplicate name / last' })
    expect(tree.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(tree.getByRole('button', { name: 'Collapse Duplicate name / station' }))
    client.clear()
    pending = true
    fireEvent.click(tree.getByRole('button', { name: 'Expand Duplicate name / station' }))
    await waitFor(() => expect(childSignal).toBeDefined())
    fireEvent.click(tree.getByRole('button', { name: 'Collapse Duplicate name / station' }))
    expect(childSignal?.aborted).toBe(true)
  })

  it('shares filters and exactly one captured cutoff across simultaneously mounted metadata panels', async () => {
    const requests: URL[] = []
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (path: string) => {
      const url = new URL(path, 'https://test'); requests.push(url)
      return url.searchParams.get('mode') === 'values' ? reply([{ value: 'A', label: 'Station / A' }])
        : reply([node(url.searchParams.get('collection') === 'stations' ? 'stations' : 'series', 'row')])
    }))
    render(<TestPanels client={new MetadataClient()} onExpired={vi.fn()} onOpen={vi.fn()} />)
    const filters = within(screen.getByRole('article', { name: 'Metadata filters' }))
    const tree = within(screen.getByRole('article', { name: 'Tree view' }))
    const metadata = within(screen.getByRole('article', { name: 'Metadata browser' }))
    const help = filters.getByRole('button', { name: 'Filter attribute help' })
    const explanation = filters.getByText('Values within an attribute match any selection; different attributes must all match one declared metadata path. At most 12 attributes and 20 values per attribute.')
    expect(explanation).not.toBeVisible()
    expect(help).toHaveAttribute('aria-expanded', 'false')
    expect(help).toHaveAttribute('aria-controls', explanation.id)
    fireEvent.click(help)
    expect(explanation).toBeVisible()
    expect(help).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(help)
    expect(explanation).not.toBeVisible()
    await tree.findByRole('button', { name: 'Expand Duplicate name / row' })
    await metadata.findByRole('button', { name: 'Duplicate name / row' })
    fireEvent.click(await filters.findByLabelText('Station / A'))
    await waitFor(() => expect(new Set(requests.filter((url) =>
      url.searchParams.get('filters')?.includes('"A"') && !url.searchParams.has('mode'))
      .map((url) => url.searchParams.get('collection')))).toEqual(new Set(['series', 'stations'])))
    expect(requests.filter((url) => !url.searchParams.has('read_cutoff'))).toHaveLength(1)
    expect(new Set(requests.map((url) => url.searchParams.get('read_cutoff')).filter(Boolean))).toEqual(new Set(['fixed']))
    const reload = metadata.getByRole('button', { name: 'Reload' })
    expect(reload.textContent).toBe('')
    expect(reload.querySelector('svg')).toBeInTheDocument()
    fireEvent.click(reload)
    await waitFor(() => expect(requests.filter((url) => !url.searchParams.has('read_cutoff'))).toHaveLength(2))
    expect(await filters.findByLabelText('Station / A')).toBeChecked()
  })

  it('toggles every tree branch with icons and omits Units/codebooks without removing their instance lists', async () => {
    const station = node('stations', 'station-1')
    const unit = node('units', 'unit-1')
    const codebook = node('quality_codebooks', 'codebook-1')
    const instrument = node('instruments', 'instrument-1')
    const samplingPosition = node('sampling_positions', 'position-1')
    const parameterGroup = node('parameter_groups', 'group-1')
    const parameter = node('parameters', 'parameter-1')
    const deployment = {
      ...node('instrument_deployments', 'deployment-1'),
      references: [{ field: 'instrument_id', collection: 'instruments', id: 'instrument-1', version: '1' }],
    }
    const series = {
      ...node('series', 'series-1'),
      references: [
        { field: 'unit_id', collection: 'units', id: 'unit-1', version: '1' },
        { field: 'quality_codebook_id', collection: 'quality_codebooks', id: 'codebook-1', version: '1' },
      ],
    }
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (path: string) => {
      const url = new URL(path, 'https://test')
      if (url.searchParams.get('mode') === 'branches') return reply([{ path: [samplingPosition, deployment, instrument, parameterGroup, parameter, series, unit, codebook] }])
      return reply([url.searchParams.get('collection') === 'stations' ? station
        : url.searchParams.get('collection') === 'units' ? unit
          : url.searchParams.get('collection') === 'quality_codebooks' ? codebook : series])
    }))
    const onOpen = vi.fn()
    render(<TestBrowser client={new MetadataClient()} onExpired={vi.fn()} onOpen={onOpen} />)
    expect(screen.queryByRole('heading', { name: 'Metadata browser' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Search names / IDs')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('As-of UTC (blank for current)')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Active selections' })).not.toBeInTheDocument()
    expect(screen.queryByText('No attribute filters. All authorized metadata is available in bounded pages.')).not.toBeInTheDocument()
    await screen.findByText(/End of matching results/)
    fireEvent.click(screen.getByRole('button', { name: 'Tree view' }))
    const tree = within(screen.getByRole('region', { name: 'Tree view results' }))
    const toggle = await tree.findByRole('button', { name: 'Expand Duplicate name / station-1' })
    expect(toggle.textContent).toBe('')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAccessibleName('Collapse Duplicate name / station-1')
    expect(await tree.findByRole('button', { name: 'Duplicate name / instrument-1' })).toBeInTheDocument()
    expect(tree.queryByRole('button', { name: /unit-1|codebook-1/ })).not.toBeInTheDocument()
    expect(tree.queryByText('Units:')).not.toBeInTheDocument()
    expect(tree.queryByText('Quality codebooks:')).not.toBeInTheDocument()
    for (const id of ['position-1', 'deployment-1', 'group-1', 'parameter-1']) {
      const branch = tree.getByRole('button', { name: `Collapse Duplicate name / ${id}` })
      expect(branch.textContent).toBe('')
      fireEvent.click(branch)
      expect(branch).toHaveAttribute('aria-expanded', 'false')
      expect(branch).toHaveAccessibleName(`Expand Duplicate name / ${id}`)
      expect(tree.queryByRole('button', { name: 'Duplicate name / series-1' })).not.toBeInTheDocument()
      fireEvent.click(branch)
      expect(tree.getByRole('button', { name: 'Duplicate name / series-1' })).toBeVisible()
    }
    fireEvent.click(tree.getByRole('button', { name: 'Collapse Duplicate name / parameter-1' }))
    fireEvent.click(tree.getByRole('button', { name: 'Collapse Duplicate name / position-1' }))
    fireEvent.click(tree.getByRole('button', { name: 'Expand Duplicate name / position-1' }))
    expect(tree.getByRole('button', { name: 'Expand Duplicate name / parameter-1' })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(tree.getByRole('button', { name: 'Expand Duplicate name / parameter-1' }))
    expect(tree.queryByRole('button', { name: /^(Expand|Collapse).*\/ (series-1|instrument-1)$/ })).not.toBeInTheDocument()
    fireEvent.click(tree.getByRole('button', { name: 'Duplicate name / series-1' }))
    expect(onOpen).toHaveBeenLastCalledWith({ collection: 'series', id: 'series-1', version: '1', field: '', cutoff: 'fixed', asOf: '' })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(tree.queryByRole('button', { name: 'Duplicate name / instrument-1' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'By instance type' }))
    fireEvent.change(screen.getByLabelText('Instance type'), { target: { value: 'units' } })
    expect(await screen.findByRole('button', { name: 'Duplicate name / unit-1' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Instance type'), { target: { value: 'quality_codebooks' } })
    expect(await screen.findByRole('button', { name: 'Duplicate name / codebook-1' })).toBeInTheDocument()
  })

  it('defaults tree labels to names and changes each instance type independently without rereads or collapsing branches', async () => {
    const treeCollections: Collection[] = ['stations', 'sampling_positions', 'instruments', 'instrument_deployments', 'parameter_groups', 'parameters', 'series']
    const path = treeCollections.slice(1).map((collection) => ({
      ...node(collection, `${collection}-1`),
      references: collection === 'instrument_deployments'
        ? [{ field: 'instrument_id', collection: 'instruments', id: 'instruments-1', version: '1' }] : [],
    }))
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (pathString: string) => {
      requests.push(pathString)
      const url = new URL(pathString, 'https://test')
      if (url.searchParams.get('mode') === 'values') return reply([])
      if (url.searchParams.get('mode') === 'branches') return reply([{ path }])
      return reply([node(url.searchParams.get('collection') === 'stations' ? 'stations' : 'series',
        url.searchParams.get('collection') === 'stations' ? 'stations-1' : 'series-1')])
    }))
    const onOpen = vi.fn()
    render(<TestPanels client={new MetadataClient()} onExpired={vi.fn()} onOpen={onOpen} />)
    const tree = within(await screen.findByRole('region', { name: 'Tree view results' }))
    fireEvent.click(await tree.findByRole('button', { name: 'Expand Duplicate name / stations-1' }))
    await tree.findByRole('button', { name: 'Duplicate name / series-1' })
    const filters = within(screen.getByRole('article', { name: 'Metadata filters' }))
    expect(filters.queryByRole('button', { name: 'Tree naming settings' })).not.toBeInTheDocument()
    const settings = within(screen.getByRole('article', { name: 'Tree view' }))
    expect(settings.getByLabelText('Design')).toHaveValue('station-tree')
    expect(within(settings.getByLabelText('Design')).getByRole('option', { name: 'Station tree' })).toBeInTheDocument()
    expect(settings.getByRole('button', { name: 'Tree naming settings' })).toBeInTheDocument()
    const before = requests.length
    for (const collection of treeCollections) {
      const nameControl = settings.getByLabelText(`${entities[collection].title} Name`)
      const idControl = settings.getByLabelText(`${entities[collection].title} ID`)
      expect(nameControl).toBeChecked()
      expect(nameControl).toBeDisabled()
      expect(idControl).not.toBeChecked()
      expect(tree.getByRole('button', { name: `Duplicate name / ${collection}-1` })).toHaveTextContent(/^Duplicate name\s*$/)
      fireEvent.click(idControl)
      expect(tree.getByRole('button', { name: `Duplicate name / ${collection}-1` })).toHaveTextContent(`Duplicate name / ${collection}-1`)
      expect(nameControl).not.toBeDisabled()
      fireEvent.click(nameControl)
      expect(idControl).toBeDisabled()
      expect(tree.getByRole('button', { name: `Duplicate name / ${collection}-1` })).toHaveTextContent(new RegExp(`^${collection}-1\\s*$`))
    }
    fireEvent.click(settings.getByLabelText('Parameters Name'))
    fireEvent.click(settings.getByLabelText('Parameters ID'))
    expect(tree.getByRole('button', { name: 'Duplicate name / parameters-1' })).toHaveTextContent(/^Duplicate name\s*$/)
    expect(tree.getByRole('button', { name: 'Duplicate name / stations-1' })).toHaveTextContent(/^stations-1\s*$/)
    expect(tree.getByRole('button', { name: 'Collapse Duplicate name / stations-1' })).toHaveAttribute('aria-expanded', 'true')
    expect(requests).toHaveLength(before)
    const table = within(screen.getByRole('article', { name: 'Metadata browser' }))
    expect(table.getByRole('button', { name: 'Duplicate name / series-1' })).toHaveTextContent('Duplicate name / series-1')
    fireEvent.click(tree.getByRole('button', { name: 'Duplicate name / series-1' }))
    expect(onOpen).toHaveBeenLastCalledWith({ collection: 'series', id: 'series-1', version: '1', field: '', cutoff: 'fixed', asOf: '' })
  })

  it('controls visible columns and widths without losing the page, and resets pagination for global sort changes', async () => {
    const requests: URL[] = []
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      const url = new URL(path, 'https://test'); requests.push(url)
      const item = node('series', url.searchParams.get('page') === '2' ? 'second' : 'first')
      return new Response(JSON.stringify({ items: [item], next_after: url.searchParams.get('page') === '2' ? null : 'next', read_cutoff: 'fixed', total: 100 }))
    }))
    render(<TestBrowser client={new MetadataClient()} onExpired={vi.fn()} onOpen={vi.fn()} />)
    const table = await screen.findByRole('table')
    const total = screen.getByText('of 100 total rows')
    expect(total.previousElementSibling).toContainElement(screen.getByLabelText('Rows per page'))
    expect(screen.queryByText('Read context')).not.toBeInTheDocument()
    const next = screen.getByRole('button', { name: 'Next page' })
    expect(next.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(next)
    await screen.findByRole('button', { name: 'Duplicate name / second' })
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }))
    fireEvent.click(screen.getByLabelText('station id', { selector: 'input[type="checkbox"]' }))
    expect(screen.getByRole('table').querySelectorAll('thead th')).toHaveLength(7)
    expect(requests.at(-1)?.searchParams.get('page')).toBe('2')
    const resize = screen.getByRole('separator', { name: 'Resize Name / stable ID' })
    const initialWidth = Number(resize.getAttribute('aria-valuenow'))
    fireEvent.keyDown(resize, { key: 'ArrowRight' })
    expect(Number(resize.getAttribute('aria-valuenow'))).toBe(initialWidth + 10)
    for (let step = 0; step < 4; step++) fireEvent.keyDown(resize, { key: 'ArrowRight' })
    const resizedWidth = resize.getAttribute('aria-valuenow')
    expect(Number(resizedWidth)).toBe(initialWidth + 50)
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'series processing level' }))
    await waitFor(() => expect(requests.at(-1)?.searchParams.get('sort')).toBe('series_processing_level'))
    expect(requests.at(-1)?.searchParams.get('order')).toBe('asc')
    expect(requests.at(-1)?.searchParams.get('page')).toBe('1')
    expect(requests.at(-1)?.searchParams.get('read_cutoff')).toBe('fixed')
    await screen.findByRole('button', { name: 'Duplicate name / first' })
    fireEvent.click(screen.getByRole('button', { name: 'series processing level' }))
    await waitFor(() => expect(requests.at(-1)?.searchParams.get('order')).toBe('desc'))
    await screen.findByRole('button', { name: 'Duplicate name / first' })
    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '25' } })
    await waitFor(() => expect(requests.at(-1)?.searchParams.get('limit')).toBe('25'))
    expect(requests.at(-1)?.searchParams.get('page')).toBe('1')
    await screen.findByText('Page 1 / 4')
    fireEvent.click(screen.getByRole('button', { name: 'Last page' }))
    await waitFor(() => expect(requests.at(-1)?.searchParams.get('page')).toBe('4'))
    await screen.findByText('Page 4 / 4')
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    await screen.findByText('Page 3 / 4')
    fireEvent.change(screen.getByLabelText('Instance type'), { target: { value: 'stations' } })
    await screen.findByRole('table')
    expect(screen.queryByRole('button', { name: 'station location' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'station location status' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Instance type'), { target: { value: 'series' } })
    await screen.findByRole('table')
    expect(await screen.findByRole('separator', { name: 'Resize Name / stable ID' })).toHaveAttribute('aria-valuenow', resizedWidth)
    expect(screen.getByLabelText('station id', { selector: 'input[type="checkbox"]' })).not.toBeChecked()
  })

  it('redistributes only right-hand column widths proportionally, clamps resizing, and supports one visible column', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => reply([])))
    render(<TestBrowser client={new MetadataClient()} onExpired={vi.fn()} onOpen={vi.fn()} />)
    await screen.findByRole('table')
    const resize = await screen.findByRole('separator', { name: 'Resize station id' })
    const table = screen.getByRole('table')
    expect(screen.getByText('of 0 total rows')).toBeInTheDocument()
    const widths = () => Array.from(table.querySelectorAll('col'), (col) => parseFloat(col.style.width))
    const before = widths()
    fireEvent.keyDown(resize, { key: 'ArrowRight' })
    const after = widths()
    expect(after[0]).toBeCloseTo(before[0]!, 10)
    expect(after[1]! - before[1]!).toBeCloseTo(1000 / 1510)
    for (let index = 2; index < before.length; index++) {
      expect(after[index]! / before[index]!).toBeCloseTo(after[2]! / before[2]!, 10)
    }
    expect(after.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100, 10)
    expect(screen.queryByRole('separator', { name: 'Resize series sampling definition' })).not.toBeInTheDocument()
    fireEvent.keyDown(resize, { key: 'End' })
    expect(resize.getAttribute('aria-valuenow')).toBe(resize.getAttribute('aria-valuemax'))
    const maximum = widths()
    fireEvent.keyDown(resize, { key: 'ArrowRight' })
    widths().forEach((width, index) => expect(width).toBeCloseTo(maximum[index]!, 10))
    fireEvent.keyDown(resize, { key: 'Home' })
    expect(resize.getAttribute('aria-valuenow')).toBe(resize.getAttribute('aria-valuemin'))
    expect(widths()[0]).toBeCloseTo(before[0]!, 10)
    expect(widths().every((width) => width > 0)).toBe(true)
    expect(widths().reduce((sum, width) => sum + width, 0)).toBeCloseTo(100, 10)
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }))
    for (const checkbox of screen.getAllByRole('checkbox', { hidden: true }).slice(1)) fireEvent.click(checkbox)
    expect(widths()).toEqual([100])
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Name / stable ID', { selector: 'input' })).toBeDisabled()
  })

  it('retains multi-value filters across views and row types, and removes/clears values individually', async () => {
    const requests: URL[] = []
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (path: string) => {
      const url = new URL(path, 'https://test'); requests.push(url)
      const collection = url.searchParams.get('collection')
      if (url.searchParams.get('mode') === 'values') return reply([
        { value: collection === 'stations' ? 'A' : 'P', label: collection === 'stations' ? 'Duplicate name / A' : 'Parameter / P' },
        ...(collection === 'stations' ? [{ value: 'B', label: 'Duplicate name / B' }] : []),
      ])
      return reply([node(collection === 'stations' ? 'stations' : collection === 'parameters' ? 'parameters' : 'series', 'row')])
    }))
    render(<TestBrowser client={new MetadataClient()} onExpired={vi.fn()} onOpen={vi.fn()} />)
    await screen.findByText(/End of matching results/)
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    fireEvent.click(await screen.findByLabelText('Duplicate name / A'))
    fireEvent.click(await screen.findByLabelText('Duplicate name / B'))
    fireEvent.change(screen.getByLabelText('Filter attribute'), { target: { value: 'parameters:parameter_id' } })
    fireEvent.click(await screen.findByLabelText('Parameter / P'))
    fireEvent.click(screen.getByRole('button', { name: 'Tree view' }))
    await screen.findByRole('region', { name: 'Tree view results' })
    fireEvent.click(screen.getByRole('button', { name: 'By instance type' }))
    fireEvent.change(screen.getByLabelText('Instance type'), { target: { value: 'parameters' } })
    await waitFor(() => expect(requests.at(-1)?.searchParams.get('collection')).toBe('parameters'))
    expect(JSON.parse(requests.at(-1)!.searchParams.get('filters')!)).toEqual([
      { collection: 'stations', field: 'station_id', values: ['A', 'B'] },
      { collection: 'parameters', field: 'parameter_id', values: ['P'] },
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    const remove = screen.getByRole('button', { name: 'Remove Stations: station id = A' })
    expect(remove).toHaveTextContent('\u00d7')
    expect(remove.parentElement).toHaveTextContent(/^station id = A\u00d7$/)
    fireEvent.click(remove)
    expect(screen.queryByRole('button', { name: 'Remove Stations: station id = A' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Stations: station id = B' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'By instance type' }))
    await screen.findByText(/End of matching results/)
    expect(requests.at(-1)?.searchParams.get('filters')).toContain('"B"')
    expect(requests.at(-1)?.searchParams.get('filters')).not.toContain('"A"')
    const beforeRefresh = requests.length
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(requests.length).toBeGreaterThan(beforeRefresh))
    expect(requests.at(-1)?.searchParams.get('filters')).toContain('"B"')
    expect(requests.at(-1)?.searchParams.get('filters')).not.toContain('"A"')
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => expect(requests.at(-1)?.searchParams.get('filters')).toBe('[]'))
    expect(screen.queryByRole('button', { name: /^Remove / })).not.toBeInTheDocument()
  })

  it('pages available values with table controls and preserves selections while resetting changed filter scopes', async () => {
    const requests: URL[] = []
    const values = Array.from({ length: 23 }, (_, index) => ({
      value: `id-${23 - index}`, label: `Value ${String(index + 1).padStart(2, '0')}`,
    }))
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (path: string) => {
      const url = new URL(path, 'https://test'); requests.push(url)
      if (url.searchParams.get('mode') !== 'values') return reply([node('series', 'row')])
      const size = Number(url.searchParams.get('limit'))
      const index = Number(url.searchParams.get('page'))
      const start = (index - 1) * size
      const search = (url.searchParams.get('value_q') ?? '').toLowerCase()
      const matching = values.filter((choice) => choice.label.toLowerCase().includes(search) || choice.value.toLowerCase().includes(search))
      return new Response(JSON.stringify({ items: matching.slice(start, start + size),
        total: matching.length, next_after: start + size < matching.length ? matching[start + size - 1]!.value : null, read_cutoff: 'fixed' }))
    }))
    render(<TestBrowser client={new MetadataClient()} onExpired={vi.fn()} onOpen={vi.fn()} />)
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    await screen.findByLabelText('Value 01')
    const pagination = within(screen.getByRole('navigation', { name: 'Available values pagination' }))
    expect(pagination.getByLabelText('Rows per page')).toHaveValue('50')
    expect(pagination.getByText('of 23 total rows')).toBeInTheDocument()
    fireEvent.change(pagination.getByLabelText('Rows per page'), { target: { value: '10' } })
    await pagination.findByText('Page 1 / 3')
    expect(within(screen.getByRole('group', { name: 'Available values' })).getAllByRole('checkbox')).toHaveLength(11)
    fireEvent.click(screen.getByLabelText('Value 01'))
    fireEvent.click(pagination.getByRole('button', { name: 'Next page' }))
    fireEvent.click(await screen.findByLabelText('Value 11'))
    await pagination.findByText('Page 2 / 3')
    expect(requests.at(-1)?.searchParams.get('page')).toBe('2')
    expect(requests.at(-1)?.searchParams.has('after')).toBe(false)
    const search = screen.getByRole('searchbox', { name: 'Search available values' })
    expect(screen.getByLabelText('Filter attribute').nextElementSibling).toBe(search)
    fireEvent.change(search, { target: { value: 'vAlUE 23' } })
    await pagination.findByText('of 1 total rows')
    expect(pagination.getByText('Page 1 / 1')).toBeInTheDocument()
    expect(await screen.findByLabelText('Value 23')).not.toBeChecked()
    expect(requests.at(-1)?.searchParams.get('value_q')).toBe('vAlUE 23')
    expect(screen.getAllByRole('button', { name: /^Remove Stations:/ })).toHaveLength(2)
    fireEvent.change(search, { target: { value: 'iD-13' } })
    expect(await screen.findByLabelText('Value 11')).toBeChecked()
    fireEvent.change(search, { target: { value: 'absent' } })
    await pagination.findByText('of 0 total rows')
    expect(screen.getByText('No authorized values match the search and other filters.')).toBeInTheDocument()
    expect(pagination.getByRole('button', { name: 'Next page' })).toBeDisabled()
    fireEvent.change(search, { target: { value: '' } })
    await pagination.findByText('Page 1 / 3')
    expect(await screen.findByLabelText('Value 01')).toBeChecked()
    fireEvent.click(pagination.getByRole('button', { name: 'Last page' }))
    await screen.findByLabelText('Value 23')
    expect(within(screen.getByRole('group', { name: 'Available values' })).getAllByRole('checkbox')).toHaveLength(4)
    expect(pagination.getByRole('button', { name: 'Next page' })).toBeDisabled()
    fireEvent.click(pagination.getByRole('button', { name: 'First page' }))
    expect(await screen.findByLabelText('Value 01')).toBeChecked()
    fireEvent.click(pagination.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByLabelText('Value 11')).toBeChecked()
    fireEvent.change(screen.getByLabelText('Filter attribute'), { target: { value: 'parameters:parameter_id' } })
    await pagination.findByText('Page 1 / 3')
    fireEvent.click(pagination.getByRole('button', { name: 'Next page' }))
    await screen.findByLabelText('Value 11')
    fireEvent.click(screen.getByRole('button', { name: 'Remove Stations: station id = id-23' }))
    await pagination.findByText('Page 1 / 3')
    expect(requests.at(-1)?.searchParams.get('read_cutoff')).toBe('fixed')
    fireEvent.change(pagination.getByLabelText('Rows per page'), { target: { value: '25' } })
    await pagination.findByText('Page 1 / 1')
    expect(within(screen.getByRole('group', { name: 'Available values' })).getAllByRole('checkbox')).toHaveLength(24)
    fireEvent.click(screen.getByRole('button', { name: 'Tree view' }))
    await screen.findByRole('region', { name: 'Tree view results' })
    await waitFor(() => expect(requests.at(-1)?.searchParams.get('sort')).toBe('label'))
    expect(requests.at(-1)?.searchParams.get('order')).toBe('asc')
    expect(requests.at(-1)?.searchParams.has('value_q')).toBe(false)
  })

  it('selects and deselects only the current value page, with mixed state and the exact 20-value limit', async () => {
    const values = Array.from({ length: 21 }, (_, index) => ({ value: `v${index + 1}`, label: `Value ${index + 1}` }))
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (path: string) => {
      const query = new URL(path, 'https://test').searchParams
      if (query.get('mode') !== 'values') return reply([node('series', 'row')])
      const search = (query.get('value_q') ?? '').toLowerCase()
      const matching = values.filter((choice) => choice.label.toLowerCase().includes(search))
      const size = Number(query.get('limit'))
      const start = (Number(query.get('page')) - 1) * size
      return new Response(JSON.stringify({ items: matching.slice(start, start + size), total: matching.length,
        next_after: start + size < matching.length ? matching[start + size - 1]!.value : null, read_cutoff: 'fixed' }))
    }))
    render(<TestBrowser client={new MetadataClient()} onExpired={vi.fn()} onOpen={vi.fn()} />)
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    await screen.findByLabelText('Value 1')
    const bulk = () => screen.getByRole('checkbox', { name: 'Select all on this page' })
    const chips = () => screen.getAllByRole('button', { name: /^Remove Stations:/ })
    expect(bulk()).toBeDisabled()
    expect(bulk()).toHaveAccessibleDescription(/would exceed the 20-value limit/)
    const pagination = within(screen.getByRole('navigation', { name: 'Available values pagination' }))
    fireEvent.change(pagination.getByLabelText('Rows per page'), { target: { value: '10' } })
    await pagination.findByText('Page 1 / 3')
    fireEvent.click(screen.getByLabelText('Value 1'))
    expect(bulk()).toBePartiallyChecked()
    fireEvent.click(bulk())
    expect(bulk()).toBeChecked()
    expect(chips()).toHaveLength(10)
    fireEvent.click(pagination.getByRole('button', { name: 'Next page' }))
    await screen.findByLabelText('Value 11')
    expect(bulk()).not.toBeChecked()
    fireEvent.click(bulk())
    expect(bulk()).toBeChecked()
    expect(chips()).toHaveLength(20)
    fireEvent.click(pagination.getByRole('button', { name: 'Next page' }))
    await screen.findByLabelText('Value 21')
    expect(bulk()).toBeDisabled()
    expect(bulk()).toHaveAccessibleDescription(/would exceed the 20-value limit/)
    fireEvent.click(pagination.getByRole('button', { name: 'Previous page' }))
    await screen.findByLabelText('Value 11')
    expect(bulk()).toBeEnabled()
    fireEvent.click(bulk())
    expect(chips()).toHaveLength(10)
    expect(screen.getByLabelText('Value 11')).not.toBeChecked()
    const search = screen.getByRole('searchbox', { name: 'Search available values' })
    fireEvent.change(search, { target: { value: 'Value 21' } })
    await screen.findByLabelText('Value 21')
    fireEvent.click(bulk())
    expect(chips()).toHaveLength(11)
    fireEvent.change(search, { target: { value: '' } })
    expect(await screen.findByLabelText('Value 1')).toBeChecked()
    fireEvent.click(bulk())
    expect(chips()).toHaveLength(1)
    expect(chips()[0]).toHaveAccessibleName('Remove Stations: station id = v21')
    fireEvent.change(search, { target: { value: 'absent' } })
    await screen.findByText('No authorized values match the search and other filters.')
    expect(bulk()).toBeDisabled()
    expect(bulk()).not.toBePartiallyChecked()
  })

  it('retains historical Details coordinate suppression without the catalog as-of input', async () => {
    const station = node('stations', 'historical-station')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply([{
      ...station, position_scope: 'current_only',
      item: { ...station.item, station_location: { marker: 'CURRENT-COORDINATE-FIXTURE' } },
    }])))
    render(<MetadataDetail selection={{
      collection: 'stations', id: 'historical-station', version: '1', field: '',
      cutoff: 'fixed', asOf: '2026-11-20T12:00:00Z',
    }} client={new MetadataClient()} onExpired={vi.fn()} onOpen={vi.fn()} />)
    expect(await screen.findByText('Historical coordinates unavailable. No current coordinates have been substituted.')).toBeVisible()
    expect(screen.queryByText('station location / structured data')).not.toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Metadata detail' })).not.toHaveTextContent('CURRENT-COORDINATE-FIXTURE')
  })

  it('discards late selection results, preserves errors, and expires the workspace on a current 401', async () => {
    let late: ((response: Response) => void) | undefined
    vi.stubGlobal('fetch', vi.fn().mockImplementation((path: string) => {
      const collection = new URL(path, 'https://test').searchParams.get('collection')
      if (collection === 'series') return new Promise<Response>((resolve) => { late = resolve })
      if (collection === 'stations') return Promise.resolve(reply([node('stations', 'fresh')]))
      return Promise.resolve(new Response('{"code":"AUTHENTICATION_REQUIRED","message":"Expired","request_id":null}', { status: 401 }))
    }))
    const expired = vi.fn()
    render(<TestBrowser client={new MetadataClient()} onExpired={expired} onOpen={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Instance type'), { target: { value: 'stations' } })
    await screen.findByRole('button', { name: 'Duplicate name / fresh' })
    await act(async () => { late?.(reply([node('series', 'obsolete')])) })
    expect(screen.queryByText('obsolete')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Instance type'), { target: { value: 'parameters' } })
    await waitFor(() => expect(expired).toHaveBeenCalledOnce())
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 401')
  })
})
