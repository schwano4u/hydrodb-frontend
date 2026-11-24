import { ApiError } from './api'
import { catalogPath, decodeChoice, decodeNode, decodePage, identity, name, object } from './metadata'
import type { Choice, Filter, MetadataClient } from './metadata'
import type { MapStation } from './metadataMap'
import { timestampMicros } from './sampleViewer'

export type Mode = 'off' | 'attribute' | 'timestamp' | 'value'
export type Attribute = 'station_provider' | 'station_owner'
export type Band = { label: string; color: string }
export type MapClassificationSnapshot = {
  classification: Classification
  hiddenClasses: ReadonlySet<string>
  bands: ReadonlyMap<string, Band>
}
export const freshnessDays = { '1': 1, '3': 3, '7': 7, off: 0 } as const
export type Freshness = keyof typeof freshnessDays
type Source = { parameter: string; level: string; showValues?: boolean }
export type Classification = { mode: 'off' } | { mode: 'attribute'; attribute: Attribute }
  | ({ mode: 'timestamp'; breaks: number[] } & Source)
  | ({ mode: 'value'; breaks: number[]; freshness: Freshness; unit: string; unitLabel: string } & Source)
type Status = 'no_series' | 'ambiguous' | 'unavailable' | 'no_data' | 'sample'
export type Summary = { status: Status; series?: string; timestamp?: string; value?: number; unit?: string }
export type Assignment = Band & {
  key: string; detail: string; boundary: string; editable?: boolean; markerValue?: number | string; mouseover?: string[]
}
export type ClassificationChoice = Choice & {
  symbol?: string; units?: { canonical: string; allowed: string[] }; parameterName?: string; externalId?: string
}

export function classificationParameterChoices(choices: ClassificationChoice[], filters: readonly Filter[]) {
  const selections = filters.filter(({ collection, field }) => collection === 'parameters'
    ? field === 'parameter_id' || field === 'parameter_name' || field === 'parameter_external_id'
    : collection === 'series' && field === 'parameter_id')
  if (!selections.length) return { choices, preset: '' }
  const matches = choices.filter((choice) => selections.every(({ field, values }) => {
    const value = field === 'parameter_name' ? choice.parameterName
      : field === 'parameter_external_id' ? choice.externalId : choice.value
    return value !== undefined && values.includes(value)
  }))
  return { choices: matches, preset: matches.length === 1 ? matches[0]!.value : '' }
}

const palette = ['#0066d6', '#bd490d', '#007d61', '#843eb0', '#9c6500', '#b73168', '#397340', '#256b80']
const neutral = '#657280'
export const attributeLabels: Record<Attribute, string> = { station_provider: 'Station provider', station_owner: 'Station owner' }
const noData = 'No data'
const multipleSeries = 'Multiple matching series'
const statusLabels: Record<Exclude<Status, 'sample'>, string> = {
  no_series: 'No matching series', ambiguous: multipleSeries, unavailable: 'Unavailable', no_data: noData,
}

export async function readClassificationChoices(client: MetadataClient, collection: 'parameters' | 'units',
  cutoff: string, signal: AbortSignal): Promise<ClassificationChoice[]> {
  const choices = new Map<string, ClassificationChoice>()
  const cursors = new Set<string>()
  let after = ''
  do {
    const path = catalogPath({ filters: [], q: '', asOf: '', instanceStatus: 'active' }, collection, { after, limit: '50' }, cutoff)
    const page = await client.read(path, (body) => decodePage(body, decodeNode), signal)
    for (const node of page.items) {
      const id = identity(node)
      if (node.collection !== collection || choices.has(id)) throw new ApiError('malformed', 'Invalid classification catalog page.')
      const symbol = node.item.unit_symbol
      const title = name(node)
      const label = collection === 'units' && typeof symbol === 'string' && symbol !== title ? `${title} (${symbol})` : title
      if (collection === 'parameters') {
        const canonical = node.item.parameter_canonical_unit_id
        const allowed = node.item.parameter_allowed_unit_ids
        if (typeof canonical !== 'string' || !canonical || (allowed != null &&
          (!Array.isArray(allowed) || !allowed.every((unit) => typeof unit === 'string') || !allowed.includes(canonical)))) {
          throw new ApiError('malformed', 'Invalid parameter unit definitions.')
        }
        const externalId = node.item.parameter_external_id
        choices.set(id, { value: id, label, units: { canonical, allowed: allowed ?? [canonical] },
          parameterName: title, externalId: typeof externalId === 'string' ? externalId : undefined })
      } else choices.set(id, { value: id, label, symbol: typeof symbol === 'string' ? symbol : undefined })
    }
    after = page.next ?? ''
    if (after && (cursors.has(after) || !page.items.length)) throw new ApiError('malformed', 'Invalid classification catalog cursor.')
    cursors.add(after)
  } while (after)
  const counts = new Map<string, number>()
  for (const { label } of choices.values()) counts.set(label, (counts.get(label) ?? 0) + 1)
  return [...choices.values()].sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value))
    .map((choice) => counts.get(choice.label) === 1 ? choice : { ...choice, label: `${choice.label} (${choice.value})` })
}

