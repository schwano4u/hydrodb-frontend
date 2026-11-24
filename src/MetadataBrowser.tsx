import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import ColumnVisibility from './ColumnVisibility'
import CheckboxSelector from './components/CheckboxSelector'
import FilterChip from './components/FilterChip'
import SearchField from './components/SearchField'
import TableToolbar from './components/TableToolbar'
import MetadataDownload from './MetadataDownload'
import TableRefresh from './TableRefresh'
import { ColumnSortButton } from './TableColumnControls'
import DataTable from './DataTable'
import { TablePaging } from './TablePaging'
import { ApiError, timestamp } from './api'
import { seriesSelectionLimit } from './sampleViewer'
import TreeNamingSettings from './TreeNamingSettings'
import FilterAttributeHelp from './FilterAttributeHelp'
import { defaultTableSettings, isCoverageField, tableColumns, tableExportColumns } from './metadataTable'
import type { TableSettings } from './metadataTable'
import { useMetadataRead } from './useMetadataRead'
import type { MetadataView, TreeNaming, useMetadataSelection } from './useMetadataSelection'
import {
  attributes, catalogPath, collections, decodeBranch, decodeChoice, decodeNode, decodePage,
  entities, format, identity, isCollection, label, name, nodeVersion, object, reference,
} from './metadata'
import type {
  Collection, DetailSelection, Filter, MetadataClient, MetadataNode, Reference, SelectedSeries, Selection,
} from './metadata'

type Props = {
  client: MetadataClient; onExpired: () => void; onOpen: (selection: DetailSelection) => void
  seriesSelection?: { ids: readonly string[]; toggle: (selection: SelectedSeries) => void; toolbar?: ReactNode }
}
type SeriesSelection = NonNullable<Props['seriesSelection']>
type ToggleSeriesReference = (ref: Reference, name: string) => void

function SeriesCheckbox({ node, selection, toggle }: {
  node: MetadataNode; selection: SeriesSelection; toggle: ToggleSeriesReference
}) {
  const id = identity(node)
  const checked = selection.ids.includes(id)
  return <input className="series-checkbox" type="checkbox" aria-label={`Select ${name(node)}`} title={id}
    checked={checked} disabled={!checked && selection.ids.length >= seriesSelectionLimit}
    onChange={() => toggle(reference(node), name(node))} />
}
function numberedPage<T>(decode: (value: unknown) => T) {
  return (body: unknown) => {
    const page = decodePage(body, decode)
    if (page.total === undefined) throw new ApiError('malformed', 'The API returned a numbered page without its total.')
    return page
  }
}
const tableNodes = numberedPage(decodeNode)
const choices = numberedPage(decodeChoice)
const branches = (body: unknown) => decodePage(body, decodeBranch)
const statusChoices = [{ id: 'active', label: 'Active' }, { id: 'retired', label: 'Retired' }] as const

function ResultState({ loading, error, retry }: { loading: boolean; error?: string; retry: () => void }) {
  return <>
    {loading && <p role="status">Loading metadata...</p>}
    {error && <div role="alert">{error}<button type="button" onClick={retry}>Retry metadata read</button></div>}
  </>
}

export function NodeLink({ node, open, naming }: {
  node: MetadataNode; open: (ref: Reference) => void; naming?: TreeNaming[Collection]
}) {
  const description = `${name(node)} / ${identity(node)}`
  const showName = !naming || naming.includes('name')
  const showId = !naming || naming.includes('id')
  return <button type="button" className="metadata-link" onClick={() => open(reference(node))}
    aria-label={naming ? description : undefined} title={naming ? description : undefined}>
    {showName && name(node)} {showId && <span className={showName ? 'metadata-id' : undefined}>{showName && '/ '}{identity(node)}</span>}
  </button>
}

