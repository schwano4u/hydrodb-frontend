import { lazy, Suspense, useId, useMemo, useRef, useState } from 'react'
import type { DockviewPanelApi } from 'dockview'
import TableRefresh from './TableRefresh'
import TableToolbar from './components/TableToolbar'
import { format, identity, name } from './metadata'
import type { useSampleViewer } from './useSampleViewer'
import type { SampleLocation, SampleQuery, SampleResult, ScientificSample } from './sampleViewer'
import { alignSamples, movingSampleRange, occurrenceLabel, sampleValueLabel } from './sampleViewer'
import ColumnVisibility from './ColumnVisibility'
import DataTable from './DataTable'
import type { TableColumn, TableSort } from './DataTable'
import { TablePaging } from './TablePaging'
import { panels } from './workspaceLayout'
import SampleTablePicker from './SampleTablePicker'
import SampleLegend from './SampleLegend'

const SampleChart = lazy(() => import('./SampleChart'))

function valueWithUnit(sample: ScientificSample) {
  const value = sampleValueLabel(sample)
  return sample.value !== null || sample.detectionBound !== null ? `${value} ${sample.definition.unitLabel}` : value
}

function unitTooltip(sample: ScientificSample) {
  const { unitLabel, unitId, unitVersion } = sample.definition
  return `${unitLabel} / ${unitId} / v${unitVersion}`
}

function revisionTooltip(sample: SampleResult['samples'][number]) {
  const { definition, aggregate } = sample
  const lines = [
    `Sample revision ${sample.revision} / Series v${sample.seriesVersion}`,
    `${definition.level} / ${definition.statistic} / ${definition.sampling}${definition.interval ? ` (${definition.interval})` : ''}`,
  ]
  if (definition.frame) lines.push(`Frame: ${definition.frame}; ${definition.axes.map(({ axis, meaning }) => `${axis}: ${meaning}`).join('; ')}`)
  lines.push('Source and lineage', format(sample.source), format(sample.scientificContext))
  if (definition.support !== null) lines.push('Period and statistic method', format(definition.support))
  if (definition.calendar !== null) lines.push('Calendar', format(definition.calendar))
  if (definition.policy !== null) lines.push('Quality and coverage policy', format(definition.policy))
  if (Object.keys(aggregate).length) lines.push('Reported aggregate evidence', format(aggregate))
  else if (definition.level === 'aggregated') lines.push('No per-result aggregate coverage or status was supplied.')
  return lines.join('\n')
}

const sampleColumns = [
  { id: 'timestamp', label: 'Timestamp (UTC)', width: 190, required: true, sortable: true },
  { id: 'period', label: 'Period (UTC)', width: 290 },
  { id: 'value', label: 'Value', width: 160, required: true },
  { id: 'state', label: 'State', width: 120 },
  { id: 'quality', label: 'Quality / original meaning', width: 175 },
  { id: 'revision', label: 'Revision', width: 140 },
]

const provenanceColumns = [
  { id: 'occurrence_time', label: 'Occurrence time (UTC)', width: 190 },
  { id: 'recorded_by', label: 'Recorded by', width: 270 },
  { id: 'recorded_at', label: 'Recorded at (UTC)', width: 190 },
] as const

function provenanceValue(sample: ScientificSample, field: string) {
  switch (field) {
    case 'occurrence_time': return occurrenceLabel(sample) ?? ''
    case 'recorded_by': return sample.recordedBy ?? ''
    case 'recorded_at': return sample.recordedAt ?? ''
    default: return undefined
  }
}

function useSamplePaging<Row extends { micros: bigint }>(allRows: readonly Row[], label: string, location?: SampleLocation) {
  const [paging, setPaging] = useState({ index: 1, size: 25 })
  const [sort, setSort] = useState<TableSort>()
  const [previousLocation, setPreviousLocation] = useState<SampleLocation>()
  const total = allRows.length
  if (previousLocation !== location) {
    setPreviousLocation(location)
    const offset = location ? allRows.findIndex(({ micros }) => micros === location.micros) : -1
    if (offset !== -1) {
      const position = sort?.direction === 'desc' ? total - 1 - offset : offset
      setPaging({ ...paging, index: Math.floor(position / paging.size) + 1 })
    }
  }
  const index = Math.min(paging.index, Math.max(1, Math.ceil(total / paging.size)))
  const first = (index - 1) * paging.size
  const end = Math.min(first + paging.size, total)
  const rows = sort?.direction === 'desc'
    ? allRows.slice(total - end, total - first).reverse()
    : allRows.slice(first, end)
  return {
    rows, sort, changeSort: (next?: TableSort) => { setSort(next); setPaging({ ...paging, index: 1 }) },
    pager: <TablePaging ariaLabel={label} index={index} total={total} size={paging.size}
      changePage={(index) => setPaging({ ...paging, index })}
      changeSize={(size) => setPaging({ index: 1, size })} />,
  }
}

