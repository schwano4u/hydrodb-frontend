import { useEffect, useId, useRef, useState } from 'react'
import MetadataDownload from './MetadataDownload'
import ReloadIcon from './ReloadIcon'
import { ApiError } from './api'
import { defaultTableSettings, tableColumns, tableExportColumns } from './metadataTable'
import type { TableSettings } from './metadataTable'
import { useMetadataRead } from './useMetadataRead'
import type { MetadataView, TreeNaming, useMetadataSelection } from './useMetadataSelection'
import {
  attributes, catalogPath, collections, decodeBranch, decodeChoice, decodeNode, decodePage,
  entities, format, identity, isCollection, label, name, nodeVersion, reference,
} from './metadata'
import type {
  Collection, DetailSelection, Filter, MetadataClient, MetadataNode, Reference, Selection,
} from './metadata'

type Props = { client: MetadataClient; onExpired: () => void; onOpen: (selection: DetailSelection) => void }
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
const treeCollections: Collection[] = ['stations', 'sampling_positions', 'instruments', 'instrument_deployments', 'parameter_groups', 'parameters', 'series']

function ResultState({ loading, error, retry }: { loading: boolean; error?: string; retry: () => void }) {
  return <>
    {loading && <p role="status">Loading metadata...</p>}
    {error && <div role="alert">{error}<button type="button" onClick={retry}>Retry metadata read</button></div>}
  </>
}