function TreeToggle({ node, expanded, onToggle }: { node: MetadataNode; expanded: boolean; onToggle: () => void }) {
  return <button type="button" className="tree-toggle" aria-expanded={expanded}
    aria-label={`${expanded ? 'Collapse' : 'Expand'} ${name(node)} / ${identity(node)}`}
    onClick={onToggle}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg></button>
}

function PathNode({ main, path, index, open, treeNaming, seriesSelection, toggleSeries }: {
  main: MetadataNode[]; path: MetadataNode[]; index: number; open: (ref: Reference) => void; treeNaming: TreeNaming
  seriesSelection?: SeriesSelection; toggleSeries: ToggleSeriesReference
}) {
  const [expanded, setExpanded] = useState(true)
  const node = main[index]
  if (!node) return null
  const linked = node.references.filter((ref) => ref.collection === 'instruments')
  const hasChildren = linked.length > 0 || index + 1 < main.length
  return <li>
    {hasChildren ? <TreeToggle node={node} expanded={expanded} onToggle={() => setExpanded(!expanded)} />
      : node.collection === 'series' && seriesSelection
        ? <span className="tree-series-select"><SeriesCheckbox node={node} selection={seriesSelection} toggle={toggleSeries} /></span>
        : <span className="tree-spacer" aria-hidden="true" />}
    <span>{entities[node.collection].title}: </span><NodeLink node={node} open={open} naming={treeNaming[node.collection] ?? ['name']} />
    {hasChildren && <ul hidden={!expanded}>
      {linked.map((ref) => {
        const related = path.find((n) => n.collection === ref.collection && identity(n) === ref.id && nodeVersion(n) === ref.version)
        return <li key={`${ref.field}:${ref.id}:${ref.version}`}><span className="tree-spacer" aria-hidden="true" />{entities[ref.collection].title}: {related
          ? <NodeLink node={related} open={open} naming={treeNaming[related.collection] ?? ['name']} />
          : <button type="button" onClick={() => open(ref)}>{ref.id} / version {ref.version}</button>}</li>
      })}
      {index + 1 < main.length && <PathNode main={main} path={path} index={index + 1} open={open} treeNaming={treeNaming}
        seriesSelection={seriesSelection} toggleSeries={toggleSeries} />}
    </ul>}
  </li>
}

function Path({ path, ...props }: Omit<Parameters<typeof PathNode>[0], 'main' | 'index'>) {
  const order: Collection[] = ['sampling_positions', 'instrument_deployments', 'parameter_groups', 'parameters', 'series']
  const main = order.flatMap((collection) => path.filter((node) => node.collection === collection))
  return <ul className="metadata-path"><PathNode {...props} main={main} path={path} index={0} /></ul>
}

function StationBranches({ node, selection, cutoff, client, onExpired, open, treeNaming, seriesSelection, toggleSeries }: {
  node: MetadataNode; selection: Selection; cutoff: string; client: MetadataClient; onExpired: () => void; open: (ref: Reference) => void
  treeNaming: TreeNaming
  seriesSelection?: SeriesSelection; toggleSeries: ToggleSeriesReference
}) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ loading: boolean; items: MetadataNode[][]; error?: string }>({ loading: true, items: [] })
  const path = catalogPath(selection, 'stations', { mode: 'branches', station_id: identity(node), after: '' }, cutoff)
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      const items: MetadataNode[][] = []
      const cursors = new Set<string>([''])
      let after = ''
      do {
        const url = new URL(path, window.location.origin)
        url.searchParams.set('after', after)
        const page = await client.read(`/api/v1/metadata/browser?${url.searchParams}`, branches, controller.signal)
        if (controller.signal.aborted) return
        items.push(...page.items)
        if (page.next !== null && cursors.has(page.next)) {
          throw new ApiError('malformed', 'The API returned a repeated Station branch cursor.')
        }
        setResult({ loading: page.next !== null, items: [...items] })
        if (page.next === null) return
        after = page.next
        cursors.add(after)
      } while (!controller.signal.aborted)
    }
    void load().catch((error: unknown) => {
      if (controller.signal.aborted) return
      if (error instanceof ApiError && error.status === 401) { client.clear(); onExpired() }
      setResult((current) => ({ ...current, loading: false, error: error instanceof ApiError
        ? error.message : 'Metadata could not be read. Retry or explicitly refresh the catalog.' }))
    })
    return () => controller.abort()
  }, [path, client, onExpired, attempt])
  return <div className="metadata-branches">
    <ResultState {...result} retry={() => { setResult({ loading: true, items: [] }); setAttempt((value) => value + 1) }} />
    {!result.loading && !result.error && result.items.length === 0 && <p>No matching child paths. The Station itself matches.</p>}
    {result.items.map((path, index) => <Path key={index} path={path} open={open} treeNaming={treeNaming}
      seriesSelection={seriesSelection} toggleSeries={toggleSeries} />)}
  </div>
}


