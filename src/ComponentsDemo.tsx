import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import CheckboxSelector from './components/CheckboxSelector'
import FilterChip from './components/FilterChip'
import SearchField from './components/SearchField'
import TableToolbar from './components/TableToolbar'
import ColumnVisibility from './ColumnVisibility'
import DataTable from './DataTable'
import type { TableColumn, TableSort } from './DataTable'
import { TablePaging } from './TablePaging'
import TableRefresh from './TableRefresh'
import SelectionActionBarDemo from './SelectionActionBarDemo'
import StationClassificationDemo from './StationClassificationDemo'
import SampleChart from './SampleChart'
import { timestampMicros } from './sampleViewer'
import type { SampleDefinition, ScientificSample } from './sampleViewer'
import TreeNamingSettings from './TreeNamingSettings'
import FilterAttributeHelp from './FilterAttributeHelp'
import { stationPinCenter, stationPinPath, stationPinTitle, stationPinViewBox } from './stationPinIcon'
import { showStationPopup } from './stationPopup'
import type { TreeNaming } from './useMetadataSelection'
import './index.css'
import './App.css'
import './componentsDemo.css'

const columns = [
  { id: 'name', label: 'Station', width: 240, required: true, sortable: true },
  { id: 'basin', label: 'River basin', width: 160, sortable: true },
  { id: 'status', label: 'Status', width: 120, sortable: true },
  { id: 'identifier', label: 'Station ID', width: 120, sortable: true },
] as const satisfies readonly TableColumn[]

const statusChoices = [{ id: 'Active', label: 'Active' }, { id: 'Retired', label: 'Retired' }] as const
const basins = ['Elbe', 'Rhine', 'Weser'] as const
const demoStation = 'Alder Reach'
const demoStationId = 'ST-001'
const demoBand = '≤ 1 h'
const demoWaterLevelId = 'demo:alder-reach:water-level'
const demoDetails = [
  `Series: ${demoWaterLevelId}`,
  'Latest timestamp: 2026-11-24T18:00:00+00:00',
]
const demoMarkerTitle = stationPinTitle(demoStation, demoStationId, demoBand, demoDetails)
const stationQuery = { start: '2026-11-24T15:00:00Z', end: '2026-11-24T19:00:00Z', asOf: '' }
const stationSeries = [
  { seriesId: demoWaterLevelId, name: 'Water level', unitId: 'm', unitLabel: 'm', values: [0.35, 0.4, 0.48, 0.6] },
  { seriesId: 'demo:alder-reach:discharge', name: 'Discharge', unitId: 'm3/s', unitLabel: 'm³/s', values: [12, 14, 17, 20] },
].map(({ seriesId, name, unitId, unitLabel, values }) => {
  const definition: SampleDefinition = {
    seriesId, name, unitId, unitLabel, version: '', unitVersion: '', level: 'raw', sampling: 'equidistant',
    statistic: 'instantaneous', interval: 'PT1H', intervalMicros: 3_600_000_000n,
    axes: [{ axis: 'Value', meaning: name }], support: null, calendar: null, policy: null,
  }
  const samples: ScientificSample[] = values.map((value, index) => {
    const timestamp = new Date(Date.parse(stationQuery.start) + index * 3_600_000).toISOString()
    return { timestamp, micros: timestampMicros(timestamp), value, definition, state: 'valid',
      detectionBound: null, revision: '', seriesVersion: '', qualityCode: 0, codebookId: '', codebookVersion: '',
      source: null, scientificContext: null, aggregate: {} }
  })
  return { query: stationQuery, samples, chartDefinition: definition }
})
const stationNames = [
  'Alder Reach', 'Birch Island', 'Cedar Reach', 'Dale Bridge', 'East Mill', 'Fern Brook',
  'Green Bank', 'Hazel Point', 'Iron Gate', 'Juniper Bend', 'Kingfisher Lock', 'Larch Weir',
  'Maple Cross', 'North Quay', 'Oak Meadow', 'Pine Ridge', 'Quarry Pool', 'Reed Marsh',
  'Stone Creek', 'Timber Wharf', 'Upper Falls', 'Valley Gate', 'Willow Bank', 'Yew Bridge',
  'Ash Landing', 'Bramble Point', 'Clover Ford', 'Driftwood Reach', 'Elm Quay', 'Fieldstone Lock',
  'Grove Bridge', 'Hawthorn Mill', 'Inlet Pool', 'Jackdaw Weir', 'Kestrel Marsh', 'Linden Bank',
]