function TablePaging({ index, total, size, changePage, changeSize, ariaLabel = 'Table pagination' }: {
  index: number; total?: number; size: number; changePage: (page: number) => void; changeSize: (size: number) => void
  ariaLabel?: string
}) {
  const pages = total === undefined ? undefined : Math.max(1, Math.ceil(total / size))
  return <nav className="metadata-pagination" aria-label={ariaLabel}>
    <div className="metadata-page-size"><label>Rows per page<select aria-label="Rows per page" value={size}
      onChange={(event) => changeSize(Number(event.target.value))}>
      {[10, 25, 50].map((value) => <option key={value} value={value}>{value}</option>)}
    </select></label><span>of {total === undefined ? '...' : total.toLocaleString('en')} total rows</span></div>
    <div className="metadata-page-navigation">
      <button type="button" aria-label="First page" title="First page" disabled={pages === undefined || index === 1} onClick={() => changePage(1)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m11 7-5 5 5 5m7-10-5 5 5 5" /></svg>
      </button>
      <button type="button" aria-label="Previous page" title="Previous page" disabled={pages === undefined || index === 1} onClick={() => changePage(index - 1)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 7-5 5 5 5" /></svg>
      </button>
      <span role="status">Page {index.toLocaleString('en')} / {pages === undefined ? '...' : pages.toLocaleString('en')}</span>
      <button type="button" aria-label="Next page" title="Next page" disabled={pages === undefined || index >= pages} onClick={() => changePage(index + 1)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 7 5 5-5 5" /></svg>
      </button>
      <button type="button" aria-label="Last page" title="Last page" disabled={pages === undefined || index >= pages} onClick={() => { if (pages !== undefined) changePage(pages) }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 7 5 5-5 5m7-10 5 5-5 5" /></svg>
      </button>
    </div>
  </nav>
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

function PathNode({ main, path, index, open, treeNaming }: {
  main: MetadataNode[]; path: MetadataNode[]; index: number; open: (ref: Reference) => void; treeNaming: TreeNaming
}) {
  const [expanded, setExpanded] = useState(true)
  const node = main[index]
  if (!node) return null
  const linked = node.references.filter((ref) => ref.collection === 'instruments')
  const hasChildren = linked.length > 0 || index + 1 < main.length
  return <li>
    {hasChildren ? <TreeToggle node={node} expanded={expanded} onToggle={() => setExpanded(!expanded)} />
      : <span className="tree-spacer" aria-hidden="true" />}
    <span>{entities[node.collection].title}: </span><NodeLink node={node} open={open} naming={treeNaming[node.collection] ?? ['name']} />
    {hasChildren && <ul hidden={!expanded}>
      {linked.map((ref) => {
        const related = path.find((n) => n.collection === ref.collection && identity(n) === ref.id && nodeVersion(n) === ref.version)
        return <li key={`${ref.field}:${ref.id}:${ref.version}`}><span className="tree-spacer" aria-hidden="true" />{entities[ref.collection].title}: {related
          ? <NodeLink node={related} open={open} naming={treeNaming[related.collection] ?? ['name']} />
          : <button type="button" onClick={() => open(ref)}>{ref.id} / version {ref.version}</button>}</li>
      })}
      {index + 1 < main.length && <PathNode main={main} path={path} index={index + 1} open={open} treeNaming={treeNaming} />}
    </ul>}
  </li>
}

function Path({ path, open, treeNaming }: { path: MetadataNode[]; open: (ref: Reference) => void; treeNaming: TreeNaming }) {
  const order: Collection[] = ['sampling_positions', 'instrument_deployments', 'parameter_groups', 'parameters', 'series']
  const main = order.flatMap((collection) => path.filter((node) => node.collection === collection))
  return <ul className="metadata-path"><PathNode main={main} path={path} index={0} open={open} treeNaming={treeNaming} /></ul>
}

function StationBranches({ node, selection, cutoff, client, onExpired, open, treeNaming }: {
  node: MetadataNode; selection: Selection; cutoff: string; client: MetadataClient; onExpired: () => void; open: (ref: Reference) => void
  treeNaming: TreeNaming
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
    {result.items.map((path, index) => <Path key={index} path={path} open={open} treeNaming={treeNaming} />)}
  </div>
}

function ResizeHandle({ title, width, minimum, maximum, resize }: {
  title: string; width: number; minimum: number; maximum: number; resize: (width: number) => void
}) {
  const drag = useRef<{ x: number; width: number } | null>(null)
  const adjust = (value: number) => resize(Math.max(minimum, Math.min(maximum, value)))
  return <span className="metadata-column-resize" role="separator" tabIndex={0} aria-label={`Resize ${title}`}
    aria-orientation="vertical" aria-valuemin={Math.round(minimum)} aria-valuemax={Math.round(maximum)} aria-valuenow={Math.round(width)}
    onKeyDown={(event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      adjust(event.key === 'Home' ? minimum : event.key === 'End' ? maximum : width + (event.key === 'ArrowLeft' ? -10 : 10))
    }}
    onPointerDown={(event) => {
      event.preventDefault()
      drag.current = { x: event.clientX, width }
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={(event) => { if (drag.current) adjust(drag.current.width + event.clientX - drag.current.x) }}
    onPointerUp={() => { drag.current = null }}
    onPointerCancel={() => { drag.current = null }} />
}

function positionMetadataPopup(popup: HTMLElement, trigger: HTMLElement) {
  const bounds = trigger.getBoundingClientRect()
  popup.style.left = `${Math.max(8, Math.min(bounds.left, innerWidth - popup.offsetWidth - 8))}px`
  popup.style.top = `${bounds.bottom + 4}px`
  popup.style.maxHeight = `${Math.max(80, innerHeight - bounds.bottom - 12)}px`
}

function TreeNamingSettings({ settings, change }: { settings: TreeNaming; change: (settings: TreeNaming) => void }) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const [expanded, setExpanded] = useState(false)
  return <div>
    <button type="button" ref={trigger} popoverTarget={id} className="metadata-reload"
      aria-label="Tree naming settings" title="Tree naming settings" aria-haspopup="dialog" aria-expanded={expanded}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m9 3-.8 3-2.8.8L3 9l2 3-2 3 2.4 2.2 2.8.8.8 3h6l.8-3 2.8-.8L21 15l-2-3 2-3-2.4-2.2-2.8-.8L15 3Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </button>
    <div id={id} className="metadata-columns-popup metadata-tree-settings" popover="auto" role="dialog" aria-label="Tree naming settings"
      onToggle={(event) => {
        setExpanded(event.newState === 'open')
        if (event.newState !== 'open') return
        positionMetadataPopup(event.currentTarget, trigger.current!)
        event.currentTarget.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus()
      }}>
      <fieldset><legend>Tree instance labels</legend>{treeCollections.map((collection) => {
        const selected = settings[collection] ?? ['name']
        return <fieldset key={collection}><legend>{entities[collection].title}</legend>
          <div className="metadata-tree-options">{(['name', 'id'] as const).map((field) =>
            <label key={field} className="metadata-choice"><input type="checkbox"
              aria-label={`${entities[collection].title} ${field === 'name' ? 'Name' : 'ID'}`}
              checked={selected.includes(field)} disabled={selected.length === 1 && selected.includes(field)}
              onChange={(event) => change({ ...settings, [collection]: event.target.checked
                ? [...selected, field] : selected.filter((value) => value !== field) })} />
              {field === 'name' ? 'Name' : 'ID'}
            </label>)}</div>
        </fieldset>
      })}</fieldset>
    </div>
  </div>
}

function ColumnControls({ collection, settings, change }: { collection: Collection; settings: TableSettings; change: (settings: TableSettings) => void }) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const [expanded, setExpanded] = useState(false)
  return <div className="metadata-columns">
    <button type="button" ref={trigger} popoverTarget={id} aria-haspopup="dialog" aria-expanded={expanded}>
      Columns<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    <div id={id} className="metadata-columns-popup" popover="auto" role="dialog" aria-label="Columns"
      onToggle={(event) => {
        setExpanded(event.newState === 'open')
        if (event.newState !== 'open') return
        const popup = event.currentTarget
        positionMetadataPopup(popup, trigger.current!)
        popup.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus()
      }}>
    <fieldset><legend>Visible columns</legend>{tableColumns(collection).map((column) =>
      <div key={column.id}>
        <label className="metadata-choice"><input type="checkbox" checked={settings.visible.includes(column.id)}
          disabled={settings.visible.length === 1 && settings.visible.includes(column.id)}
          onChange={(event) => change({
            ...settings, visible: event.target.checked ? [...settings.visible, column.id] : settings.visible.filter((id) => id !== column.id),
            sort: !event.target.checked && settings.sort?.column === column.sort ? undefined : settings.sort,
          })} />{column.label}</label>
      </div>)}</fieldset>
    </div>
  </div>
}

function Results({ selection, collection, tree, cutoff, table, changeTable, treeNaming, treeSize, changeTreeSize, ...props }: Props & {
  selection: Selection; collection: Collection; tree: boolean; cutoff: string
  table: TableSettings; changeTable: (settings: TableSettings) => void
  treeNaming: TreeNaming
  treeSize: number; changeTreeSize: (size: number) => void
}) {
  const [index, setIndex] = useState(1)
  const [expanded, setExpanded] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const tableElement = useRef<HTMLTableElement>(null)
  const [tableWidth, setTableWidth] = useState(0)
  const columns = tableColumns(collection).filter((column) => table.visible.includes(column.id))
  const weight = (column: ReturnType<typeof tableColumns>[number]) => table.widths[column.id] ?? column.width
  const totalWeight = columns.reduce((total, column) => total + weight(column), 0)
  const width = (column: ReturnType<typeof tableColumns>[number]) => tableWidth * weight(column) / totalWeight
  const minimum = Math.min(80, tableWidth / (columns.length * 2), ...columns.map(width))
  const result = useMetadataRead(catalogPath(selection, tree ? 'stations' : collection,
    { page: String(index), limit: String(tree ? treeSize : table.pageSize) }, cutoff, tree ? { column: 'label', direction: 'asc' } : table.sort),
    tableNodes, props.client, props.onExpired)
  const page = result.data
  const hasPage = Boolean(page)
  useEffect(() => {
    const element = tableElement.current
    if (!element) return
    const observer = new ResizeObserver(() => setTableWidth(element.getBoundingClientRect().width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [tree, hasPage])
  const open = (ref: Reference) => { if (page) props.onOpen({ ...ref, cutoff: page.cutoff, asOf: selection.asOf }) }
  return <section aria-label={tree ? 'Tree view results' : 'Instance results'}>
    <ResultState {...result} />
    <TablePaging ariaLabel={tree ? 'Tree pagination' : 'Table pagination'} index={index} total={page?.total}
      size={tree ? treeSize : table.pageSize} changePage={(index) => { setIndex(index); setExpanded([]); setNotice('') }}
      changeSize={(pageSize) => tree ? changeTreeSize(pageSize) : changeTable({ ...table, pageSize })} />
    {notice && <p role="status">{notice}</p>}
    {page && <>
      {!tree && <p className="identity-label" role="status">{page.items.length} returned. {page.next ? 'Partial catalog: more results remain.' : 'End of matching results.'}</p>}
      {page.items.length === 0 && <p>No matching authorized instances.</p>}
      {tree ? <ul className="station-tree">{page.items.map((node) => <li key={identity(node)}>
        <TreeToggle node={node} expanded={expanded.includes(identity(node))} onToggle={() => {
          const id = identity(node)
          if (expanded.includes(id)) { setExpanded(expanded.filter((v) => v !== id)); setNotice('') }
          else if (expanded.length < 3) { setExpanded([...expanded, id]); setNotice('') }
          else setNotice('At most three Station branches can be open. Collapse a branch first.')
        }} />
        <NodeLink node={node} open={open} naming={treeNaming[node.collection] ?? ['name']} />
        {expanded.includes(identity(node)) && <StationBranches node={node} selection={selection} cutoff={page.cutoff} {...props} open={open} treeNaming={treeNaming} />}
      </li>)}</ul> : <div className="metadata-table-scroll" tabIndex={0} role="region" aria-label="Paged metadata table">
        <table ref={tableElement} className="metadata-table"><caption>{entities[collection].title} / matching authorized instances</caption>
          <colgroup>{columns.map((column) => <col key={column.id} style={{ width: `${100 * weight(column) / totalWeight}%` }} />)}</colgroup>
          <thead><tr>{columns.map((column, columnIndex) => <th key={column.id} scope="col"
            aria-sort={column.sort && table.sort?.column === column.sort ? table.sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
            {column.sort ? <button type="button" className="metadata-column-sort" onClick={() => {
              const sort = column.sort
              if (sort) changeTable({
                ...table, sort: { column: sort, direction: table.sort?.column === sort && table.sort.direction === 'asc' ? 'desc' : 'asc' },
              })
            }}>{column.label}{table.sort && table.sort.column === column.sort && <small aria-hidden="true">{table.sort.direction.toUpperCase()}</small>}</button>
              : <span title="Current-only location fields cannot be sorted">{column.label}</span>}
            {tableWidth > 0 && columnIndex < columns.length - 1 && <ResizeHandle title={column.label} width={width(column)} minimum={minimum}
              maximum={width(column) + columns.slice(columnIndex + 1).reduce((total, right) => total + width(right), 0)
                * (1 - minimum / Math.min(...columns.slice(columnIndex + 1).map(width)))}
              resize={(value) => {
                if (tableWidth === 0) return
                const right = columns.slice(columnIndex + 1)
                const rightWeight = right.reduce((total, next) => total + weight(next), 0)
                const nextWeight = value * totalWeight / tableWidth
                const scale = (rightWeight + weight(column) - nextWeight) / rightWeight
                changeTable({ ...table, widths: {
                  ...table.widths, [column.id]: nextWeight,
                  ...Object.fromEntries(right.map((next) => [next.id, weight(next) * scale])),
                } })
              }} />}
          </th>)}</tr></thead>
          <tbody>{page.items.map((node) => <tr key={identity(node)}>
            {columns.map(({ id: field }) => field === 'name_id'
              ? <th key={field} scope="row"><NodeLink node={node} open={open} /></th>
              : <td key={field}>
              {field === 'status' ? node.status : node.references.some((ref) => ref.field === field)
                ? node.references.filter((ref) => ref.field === field).map((ref) => <button key={`${ref.id}:${ref.version}`} type="button" className="metadata-link" onClick={() => open(ref)}>{ref.id} / v{ref.version}</button>)
                : format(selection.asOf && field.startsWith('station_location') ? undefined : node.item[field])}
              {field === 'station_location' && <small>{!selection.asOf && node.position_scope === 'current_only' ? 'Current coordinates only' : 'Historical coordinates unavailable'}</small>}
            </td>)}
          </tr>)}</tbody>
        </table>
      </div>}
    </>}
  </section>
}

function FilterChoices({ selection, cutoff, filtersChanged, ...props }: Props & {
  selection: Selection; cutoff?: string; filtersChanged: (filters: Filter[]) => void
}) {
  const [helpOpen, setHelpOpen] = useState(false)
  const helpId = useId()
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
    filters: otherFilters })
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
    <div className="metadata-filter-label">
      <label htmlFor="metadata-attribute">Filter attribute</label>
      <button type="button" className="metadata-help" aria-label="Filter attribute help"
        aria-expanded={helpOpen} aria-controls={helpId} onClick={() => setHelpOpen(!helpOpen)}>?</button>
    </div>
    <p id={helpId} hidden={!helpOpen}>Values within an attribute match any selection; different attributes must all match one declared metadata path. At most 12 attributes and 20 values per attribute.</p>
    <select id="metadata-attribute" value={attribute} onChange={(event) => setAttribute(event.target.value)}>
      {collections.map((c) => <optgroup key={c} label={entities[c].title}>
        {attributes(c).map((f) => <option key={f} value={`${c}:${f}`}>{entities[c].title}: {label(f)}</option>)}
      </optgroup>)}
    </select>
    <input className="metadata-value-search" type="search" aria-label="Search available values" placeholder="Search available values"
      maxLength={200} value={search} onChange={(event) => { setSearch(event.target.value); setPaging({ scope, index: 1 }) }} />
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
  const [treeSize, setTreeSize] = useState(50)
  const table = tables[collection] ?? defaultTableSettings(collection)
  const changeTable = (settings: TableSettings) => setTables((current) => ({ ...current, [collection]: settings }))
  const exportColumns = tableExportColumns(collection, table)
  const key = JSON.stringify({ selection, cutoff, epoch, view, collection,
    sort: view === 'By instance type' ? table.sort : undefined, pageSize: view === 'Tree view' ? treeSize : table.pageSize })
  return <article className={`metadata-panel${view === 'Filters' ? ' metadata-filters-panel' : ''}`} aria-label={view === 'By instance type' ? 'Metadata browser' : view === 'Filters' ? 'Metadata filters' : 'Tree view'}>
    {view === 'By instance type' && <div className="metadata-toolbar">
      <div className="metadata-toolbar-left"><div className="metadata-instance-select">
        <label htmlFor="metadata-instance-type">Instance type</label><select id="metadata-instance-type" value={collection} onChange={(event) => { if (isCollection(event.target.value)) setCollection(event.target.value) }}>
          {collections.map((c) => <option key={c} value={c}>{entities[c].title}</option>)}
        </select>
      </div><ColumnControls collection={collection} settings={table} change={changeTable} /></div>
      <div className="metadata-toolbar-right"><button type="button" className="metadata-reload" aria-label="Reload" title="Reload" onClick={refresh}>
      <ReloadIcon />
    </button><MetadataDownload key={JSON.stringify({ selection, cutoff, collection, epoch, exportColumns, sort: table.sort })}
      client={props.client} onExpired={props.onExpired} selection={selection} collection={collection} cutoff={cutoff}
      columns={exportColumns} sort={table.sort} /></div></div>}
    {view === 'Tree view' && <div className="metadata-toolbar metadata-tree-toolbar">
      <div className="metadata-toolbar-left"><div className="metadata-instance-select">
        <label htmlFor="metadata-tree-design">Design</label><select id="metadata-tree-design" defaultValue="station-tree">
          <option value="station-tree">Station tree</option>
        </select>
      </div></div><div className="metadata-toolbar-right">
      <TreeNamingSettings settings={treeNaming} change={setTreeNaming} />
    </div></div>}
    {!cutoff && <ResultState {...initial} />}
    {view === 'Filters' && <section aria-label="Active filters" className="metadata-active-filters">
      {selection.filters.flatMap((filter) => filter.values.map((value) => <span className="metadata-filter-chip" key={`${filter.collection}:${filter.field}:${value}`}>
        <span>{label(filter.field)} = {value}</span>
        <button type="button" aria-label={`Remove ${entities[filter.collection].title}: ${label(filter.field)} = ${value}`}
          onClick={() => setSelection({ ...selection, filters: selection.filters.map((f) => f === filter ? { ...f, values: f.values.filter((v) => v !== value) } : f).filter((f) => f.values.length) })}>
          <span aria-hidden="true">&times;</span>
        </button>
      </span>))}
      <button type="button" onClick={() => setSelection({ ...selection, filters: [], q: '' })}>Clear all</button>
    </section>}
    {view === 'Filters' && <FilterChoices key={epoch} {...props} selection={selection} cutoff={cutoff}
      filtersChanged={(filters) => setSelection({ ...selection, filters })} />}
    {view !== 'Filters' && cutoff && <Results key={key} {...props} selection={selection} collection={collection} tree={view === 'Tree view'} cutoff={cutoff} table={table} changeTable={changeTable} treeNaming={treeNaming} treeSize={treeSize} changeTreeSize={setTreeSize} />}
  </article>
}