function ColumnControls({ collection, settings, change }: { collection: Collection; settings: TableSettings; change: (settings: TableSettings) => void }) {
  const columns = tableColumns(collection)
  return <ColumnVisibility columns={columns} visible={settings.visible} toggle={(id, checked) => {
    const column = columns.find((column) => column.id === id)
    if (!column) return
    change({
      ...settings, visible: checked ? [...settings.visible, id] : settings.visible.filter((visible) => visible !== id),
      sort: !checked && settings.sort?.column === column.sort ? undefined : settings.sort,
    })
  }} />
}

type CoverageRow = { first_sample_at: string | null; last_sample_at: string | null } | 'history_purged'
function decodeCoveragePage(body: unknown) {
  if (!object(body) || !Array.isArray(body.items)) throw new ApiError('malformed', 'Invalid sample coverage page.')
  const rows = new Map<string, CoverageRow>()
  for (const item of body.items) {
    if (!object(item) || typeof item.series_id !== 'string' || rows.has(item.series_id)) {
      throw new ApiError('malformed', 'Invalid sample coverage row.')
    }
    const first = item.first_sample_at
    const last = item.last_sample_at
    if (item.status === 'history_purged') rows.set(item.series_id, 'history_purged')
    else if (item.status === 'available' && ((first === null && last === null) ||
      (timestamp(first) && timestamp(last) && Date.parse(first) <= Date.parse(last)))) {
      rows.set(item.series_id, { first_sample_at: first, last_sample_at: last })
    } else throw new ApiError('malformed', 'Invalid sample coverage bounds.')
  }
  return rows
}