const stations = stationNames.map((name, index) => ({
  name, basin: basins[index % basins.length]!, status: statusChoices[index % 4 === 3 ? 1 : 0].id,
  identifier: `ST-${String(index + 1).padStart(3, '0')}`,
}))
type Station = typeof stations[number]
type Status = Station['status']

function ExampleRow({ id, name, children, notes }: {
  id: string
  name: string
  children: ReactNode
  notes: string
}) {
  return <section className="components-demo-row" aria-labelledby={id}>
    <h2 id={id}>{name}</h2>
    <div className="components-demo-example metadata-panel table-panel">{children}</div>
    <p className="components-demo-notes">{notes}</p>
  </section>
}

function StationPopupDemo() {
  const pin = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const details = useRef<HTMLDialogElement>(null)
  const graph = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const label = `${demoStation} / ${demoStationId}`

  function close() {
    setOpen(false)
    pin.current?.focus()
  }

  return <div onKeyDown={(event) => {
    if (event.key === 'Escape' && open && !details.current?.open && !graph.current?.open) {
      event.preventDefault()
      close()
    }
  }}>
    <button ref={pin} type="button" className={`station-map-marker${open ? ' is-selected' : ''}`}
      aria-label={label} aria-pressed={open} title={demoMarkerTitle} onClick={() => {
        if (open) { close(); return }
        if (!popup.current) return
        showStationPopup(popup.current, demoMarkerTitle, close,
          () => details.current?.showModal(), () => graph.current?.showModal())
        setOpen(true)
      }}>
      <svg className="station-pin-icon" viewBox={stationPinViewBox} aria-hidden="true">
        <path d={stationPinPath} /><circle {...stationPinCenter} />
      </svg>
    </button>
    <div ref={popup} className="station-map-popup components-demo-station-popup" hidden={!open} />
    <dialog ref={details} className="components-demo-selection-chart" aria-labelledby="demo-station-details-heading">
      <h3 id="demo-station-details-heading">Station details</h3>
      <p>{label}</p>
      <p>River basin: {basins[0]}</p>
      <form method="dialog"><button type="submit">Close</button></form>
    </dialog>
    <dialog ref={graph} className="components-demo-selection-chart components-demo-station-graph"
      aria-labelledby="demo-station-graph-heading">
      <h3 id="demo-station-graph-heading">{demoStation}: time series graph</h3>
      <p>All {stationSeries.length} fixture time series</p>
      <figure className="sample-figure">
        <SampleChart data={stationSeries[0]!} overlays={stationSeries} chartLabel={`${demoStation} time series`} />
      </figure>
      <form method="dialog"><button type="submit">Close</button></form>
    </dialog>
  </div>
}