function SampleTable({ data, columns, location }: { data: SampleResult; columns: TableColumn[]; location?: SampleLocation }) {
  const [widths, setWidths] = useState<Record<string, number>>({})
  const { rows, sort, changeSort, pager } = useSamplePaging(data.samples, 'Sample pagination', location)
  return <>
    {pager}
    <DataTable caption="Original samples / primary UTC timestamps in [start, end)" region="Exact sample table"
      rows={rows} rowKey={(sample) => String(sample.micros)} rowHeader="timestamp" rowLocation={location}
      columns={columns} widths={widths} changeWidths={setWidths}
      sort={sort} changeSort={changeSort}
      cellTitle={(sample, column) => column === 'quality'
        ? `${sample.qualityMeaning ?? 'Definition unavailable'}\n${sample.codebookId} / v${sample.codebookVersion}`
        : column === 'occurrence_time' ? sample.occurrenceReason
          : column === 'value' ? unitTooltip(sample)
            : column === 'revision' ? revisionTooltip(sample) : undefined}
      cell={(sample, column) => {
        switch (column) {
          case 'timestamp': return sample.timestamp
          case 'period': return sample.period ? <>
            [{sample.period.start}, {sample.period.end})<br />Primary timestamp: period {sample.definition.position}
          </> : 'Instantaneous'
          case 'value': return valueWithUnit(sample)
          case 'state': return sample.state
          case 'quality': return sample.qualityCode
          case 'revision': return sample.revision
          default: return provenanceValue(sample, column)
        }
      }} />
  </>
}

function alignedColumns(datasets: SampleResult[]): TableColumn[] {
  return [sampleColumns[0]!, ...datasets.flatMap(({ node }) => {
    const label = name(node)
    const id = identity(node)
    const title = label === id ? label : `${label} (${id})`
    const display = datasets.some((other) => other.node !== node && name(other.node) === label) ? title : label
    return [{ id: `series:${id}`, label: display, title, width: 160 },
      ...provenanceColumns.map((column) => ({ ...column, id: `${column.id}:series:${id}`, label: `${display}: ${column.label}` }))]
  })]
}

function alignedProvenance(column: string) {
  const split = column.indexOf(':')
  if (split > 0 && !column.startsWith('series:')) return { field: column.slice(0, split), series: column.slice(split + 1) }
}

function AlignedSampleTable({ datasets, columns, location }: { datasets: SampleResult[]; columns: TableColumn[]; location?: SampleLocation }) {
  const { allRows, grids } = useMemo(() => ({
    allRows: alignSamples(datasets),
    grids: new Map(datasets.map(({ node, grid }) => [`series:${identity(node)}`, grid])),
  }), [datasets])
  const { rows, sort, changeSort, pager } = useSamplePaging(allRows, 'Aligned sample pagination', location)
  const [widths, setWidths] = useState<Record<string, number>>({})
  function absentLabel(micros: bigint, column: string) {
    const grid = grids.get(column)
    if (!grid) return 'No sample'
    return (micros - grid.origin) % grid.interval === 0n ? 'Expected sample unavailable' : 'No sample expected'
  }
  return allRows.length ? <>
    {pager}
    <DataTable caption="Original samples aligned by exact primary UTC timestamp. A dash means an expected sample is unavailable; shaded blank cells indicate no sample was expected."
      region="Aligned sample table" rows={rows} rowKey={(row) => String(row.micros)} rowHeader="timestamp" rowLocation={location}
      columns={columns} widths={widths} changeWidths={setWidths} sort={sort} changeSort={changeSort}
      cellClassName={(row, column) => !row.samples.has(column) && absentLabel(row.micros, column) === 'No sample expected'
        ? 'sample-not-expected' : undefined}
      cellTitle={(row, column) => {
        const provenance = alignedProvenance(column)
        if (provenance) return provenance.field === 'occurrence_time' ? row.samples.get(provenance.series)?.occurrenceReason : undefined
        const sample = row.samples.get(column)
        if (!sample) return absentLabel(row.micros, column)
        return [
          sample.timestamp, unitTooltip(sample),
          `Quality ${sample.qualityCode}: ${sample.qualityMeaning ?? 'Definition unavailable'} / ${sample.codebookId} v${sample.codebookVersion}`,
          ...(sample.period ? [`Period: [${sample.period.start}, ${sample.period.end}) / label: ${sample.definition.position}`] : []),
          ...(sample.occurrence !== undefined ? [`Occurrence: ${occurrenceLabel(sample)}${sample.occurrenceReason ? ` (${sample.occurrenceReason})` : ''}`] : []),
          revisionTooltip(sample),
        ].join('\n')
      }}
      cell={(row, column) => {
        if (column === 'timestamp') return row.timestamp
        const provenance = alignedProvenance(column)
        if (provenance) {
          const sample = row.samples.get(provenance.series)
          return sample ? provenanceValue(sample, provenance.field) : ''
        }
        const sample = row.samples.get(column)
        if (sample) return `${valueWithUnit(sample)}${sample.state === 'rejected' ? ' (rejected)' : ''}`
        const label = absentLabel(row.micros, column)
        if (label === 'No sample') return label
        return <>{label === 'Expected sample unavailable' && <span aria-hidden="true">-</span>}
          <span className="identity-label">{label}</span></>
      }} />
  </> : <p role="status">No samples in the requested UTC range.</p>
}