function Results({ selection, collection, tree, cutoff, table, changeTable, treeNaming, treeSize, changeTreeSize, onRead, onLoading, ...props }: Props & {
  selection: Selection; collection: Collection; tree: boolean; cutoff: string
  table: TableSettings; changeTable: (settings: TableSettings) => void
  treeNaming: TreeNaming
  treeSize: number; changeTreeSize: (size: number) => void
  onRead: () => void
  onLoading: (loading: boolean) => void
}) {
  const [index, setIndex] = useState(1)
  const [expanded, setExpanded] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const seriesSelection = tree || collection === 'series' ? props.seriesSelection : undefined
  const selectedFirst = !tree && !!seriesSelection && !!table.selectedFirst
  const columns = tableColumns(collection).filter((column) => table.visible.includes(column.id))
  const sortedColumn = !selectedFirst && table.sort && columns.find((column) => column.sort === table.sort?.column)
  const result = useMetadataRead(catalogPath(selection, tree ? 'stations' : collection,
    { page: String(index), limit: String(tree ? treeSize : table.pageSize),
      ...(selectedFirst && seriesSelection?.ids.length ? { selected_first: JSON.stringify([...seriesSelection.ids].sort()) } : {}) },
    cutoff, tree ? { column: 'label', direction: 'asc' } : table.sort),
    tableNodes, props.client, props.onExpired, tree ? undefined : onRead)
  const page = result.data
  const coverageVisible = !tree && collection === 'series' && columns.some(({ id }) => isCoverageField(id))
  const coverage = useMetadataRead(coverageVisible && page?.items.length
    ? `/api/v1/series/coverage?${new URLSearchParams({
      series_ids: JSON.stringify(page.items.map(identity)), read_cutoff: page.cutoff,
    })}` : null, decodeCoveragePage, props.client, props.onExpired)
  useEffect(() => {
    if (!tree) onLoading(result.loading || coverage.loading)
  }, [tree, onLoading, result.loading, coverage.loading])
  const open = (ref: Reference) => { if (page) props.onOpen({ ...ref, cutoff: page.cutoff, asOf: selection.asOf }) }
  const toggleSeries: ToggleSeriesReference = (ref, name) => {
    if (page) seriesSelection?.toggle({ ...ref, name, cutoff: page.cutoff, asOf: selection.asOf })
  }
  return <section aria-label={tree ? 'Tree view results' : 'Instance results'}>
    <ResultState {...result} />
    <TablePaging ariaLabel={tree ? 'Tree pagination' : 'Table pagination'} index={index} total={page?.total}
      size={tree ? treeSize : table.pageSize} changePage={(index) => { setIndex(index); setExpanded([]); setNotice('') }}
      changeSize={(pageSize) => tree ? changeTreeSize(pageSize) : changeTable({ ...table, pageSize })} />
    {notice && <p role="status">{notice}</p>}
    {page && <>
      {!tree && <p className="identity-label" role="status">{page.items.length} returned. {page.next ? 'Partial catalog: more results remain.' : 'End of matching results.'}</p>}
      {page.items.length === 0 && <p>No matching authorized instances.</p>}
      {tree ? <div className="metadata-tree-frame"><ul className="station-tree">{page.items.map((node) => <li key={identity(node)}>
        <TreeToggle node={node} expanded={expanded.includes(identity(node))} onToggle={() => {
          const id = identity(node)
          if (expanded.includes(id)) { setExpanded(expanded.filter((v) => v !== id)); setNotice('') }
          else if (expanded.length < 3) { setExpanded([...expanded, id]); setNotice('') }
          else setNotice('At most three Station branches can be open. Collapse a branch first.')
        }} />
        <NodeLink node={node} open={open} naming={treeNaming[node.collection] ?? ['name']} />
        {expanded.includes(identity(node)) && <StationBranches node={node} selection={selection} cutoff={page.cutoff} {...props}
          open={open} treeNaming={treeNaming} toggleSeries={toggleSeries} />}
      </li>)}</ul>{seriesSelection?.toolbar}</div> : <div className="metadata-table-frame">
        {coverage.error && <p role="alert">{coverage.error} <button type="button" onClick={coverage.retry}>Retry coverage</button></p>}
        <DataTable caption={`${entities[collection].title} / matching authorized instances`} hideCaption region="Paged metadata table"
          columns={columns.map((column) => ({ ...column, sortable: Boolean(column.sort),
            title: column.sort ? undefined : 'Current-only location fields cannot be sorted' }))}
          rows={page.items} rowKey={identity} rowHeader="name_id" widths={table.widths}
          changeWidths={(widths) => changeTable({ ...table, widths })}
          sort={sortedColumn && table.sort ? { column: sortedColumn.id, direction: table.sort.direction } : undefined}
          changeSort={(next) => {
            const column = columns.find(({ id }) => id === next?.column)?.sort
            changeTable({ ...table, selectedFirst: false, sort: column && next ? { column, direction: next.direction } : undefined })
          }}
          leading={seriesSelection && { width: 64, descending: selectedFirst,
            header: <ColumnSortButton label="Select" pressed={selectedFirst} direction={selectedFirst ? 'desc' : undefined}
              title="Show selected time series first" onSort={() => changeTable({ ...table, selectedFirst: !selectedFirst })} />,
            cell: (node) => <SeriesCheckbox node={node} selection={seriesSelection} toggle={toggleSeries} />,
          }}
          cell={(node, field) => {
            if (field === 'name_id') return <NodeLink node={node} open={open} />
            if (field === 'station_location') {
              if (selection.asOf || node.position_scope !== 'current_only') return 'Historical coordinates unavailable'
              const location = node.item[field]
              const coordinates = object(location) && typeof location.latitude === 'number' && typeof location.longitude === 'number'
                ? `${location.latitude} / ${location.longitude}` : null
              return <>
                {coordinates ?? 'Unknown'}{' '}
                <button type="button" className="metadata-link" aria-label={`Details for ${name(node)} / ${identity(node)}`}
                  onClick={() => open(reference(node))}>Details</button>
                {coordinates && <small>Current coordinates only</small>}
              </>
            }
            if (isCoverageField(field)) {
              if (coverage.loading) return 'Loading…'
              const row = coverage.data?.get(identity(node))
              if (row === 'history_purged') return 'History purged'
              if (!row) return 'Unavailable'
              const value = row[field]
              return value ? <time dateTime={value}>{value}</time> : 'No samples'
            }
            return field === 'status' ? node.status : node.references.some((ref) => ref.field === field)
              ? node.references.filter((ref) => ref.field === field).map((ref) => <button key={`${ref.id}:${ref.version}`} type="button" className="metadata-link" onClick={() => open(ref)}>{ref.id} / v{ref.version}</button>)
              : field === 'series_period_definition' && node.item[field] == null && node.item.series_value_statistic === 'instantaneous'
                ? 'Not applicable'
                : format(selection.asOf && field.startsWith('station_location') ? undefined : node.item[field])
          }}
        />
        {seriesSelection?.toolbar && <div className="series-selection-anchor">{seriesSelection.toolbar}</div>}
      </div>}
    </>}
  </section>
}