export default function ComponentsDemo() {
  const basinSelect = useRef<HTMLSelectElement>(null)
  const [visible, setVisible] = useState<string[]>(columns.map(({ id }) => id))
  const [statuses, setStatuses] = useState<Status[]>(statusChoices.map(({ id }) => id))
  const [basin, setBasin] = useState<string>(basins[0])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(10)
  const [sort, setSort] = useState<TableSort>()
  const [widths, setWidths] = useState<Record<string, number>>({})
  const [updatedAt, setUpdatedAt] = useState('2026-11-24T12:00:00.000Z')
  const [reloading, setReloading] = useState(false)
  const [treeNaming, setTreeNaming] = useState<TreeNaming>({})

  useEffect(() => {
    if (!reloading) return
    const timer = window.setTimeout(() => {
      setUpdatedAt(new Date().toISOString())
      setReloading(false)
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [reloading])

  const query = search.trim().toLowerCase()
  const results = stations.filter((station) => statuses.includes(station.status)
    && (!basin || station.basin === basin)
    && station.name.toLowerCase().includes(query))
  const sortColumn = columns.find(({ id }) => id === sort?.column)?.id
  if (sort && sortColumn) {
    const direction = sort.direction === 'asc' ? 1 : -1
    results.sort((a, b) => direction * a[sortColumn].localeCompare(b[sortColumn]))
  }

  return <main className="components-demo">
    <header className="components-demo-header">
      <h1>HydroDB GUI components</h1>
      <p>Try the selection actions and use the shared table controls to explore the station catalog.</p>
    </header>

    <div className="components-demo-catalog">
      <div className="components-demo-columns" aria-hidden="true">
        <span>Component</span>
        <span>Demonstration</span>
        <span>Comments and characteristics</span>
      </div>

      <ExampleRow id="selection-example" name="Selection Action Bar"
        notes="Appears when a series is selected and announces the count out of eight. The 32 px icon buttons open the sample chart and download a fixture CSV. The Series popover has 32 px Remove and Close buttons. Clear resets the selection.">
        <SelectionActionBarDemo />
      </ExampleRow>

      <ExampleRow id="toolbar-example" name="Table Toolbar"
        notes="Groups table controls on the left and actions on the right. Groups wrap when the available width narrows. The basin selector is 32 px tall.">
        <TableToolbar controls={<div className="metadata-instance-select">
          <label htmlFor="demo-basin">River basin</label>
          <select ref={basinSelect} id="demo-basin" value={basin} onChange={(event) => {
            setBasin(event.target.value)
            setPage(1)
          }}>
            <option value="">All basins</option>
            {basins.map((value) => <option key={value}>{value}</option>)}
          </select>
        </div>} actions={<button type="button" className="components-demo-action" onClick={() => {
          setBasin('')
          setStatuses(statusChoices.map(({ id }) => id))
          setSearch('')
          setPage(1)
        }}>Clear filters</button>} />
      </ExampleRow>

      <ExampleRow id="refresh-example" name="Icon Button and Table Refresh"
        notes="Auto reload starts off. Each reload takes one simulated second, with no network request. The refresh icon shows when work is in progress. The next interval starts when the reload finishes.">
        <TableRefresh label="Refresh stations" updatedAt={updatedAt} busy={reloading} onRefresh={() => setReloading(true)} />
      </ExampleRow>

      <ExampleRow id="station-classification-example" name="Station Classification"
        notes="Classify three fixture stations by provider, owner, latest timestamp, or latest value. Apply the settings, then edit legend labels and colors or hide a class. Only Raw has sample readings in this offline example.">
        <StationClassificationDemo />
      </ExampleRow>

      <ExampleRow id="map-mouseover-example" name="Map Pin Mouseover"
        notes="Hover over the pin for the native browser tooltip. Each field has a label and its own line, as shown in the adjacent preview.">
        <div className="components-demo-map-mouseover">
          <span className="station-map-marker" role="img" aria-label={`${demoStation} / ${demoStationId}`}
            aria-description={[`Classification: ${demoBand}`, ...demoDetails].join('. ')} title={demoMarkerTitle}>
            <svg className="station-pin-icon" viewBox={stationPinViewBox} aria-hidden="true">
              <path d={stationPinPath} /><circle {...stationPinCenter} />
            </svg>
          </span>
          <span className="components-demo-map-tooltip">{demoMarkerTitle}</span>
        </div>
      </ExampleRow>

      <ExampleRow id="station-popup-example" name="Station Map Popup"
        notes="Click the pin to show the same labeled lines as the mouseover. The 36 px buttons open fixture metadata or a graph with all the station's fixture time series.">
        <StationPopupDemo />
      </ExampleRow>

      <ExampleRow id="settings-icon-example" name="Settings Icon"
        notes="A 32 × 32 px button with a 24 px gear. The application header and Station tree use the same glyph. Open the example to change which fields appear in station labels. Escape closes the popover and returns focus to the gear.">
        <TreeNamingSettings settings={treeNaming} change={setTreeNaming} />
      </ExampleRow>

      <ExampleRow id="help-icon-example" name="Help Icon (?)"
        notes="A 24 × 24 px circular button with an 18 px question mark. Activate it to expand or collapse help about that field. Keyboard activation keeps focus on the button.">
        <FilterAttributeHelp label="Component help"><span>Component which required explanation</span></FilterAttributeHelp>
      </ExampleRow>

      <ExampleRow id="checkbox-example" name="Checkbox Selector and Column Visibility"
        notes="Open Columns or Status to edit the table. Required columns stay visible, and the final selected status stays checked. Escape closes the popover.">
        <div className="components-demo-pickers">
          <ColumnVisibility columns={columns} visible={visible} toggle={(id, checked) => {
            setVisible((current) => checked ? [...current, id] : current.filter((value) => value !== id))
            if (!checked && sort?.column === id) {
              setSort(undefined)
              setPage(1)
            }
          }} />
          <CheckboxSelector label="Status" legend="Station status" choices={statusChoices} selected={statuses}
            summary={statuses.length === statusChoices.length ? 'All' : statuses[0]} toggle={(id, checked) => {
              setStatuses((current) => checked ? [...current, id] : current.filter((value) => value !== id))
              setPage(1)
            }} />
        </div>
      </ExampleRow>

      <ExampleRow id="search-example" name="Search Field"
        notes="A labeled native search input, 32 px tall. Typing filters station names before pagination and returns the table to page 1.">
        <SearchField label="Search station names" value={search} onChange={(value) => {
          setSearch(value)
          setPage(1)
        }} />
      </ExampleRow>

      <ExampleRow id="filter-chip-example" name="Filter Chip"
        notes="A 32 px tall chip shows an active filter and gives its remove button a specific accessible name. Removing the chip clears the basin filter.">
        {basin ? <FilterChip label={`River basin = ${basin}`} removeLabel={`Remove river basin filter ${basin}`} onRemove={() => {
          setBasin('')
          setPage(1)
          basinSelect.current?.focus()
        }} /> : <button type="button" className="components-demo-action" onClick={() => {
          setBasin(basins[0])
          setPage(1)
          basinSelect.current?.focus()
        }}>Apply Elbe filter</button>}
      </ExampleRow>

      <ExampleRow id="paging-example" name="Table Paging"
        notes="Shows the matching row total and page position. The rows-per-page selector is 26 px tall and offers 10, 25, or 50 rows. The 32 px navigation buttons disable unavailable directions.">
        <TablePaging index={page} total={results.length} size={size} changePage={setPage} changeSize={(next) => {
          setSize(next)
          setPage(1)
        }} />
      </ExampleRow>

      <ExampleRow id="table-example" name="Data Table and Column Controls"
        notes="This table responds to the filters, column picker, and pager above. Select a column heading to cycle its sort order. Drag a header boundary or use the arrow keys on its resize handle.">
        <DataTable caption="Example station records" hideCaption region="Example station table"
          columns={columns.filter(({ id }) => visible.includes(id))}
          rows={results.slice((page - 1) * size, page * size)} rowKey={(row) => row.identifier}
          rowHeader="name" cell={(row, column) => row[column as keyof Station]}
          widths={widths} changeWidths={setWidths} sort={sort} changeSort={(next) => {
            setSort(next)
            setPage(1)
          }} />
        {results.length === 0 && <p role="status">No stations match the current filters.</p>}
      </ExampleRow>
    </div>
  </main>
}