export default function SampleViewer({ viewer, mode, openSampleData, title, inPopout, panelApi }: {
  viewer: ReturnType<typeof useSampleViewer>; mode: 'chart' | 'data'; openSampleData?: () => void; title?: string; inPopout?: boolean
  panelApi?: DockviewPanelApi
}) {
  const { selected, selections, query, result, sampleLocation } = viewer
  const [dataSeries, setDataSeries] = useState('')
  const [lastLocation, setLastLocation] = useState<SampleLocation>()
  if (mode === 'data' && lastLocation !== sampleLocation) {
    setLastLocation(sampleLocation)
    if (sampleLocation) setDataSeries(sampleLocation.seriesId)
  }
  const [align, setAlign] = useState(false)
  const [visibility, setVisibility] = useState<{ single: Record<string, boolean>; aligned: Record<string, boolean> }>({ single: {}, aligned: {} })
  const periodDraft = useRef<SampleQuery | undefined>(undefined)
  const datasets = result.datasets
  const overlay = selections.length > 1
  const plotted = useMemo(() => overlay ? datasets?.filter(({ samples }) => samples.length) : undefined, [datasets, overlay])
  const data = mode === 'data' ? datasets?.find(({ node }) => identity(node) === dataSeries) ?? datasets?.[0] : datasets?.[0]
  const legendId = useId()
  const dataModeId = useId()
  if (mode === 'chart') {
    const description = data?.node.item.series_description
    const emptySeries = datasets?.filter(({ samples }) => !samples.length).map(({ node }) => node)
    const hasSamples = overlay ? Boolean(plotted?.length) : Boolean(data?.samples.length)
    const onSampleClick = openSampleData && ((location: SampleLocation | undefined) => {
      viewer.setSampleLocation(location)
      if (location) openSampleData()
    })
    return <article className="metadata-panel sample-viewer sample-viewer-chart" aria-label={title ?? panels.series.title}>
      {!selected ? <p>Select one or more Time series using the checkboxes in Metadata, then choose Open visualization.</p> : <>
        <form className="sample-period" onSubmit={(event) => {
          event.preventDefault()
          periodDraft.current = undefined
          void viewer.load(true)
        }} onBlur={(event) => {
          if (periodDraft.current !== query || event.currentTarget.contains(event.relatedTarget)) return
          periodDraft.current = undefined
          void viewer.load()
        }}>
          <div className="sample-period-fields" role="group" aria-label="View period">
            <span>View period</span>
            {([['Moving month', 30], ['Moving week', 7], ['Moving day', 1]] as const).map(([label, days]) =>
              <button key={label} type="button" className="sample-period-preset"
                onClick={() => {
                  periodDraft.current = undefined
                  void viewer.applyPeriod(movingSampleRange(days))
                }}>{label}</button>)}
            {(['start', 'end'] as const).map((field) => {
              const label = field === 'start' ? 'Start UTC (inclusive)' : 'End UTC (exclusive)'
              return <label key={field}>{field === 'start' ? 'Start' : 'End'}
                <input type="text" aria-label={label} title={`${label}; ISO timestamp ending in Z`}
                  value={query[field]} required onChange={(event) => {
                    const next = { ...query, [field]: event.target.value }
                    periodDraft.current = next
                    viewer.edit(next)
                  }} />
              </label>
            })}
          </div>
          <TableRefresh type="submit" label="Reload samples" updatedAt={viewer.updatedAt} busy={result.loading}
            onAutoRefresh={() => { if (periodDraft.current !== query) void viewer.load(true) }} />
        </form>
        {overlay && !datasets && <p>{selections.length} series selected for overlay.</p>}
        {result.loading && <p role="status">Loading samples...</p>}
        {result.error && <p role="alert">{result.error}</p>}
        {data && <figure className="sample-figure" aria-labelledby={legendId}>
          <figcaption id={legendId}>{overlay ? <strong>Time series overlay</strong> : <>
            <span className="sample-legend-key" aria-hidden="true" /><strong>{name(data.node)}</strong>
            {typeof description === 'string' && description.trim() && <> — {description}</>}
          </>}
          </figcaption>
          {hasSamples ? <Suspense fallback={<p role="status">Loading chart...</p>}>
            <SampleChart data={data} overlays={plotted} emptySeries={emptySeries}
              sampleLocation={sampleLocation} onSampleClick={onSampleClick} panelApi={panelApi} />
          </Suspense> : <SampleLegend emptySeries={emptySeries} />}
        </figure>}
      </>}
    </article>
  }
  const aligned = align && overlay
  const tableMode = aligned ? 'aligned' : 'single'
  const intervals = !aligned && data?.samples.some((sample) => sample.period)
  const columns = aligned && datasets ? alignedColumns(datasets)
    : [...sampleColumns.filter(({ id }) => id !== 'period' || intervals), ...provenanceColumns]
  const visible = columns.filter(({ id }) =>
    visibility[tableMode][id] ?? !provenanceColumns.some((column) => column.id === id || id.startsWith(`${column.id}:`)))
  const modeOptions = [
    { value: 'single', label: 'Single series' },
    { value: 'aligned', label: 'Aligned series', disabled: !overlay },
  ]
  const seriesOptions = datasets?.map(({ node }) => ({
    value: identity(node), label: `${name(node)} (${identity(node)})`,
  })) ?? [{ value: '', label: 'No series loaded' }]
  const seriesValue = data ? identity(data.node) : ''
  const selectMode = (value: string) => setAlign(value === 'aligned')
  const modePicker = inPopout
    ? <SampleTablePicker label="Table mode" value={tableMode} options={modeOptions} onSelect={selectMode} />
    : <div className="metadata-instance-select">
      <label htmlFor={dataModeId}>Table mode</label>
      <select id={dataModeId} value={tableMode} onChange={(event) => selectMode(event.target.value)}>
        {modeOptions.map(({ value, label, disabled }) => <option key={value} value={value} disabled={disabled}>{label}</option>)}
      </select>
    </div>
  const seriesPicker = inPopout
    ? <SampleTablePicker label="Data series" value={seriesValue} options={seriesOptions} disabled={!data} onSelect={setDataSeries} />
    : <div className="metadata-instance-select">
      <label htmlFor={legendId}>Data series</label>
      <select id={legendId} value={seriesValue} disabled={!data}
        onChange={(event) => setDataSeries(event.target.value)}>
        {seriesOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
      </select>
    </div>
  const tableKey = data && datasets ? JSON.stringify([data.cutoff, data.query.start, data.query.end, datasets.map(({ node }) => identity(node))]) : undefined
  return <article className="metadata-panel sample-viewer sample-viewer-data table-panel" aria-label={title ?? panels['series-data'].title}>
    <TableToolbar controls={<>
      {data && <ColumnVisibility columns={columns} visible={visible.map(({ id }) => id)} toggle={(id, checked) => {
        setVisibility((current) => ({ ...current, [tableMode]: { ...current[tableMode], [id]: checked } }))
      }} />}
      {modePicker}{!aligned && seriesPicker}
    </>} />
    {data && datasets ? aligned ? <AlignedSampleTable
      key={tableKey}
      datasets={datasets} columns={visible} location={sampleLocation} /> :
      <SampleTable key={tableKey} data={data}
        columns={visible} location={sampleLocation?.seriesId === identity(data.node) ? sampleLocation : undefined} /> : <>
      {aligned && result.loading && <p role="status">Loading samples...</p>}
      {aligned && result.error && <p role="alert">{result.error}</p>}
    </>}
  </article>
}