export async function readAttributeClasses(client: MetadataClient, field: Attribute, cutoff: string, signal: AbortSignal) {
  const classes = new Set<string>()
  const cursors = new Set<string>()
  let after = ''
  do {
    const path = catalogPath({ filters: [], q: '', asOf: '' }, 'stations',
      { mode: 'values', field, after, limit: '50' }, cutoff)
    const page = await client.read(path, (body) => decodePage(body, decodeChoice), signal)
    for (const { value } of page.items) if (value.trim()) classes.add(value)
    after = page.next ?? ''
    if (after && (cursors.has(after) || !page.items.length)) throw new ApiError('malformed', 'Invalid station attribute catalog cursor.')
    cursors.add(after)
  } while (after)
  return [...classes].sort((a, b) => a.localeCompare(b))
}

export function summaryOptions(config: Classification) {
  if (config.mode === 'off' || config.mode === 'attribute') return ''
  const query = new URLSearchParams({ parameter_id: config.parameter, level: config.level })
  if (config.mode === 'value') query.set('unit_id', config.unit)
  else query.set('match_mode', 'latest_timestamp')
  return query.toString()
}

export async function readStationSummaries(client: MetadataClient, stations: readonly MapStation[], options: string,
  cutoff: string, signal: AbortSignal) {
  const result = new Map<string, Summary>()
  const ids = stations.filter(({ point }) => point).map(({ node }) => identity(node))
  for (let index = 0; index < ids.length; index += 50) {
    const batch = ids.slice(index, index + 50)
    const query = new URLSearchParams(options)
    query.set('station_ids', JSON.stringify(batch))
    query.set('read_cutoff', cutoff)
    const rows = await client.read(`/api/v1/metadata/station-summaries?${query}`, (body) => {
      const invalid = () => { throw new ApiError('malformed', 'Invalid station classification response.') }
      if (!object(body) || body.read_cutoff !== cutoff || !Array.isArray(body.items) || body.items.length !== batch.length) return invalid()
      const remaining = new Set(batch)
      const items = new Map<string, Summary>()
      for (const row of body.items) {
        if (!object(row) || typeof row.station_id !== 'string' || !remaining.delete(row.station_id)) return invalid()
        const status = row.status
        if (status === 'ambiguous' && query.get('match_mode') === 'latest_timestamp') return invalid()
        if (status !== 'sample' && status !== 'no_series' && status !== 'ambiguous' &&
          status !== 'unavailable' && status !== 'no_data') return invalid()
        const summary: Summary = { status, series: typeof row.series_id === 'string' ? row.series_id : undefined }
        if (status === 'sample') {
          if (!summary.series || typeof row.timestamp !== 'string') return invalid()
          try { timestampMicros(row.timestamp) } catch { return invalid() }
          summary.timestamp = row.timestamp
          const value = typeof row.value === 'bigint' ? Number(row.value) : row.value
          if (typeof value === 'number' && Number.isFinite(value)) summary.value = value
          if (typeof row.unit === 'string') summary.unit = row.unit
        }
        items.set(row.station_id, summary)
      }
      return items
    }, signal)
    for (const [id, row] of rows) result.set(id, row)
  }
  return result
}

const status = (label: string, detail = label): Assignment => ({ key: `status:${label}`, label, boundary: label, color: neutral, detail })
function band(overrides: ReadonlyMap<string, Band>, key: string, label: string, color: string, detail = label): Assignment {
  return { key, label, color, ...overrides.get(key), detail, boundary: label, editable: true }
}