function FilterChoices({ selection, cutoff, filtersChanged, ...props }: Props & {
  selection: Selection; cutoff?: string; filtersChanged: (filters: Filter[]) => void
}) {
  const [attribute, setAttribute] = useState('stations:station_id')
  const [search, setSearch] = useState('')
  const [size, setSize] = useState(50)
  const [paging, setPaging] = useState({ scope: '', index: 1 })
  const selectAll = useRef<HTMLInputElement>(null)
  const selectAllHelp = useId()
  const [collectionText, field] = attribute.split(':')
  const collection = isCollection(collectionText) ? collectionText : 'stations'
  const otherFilters = selection.filters.filter((filter) => filter.collection !== collection || filter.field !== field)
  const scope = JSON.stringify({ attribute, search, cutoff, q: selection.q, asOf: selection.asOf,
    filters: otherFilters, polygon: selection.polygon })
  const index = paging.scope === scope ? paging.index : 1
  const selected = selection.filters.find((f) => f.collection === collection && f.field === field)?.values ?? []
  const result = useMetadataRead(cutoff ? catalogPath({ ...selection, filters: otherFilters }, collection,
    { mode: 'values', field: field!, value_q: search, page: String(index), limit: String(size) }, cutoff) : null, choices, props.client, props.onExpired)
  const pageValues = result.data?.items.map((choice) => choice.value) ?? []
  const pageSelected = pageValues.filter((value) => selected.includes(value)).length
  const allSelected = pageValues.length > 0 && pageSelected === pageValues.length
  const partiallySelected = pageSelected > 0 && !allSelected
  const selectAllError = allSelected || pageValues.length === 0 ? ''
    : selected.length + pageValues.length - pageSelected > 20
      ? 'Select all would exceed the 20-value limit. Narrow the search or deselect values.'
      : !selected.length && selection.filters.length >= 12
        ? 'At most 12 filter attributes can be selected.' : ''
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = partiallySelected
  }, [partiallySelected])
  function choose(values: string[]) {
    filtersChanged(values.length ? [...otherFilters, { collection, field: field!, values }] : otherFilters)
  }
  return <section className="metadata-filter-choices" aria-label="Metadata filters">
    <FilterAttributeHelp><label htmlFor="metadata-attribute">Filter attribute</label></FilterAttributeHelp>
    <select id="metadata-attribute" value={attribute} onChange={(event) => setAttribute(event.target.value)}>
      {collections.map((c) => <optgroup key={c} label={entities[c].title}>
        {attributes(c).map((f) => <option key={f} value={`${c}:${f}`}>{entities[c].title}: {label(f)}</option>)}
      </optgroup>)}
    </select>
    <SearchField className="metadata-value-search" label="Search available values" maxLength={200}
      value={search} onChange={(value) => { setSearch(value); setPaging({ scope, index: 1 }) }} />
    <ResultState {...result} />
    <TablePaging ariaLabel="Available values pagination" index={index} total={result.data?.total} size={size}
      changePage={(index) => setPaging({ scope, index })}
      changeSize={(size) => { setSize(size); setPaging({ scope, index: 1 }) }} />
    <div className="metadata-values-scroll" role="region" aria-label="Available values" tabIndex={0}
      key={`${scope}:${index}:${size}`}>
    {result.data && <>
      {result.data.items.length === 0 && <p>No authorized values match {search ? 'the search and other filters' : 'the other filters'}.</p>}
      <fieldset><legend>Available values</legend>
        <label className="metadata-select-all"><input ref={selectAll} type="checkbox" checked={allSelected}
          disabled={pageValues.length === 0 || !!selectAllError} aria-describedby={selectAllError ? selectAllHelp : undefined}
          onChange={(event) => choose(event.target.checked ? [...new Set([...selected, ...pageValues])]
            : selected.filter((value) => !pageValues.includes(value)))} />Select all on this page</label>
        {selectAllError && <p id={selectAllHelp}>{selectAllError}</p>}
        {result.data.items.map((choice) => <label key={choice.value} className="metadata-choice">
        <input type="checkbox" checked={selected.includes(choice.value)}
          disabled={!selected.includes(choice.value) && (selected.length >= 20 || (!selected.length && selection.filters.length >= 12))}
          onChange={(event) => choose(event.target.checked ? [...new Set([...selected, choice.value])]
            : selected.filter((value) => value !== choice.value))} />{choice.label}
      </label>)}</fieldset>
    </>}
    </div>
  </section>
}