function attributeClass(attribute: Attribute, raw: unknown, overrides: ReadonlyMap<string, Band>): Assignment {
  const title = attributeLabels[attribute]
  if (typeof raw !== 'string' || !raw.trim()) {
    const detail = `${title}: Not specified`
    return { ...status('Not specified', detail), mouseover: [detail] }
  }
  const hash = [...raw].reduce((value, char) => (Math.imul(value, 31) + char.charCodeAt(0)) >>> 0, 0)
  const color = raw === 'DWD' ? palette[0]! : raw === 'WSV' ? palette[1]! : palette[hash % palette.length]!
  const detail = `${title}: ${raw}`
  return { ...band(overrides, `${attribute}:${raw}`, raw, color, detail), mouseover: [detail] }
}

function sampleBand(config: Extract<Classification, Source>, index: number, overrides: ReadonlyMap<string, Band>, detail?: string) {
  const lower = config.breaks[index - 1]
  const upper = config.breaks[index]
  const label = config.mode === 'timestamp'
    ? [lower === undefined ? '' : `> ${lower} h`, upper === undefined ? '' : `≤ ${upper} h`].filter(Boolean).join(' to ')
    : [lower === undefined ? '' : `≥ ${lower}`, upper === undefined ? '' : `< ${upper}`].filter(Boolean).join(' and ') + ` ${config.unitLabel}`
  return band(overrides, `${config.mode}:${index}`, label, palette[index % palette.length]!, detail)
}

export function classificationClasses(config: Classification, categories: readonly string[], overrides: ReadonlyMap<string, Band>) {
  if (config.mode === 'off') return []
  if (config.mode === 'attribute') return [...categories.map((value) => attributeClass(config.attribute, value, overrides)), status('Not specified')]
  const classes = Array.from({ length: config.breaks.length + 1 }, (_, index) => sampleBand(config, index, overrides))
  return [...classes, ...(config.mode === 'value' ? [status(multipleSeries)] : []), status(noData),
    ...(config.mode === 'value' && config.freshness !== 'off' ? [status('Stale')] : [])]
}

function formatAge(ageMicros: bigint) {
  const minutes = ageMicros / 60_000_000n
  const absolute = minutes < 0n ? -minutes : minutes
  return `${minutes < 0n ? '-' : ''}${String(absolute / 60n).padStart(2, '0')}:${String(absolute % 60n).padStart(2, '0')}`
}

export function assignStation(config: Classification, station: MapStation, summary: Summary | undefined,
  reference: number, overrides: ReadonlyMap<string, Band>, failed: boolean): Assignment | undefined {
  if (config.mode === 'off') return
  if (config.mode === 'attribute') return attributeClass(config.attribute, station.node.item[config.attribute], overrides)
  if (!summary) return status(failed ? 'Read failed' : 'Loading')
  if (summary.status === 'ambiguous' && config.mode === 'timestamp') return status('Read failed')
  if (summary.status !== 'sample') {
    const reason = statusLabels[summary.status]
    const label = summary.status === 'ambiguous' ? multipleSeries : noData
    return {
      ...status(label, summary.series ? `${reason} | Series: ${summary.series}` : reason),
      mouseover: [...(reason === label ? [] : [`Status: ${reason}`]), ...(summary.series ? [`Series: ${summary.series}`] : [])],
    }
  }
  const timestamp = summary.timestamp!
  const detail = `Series: ${summary.series} | ${timestamp}`
  const mouseover = [`Series: ${summary.series}`, `Latest timestamp: ${timestamp}`]
  const age = BigInt(reference) * 1000n - timestampMicros(timestamp)
  let index: number
  if (config.mode === 'value') {
    if (config.freshness !== 'off' && age > BigInt(freshnessDays[config.freshness]) * 86_400_000_000n) {
      return { ...status('Stale', detail), mouseover }
    }
    if (summary.value === undefined || summary.unit === undefined) {
      return { ...status(noData, `No usable value | ${detail}`), mouseover: [...mouseover, 'Status: No usable value'] }
    }
    index = config.breaks.filter((edge) => summary.value! >= edge).length
  } else {
    index = config.breaks.filter((edge) => Number(age) > edge * 3_600_000_000).length
  }
  if (config.mode === 'timestamp') return {
    ...sampleBand(config, index, overrides, detail),
    mouseover,
    markerValue: config.showValues ? formatAge(age) : undefined,
  }
  return {
    ...sampleBand(config, index, overrides, `${detail} | ${summary.value} ${summary.unit}`),
    mouseover: [...mouseover, `Value: ${summary.value} ${summary.unit}`],
    markerValue: config.showValues ? summary.value : undefined,
  }
}