export default function MetadataBrowser({ state, view = 'By instance type', ...props }: Props & {
  state: ReturnType<typeof useMetadataSelection>; view?: MetadataView
}) {
  const { selection, setSelection, cutoff, collection, setCollection, epoch, refresh, initial, treeNaming, setTreeNaming } = state
  const [tables, setTables] = useState<Partial<Record<Collection, TableSettings>>>({})
  const [statuses, setStatuses] = useState<MetadataNode['status'][]>(['active'])
  const [treeSize, setTreeSize] = useState(50)
  const clearFilters = useRef<HTMLButtonElement>(null)
  const [lastUpdate, setLastUpdate] = useState<{ epoch: number; at: string }>()
  const recordUpdate = useCallback(() => {
    const at = new Date().toISOString()
    setLastUpdate((previous) => previous?.epoch === epoch ? previous : { epoch, at })
  }, [epoch])
  const table = tables[collection] ?? defaultTableSettings(collection)
  const changeTable = (settings: TableSettings) => setTables((current) => ({ ...current, [collection]: settings }))
  const exportColumns = tableExportColumns(collection, table)
  const tableSelection = { ...selection, instanceStatus: statuses.length === 1 ? statuses[0] : undefined }
  const resultSelection = view === 'By instance type' ? tableSelection : selection
  const key = JSON.stringify({ selection: resultSelection, cutoff, epoch, view, collection,
    sort: view === 'By instance type' ? table.sort : undefined,
    selectedFirst: view === 'By instance type' ? table.selectedFirst : undefined,
    pageSize: view === 'Tree view' ? treeSize : table.pageSize })
  const [readStatus, setReadStatus] = useState<{ key: string; loading: boolean }>()
  const recordLoading = useCallback((loading: boolean) => setReadStatus({ key, loading }), [key])
  return <article className={`metadata-panel${view === 'By instance type' ? ' metadata-browser-panel table-panel' : view === 'Filters' ? ' metadata-filters-panel' : ''}`} aria-label={view === 'By instance type' ? 'Metadata browser' : view === 'Filters' ? 'Metadata filters' : 'Tree view'}>
    {view === 'By instance type' && <TableToolbar controls={<>
      <div className="metadata-instance-select">
        <label htmlFor="metadata-instance-type">Instance type</label><select id="metadata-instance-type" value={collection} onChange={(event) => { if (isCollection(event.target.value)) setCollection(event.target.value) }}>
          {collections.map((c) => <option key={c} value={c}>{entities[c].title}</option>)}
        </select>
      </div>
      <ColumnControls collection={collection} settings={table} change={changeTable} />
      <CheckboxSelector label="Status" legend="Instance status" choices={statusChoices} selected={statuses}
        summary={statuses.length === 2 ? 'All' : statuses[0] === 'active' ? 'Active' : 'Retired'}
        toggle={(id, checked) => setStatuses((current) => checked ? [...current, id] : current.filter((value) => value !== id))} />
    </>} actions={<>
      <TableRefresh label="Reload" updatedAt={lastUpdate?.at} onRefresh={refresh}
        busy={cutoff ? readStatus?.key !== key || readStatus.loading : initial.loading} />
      <MetadataDownload key={JSON.stringify({ selection: tableSelection, cutoff, collection, epoch, exportColumns, sort: table.sort })}
        client={props.client} onExpired={props.onExpired} selection={tableSelection} collection={collection} cutoff={cutoff}
        columns={exportColumns} sort={table.sort} />
    </>} />}
    {view === 'Tree view' && <TableToolbar className="metadata-tree-toolbar" controls={
      <div className="metadata-instance-select">
        <label htmlFor="metadata-tree-design">Design</label><select id="metadata-tree-design" defaultValue="station-tree">
          <option value="station-tree">Station tree</option>
        </select>
      </div>
    } actions={<TreeNamingSettings settings={treeNaming} change={setTreeNaming} />} />}
    {!cutoff && <ResultState {...initial} />}
    {view === 'Filters' && <section aria-label="Active filters" className="metadata-active-filters">
      {selection.filters.flatMap((filter) => filter.values.map((value) => <FilterChip
        key={`${filter.collection}:${filter.field}:${value}`} label={`${label(filter.field)} = ${value}`}
        removeLabel={`Remove ${entities[filter.collection].title}: ${label(filter.field)} = ${value}`}
        onRemove={() => setSelection({ ...selection, filters: selection.filters.map((f) => f === filter ? { ...f, values: f.values.filter((v) => v !== value) } : f).filter((f) => f.values.length) })} />))}
      {selection.polygon && <FilterChip label="Polygon map selection" removeLabel="Remove polygon map selection"
        onRemove={() => {
          setSelection((current) => ({ ...current, polygon: undefined }))
          clearFilters.current?.focus()
        }} />}
      <button ref={clearFilters} type="button" onClick={() => setSelection((current) => ({ ...current, filters: [], q: '', polygon: undefined }))}>Clear all</button>
    </section>}
    {view === 'Filters' && <FilterChoices key={epoch} {...props} selection={selection} cutoff={cutoff}
      filtersChanged={(filters) => setSelection({ ...selection, filters })} />}
    {view !== 'Filters' && cutoff && <Results key={key} {...props} selection={resultSelection} collection={collection} tree={view === 'Tree view'} cutoff={cutoff} table={table} changeTable={changeTable} treeNaming={treeNaming} treeSize={treeSize} changeTreeSize={setTreeSize} onRead={recordUpdate} onLoading={recordLoading} />}
  </article>
}
