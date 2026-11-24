import { ApiError } from './api'
import { catalogPath, decodeNode, decodePage, identity, isJson, nodeVersion, object, version } from './metadata'
import type { DetailSelection, Json, MetadataClient, MetadataNode } from './metadata'

export const sampleLimit = 20_000
export const seriesSelectionLimit = 8
export const samplePageLimit = 100
const sampleLimitMiB = 256
const byteLimit = sampleLimitMiB * 1024 * 1024
export interface SampleQuery { start: string; end: string; asOf: string }
type ExactNumber = number | bigint | string
export interface SampleDefinition {
  seriesId: string; version: string; name: string; level: string
  axes: { axis: string; meaning: string }[]; frame?: string
  statistic: string; position?: 'start' | 'end'; support: Json; calendar: Json; policy: Json
  sampling: 'equidistant' | 'non-equidistant' | 'unknown'
  interval?: string; intervalMicros?: bigint
  unitId: string; unitVersion: string; unitLabel: string
}
export interface ScientificSample {
  timestamp: string; micros: bigint; value: ExactNumber | ExactNumber[] | null
  state: 'valid' | 'missing' | 'rejected' | 'censored_below' | 'censored_above'
  detectionBound: ExactNumber | null
  period?: { start: string; end: string; startMicros: bigint; endMicros: bigint }
  occurrence?: string | null; occurrenceReason?: string
  recordedAt?: string; recordedBy?: string
  aggregate: Record<string, Json>
  revision: string; seriesVersion: string; qualityCode: number
  codebookId: string; codebookVersion: string; qualityMeaning?: string
  definition: SampleDefinition; source: Json; scientificContext: Json
}
export interface SampleResult {
  query: SampleQuery; cutoff: string; node: MetadataNode; samples: ScientificSample[]; chartDefinition?: SampleDefinition
  grid?: { interval: bigint; origin: bigint }
}
export type SampleLocation = { seriesId: string; micros: bigint }
function invalid(message = 'The API returned malformed sample data.'): never {
  throw new ApiError('malformed', message)
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.length) invalid()
  return value
}

export function timestampMicros(value: string): bigint {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) throw new ApiError('invalid-input', 'Use an ISO timestamp with timezone and at most six fractional digits; leap seconds are not supported.')
  const local = Date.parse(`${match[1]}Z`)
  const offset = match[3]!
  const hours = offset === 'Z' ? 0 : Number(offset.slice(1, 3))
  const minutes = offset === 'Z' ? 0 : Number(offset.slice(4, 6))
  if (!Number.isFinite(local) || new Date(local).toISOString().slice(0, 19) !== match[1] || hours > 23 || minutes > 59) {
    throw new ApiError('invalid-input', 'The timestamp contains an invalid calendar date or timezone.')
  }
  const shift = (hours * 60 + minutes) * (offset.startsWith('-') ? -1 : 1)
  return BigInt(local - shift * 60_000) * 1000n + BigInt((match[2] ?? '').padEnd(6, '0'))
}
function timestampFromMicros(micros: bigint): string {
  const fraction = ((micros % 1_000_000n) + 1_000_000n) % 1_000_000n
  return new Date(Number((micros - fraction) / 1000n)).toISOString().replace('.000Z', `.${String(fraction).padStart(6, '0')}Z`)
}
export function validateSampleQuery(query: SampleQuery): SampleQuery {
  for (const value of [query.start, query.end, ...(query.asOf ? [query.asOf] : [])]) {
    if (!value.endsWith('Z')) throw new ApiError('invalid-input', 'Enter UTC timestamps ending in Z.')
    timestampMicros(value)
  }
  if (timestampMicros(query.start) >= timestampMicros(query.end)) {
    throw new ApiError('invalid-input', 'End must be after start. Sample windows are [start, end).')
  }
  return query
}
export function movingSampleRange(days: number): Pick<SampleQuery, 'start' | 'end'> {
  const end = new Date()
  return { start: new Date(end.getTime() - days * 86_400_000).toISOString(), end: end.toISOString() }
}
export function defaultSampleQuery(asOf = ''): SampleQuery {
  return { ...movingSampleRange(1), asOf }
}
function intervalMicros(value: unknown): bigint {
  const match = typeof value === 'string' && /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value)
  if (!match || value.endsWith('T')) invalid('The equidistant series has an invalid sampling interval.')
  const seconds = BigInt(match[1] ?? 0) * 86400n + BigInt(match[2] ?? 0) * 3600n +
    BigInt(match[3] ?? 0) * 60n + BigInt(match[4] ?? 0)
  if (seconds <= 0n || seconds > 100n * 366n * 86400n) invalid('The sampling interval is outside the supported duration range.')
  return seconds * 1000000n
}
function json(value: unknown): Json {
  if (value == null) return null
  if (!isJson(value)) invalid()
  return value
}
function definition(original: Record<string, unknown>, seriesId: string, seriesVersion: string): SampleDefinition {
  if (original.series_id !== seriesId || version(original.series_metadata_version) !== seriesVersion ||
    !object(original.series_sampling_definition) || !object(original.resolved_definitions) ||
    !object(original.resolved_definitions.unit)) invalid('The sample has inconsistent retained scientific pins.')
  const sampling = original.series_sampling_definition.kind
  if (sampling !== 'equidistant' && sampling !== 'non-equidistant' && sampling !== 'unknown') invalid()
  const unit = original.resolved_definitions.unit
  const unitId = text(original.unit_id)
  const unitVersion = version(original.unit_metadata_version)
  if (unit.unit_id !== unitId || version(unit.unit_metadata_version) !== unitVersion) invalid('The sample Unit does not match its retained pin.')
  if (!['raw', 'validated', 'calculated', 'aggregated'].includes(String(original.series_processing_level))) invalid()
  const shape = original.series_value_shape
  const labels = shape === 'scalar' ? ['Value'] : shape === 'vector2' ? ['x', 'y'] : shape === 'vector3' ? ['x', 'y', 'z'] : invalid('Unknown sample shape.')
  const vector = object(original.scientific_context) ? original.scientific_context.vector : undefined
  const axes = labels.map((axis, index) => {
    if (shape === 'scalar') return { axis, meaning: '' }
    const entry = object(vector) && Array.isArray(vector.axes) && vector.axes.length === labels.length ? vector.axes[index] : undefined
    if (!object(entry) || entry.axis !== axis) invalid('The original vector axis definition is unavailable or invalid.')
    return { axis, meaning: text(entry.meaning) }
  })
  const statistic = text(original.series_value_statistic)
  const position = original.series_timestamp_position
  const support = json(original.series_period_definition)
  if (statistic === 'instantaneous' ? position != null || support !== null
    : !['average', 'total', 'minimum', 'maximum', 'count'].includes(statistic) ||
      (position !== 'start' && position !== 'end') || !object(support)) invalid('Invalid original statistic or interval definition.')
  const storedInterval = original.series_sampling_interval
  const interval = sampling === 'equidistant'
    ? typeof storedInterval === 'bigint' || (typeof storedInterval === 'number' && Number.isSafeInteger(storedInterval))
      ? `PT${storedInterval}S` : text(storedInterval)
    : undefined
  return {
    seriesId, version: seriesVersion, name: text(original.series_name), level: text(original.series_processing_level),
    sampling, unitId, unitVersion, unitLabel: text(unit.unit_symbol ?? unit.unit_name ?? unit.unit_id),
    axes, ...(object(vector) && shape !== 'scalar' ? { frame: text(vector.reference_frame) } : {}),
    statistic, position: position === 'start' || position === 'end' ? position : undefined,
    support, calendar: json(original.series_calendar_definition), policy: json(original.series_quality_coverage_policy),
    ...(interval ? { interval, intervalMicros: intervalMicros(interval) } : {}),
  }
}
function exactNumber(value: unknown): ExactNumber | null {
  if (value === null || typeof value === 'bigint' || (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value))) return value
  invalid('The sample has an invalid numeric value.')
}
function sampleTime(value: unknown): { text: string; micros: bigint } {
  const timestamp = text(value)
  try { return { text: timestamp, micros: timestampMicros(timestamp) } }
  catch { invalid('The sample has an invalid timestamp, interval bound, or occurrence time.') }
}
function decodeSample(value: unknown, seriesId: string): ScientificSample {
  if (!object(value) || !object(value.interpretation) || !object(value.interpretation.original)) invalid('The sample is missing its original interpretation.')
  const { text: timestamp, micros } = sampleTime(value.timestamp)
  const seriesVersion = version(value.series_metadata_version)
  const original = value.interpretation.original
  const meta = definition(original, seriesId, seriesVersion)
  let period: ScientificSample['period']
  if (meta.position && (value.period_start != null || value.period_end != null)) {
    const start = sampleTime(value.period_start)
    const end = sampleTime(value.period_end)
    if (start.micros >= end.micros || micros !== (meta.position === 'start' ? start.micros : end.micros)) invalid('The sample label does not match its represented period.')
    period = { start: start.text, end: end.text, startMicros: start.micros, endMicros: end.micros }
  } else if (meta.position && object(meta.support) && meta.support.kind === 'fixed') {
    const duration = intervalMicros(meta.support.duration)
    const startMicros = meta.position === 'start' ? micros : micros - duration
    const endMicros = meta.position === 'end' ? micros : micros + duration
    period = { start: timestampFromMicros(startMicros), end: timestampFromMicros(endMicros), startMicros, endMicros }
  } else if (value.period_start != null || value.period_end != null) invalid('An instantaneous sample cannot have interval bounds.')
  let occurrence: ScientificSample['occurrence']
  if (meta.position && (meta.statistic === 'minimum' || meta.statistic === 'maximum')) {
    occurrence = null
    if (value.occurrence != null) {
      const time = sampleTime(value.occurrence)
      const start = period?.startMicros ?? (meta.position === 'start' ? micros : undefined)
      const end = period?.endMicros ?? (meta.position === 'end' ? micros : undefined)
      if ((start !== undefined && time.micros < start) || (end !== undefined && time.micros >= end)) invalid('An extremum occurrence lies outside the represented period.')
      occurrence = time.text
    }
  } else if (value.occurrence != null) invalid('Only extrema can have occurrence times.')
  let number: ScientificSample['value']
  if (meta.axes.length > 1 && value.value !== null) {
    if (!Array.isArray(value.value) || value.value.length !== meta.axes.length) invalid('Invalid component values for the sample shape.')
    number = value.value.map((entry) => exactNumber(entry) ?? invalid('A vector value cannot have a missing component.'))
  } else {
    number = exactNumber(value.value)
  }
  const state = value.state
  if (state !== 'valid' && state !== 'missing' && state !== 'rejected' && state !== 'censored_below' && state !== 'censored_above') invalid()
  const detectionBound = exactNumber(value.detection_bound)
  if ((state === 'valid' && number === null) || (state === 'missing' && number !== null)) invalid('The sample value conflicts with its declared result state.')
  const censored = state === 'censored_below' || state === 'censored_above'
  if (censored !== (detectionBound !== null)) invalid('The detection bound conflicts with the sample state.')
  if (typeof value.quality_code !== 'number' || !Number.isInteger(value.quality_code) || value.quality_code < 0 || value.quality_code > 255) invalid()
  const codebookId = text(value.quality_codebook_id)
  const codebookVersion = version(value.quality_codebook_metadata_version)
  if (original.quality_codebook_id !== codebookId || version(original.quality_codebook_metadata_version) !== codebookVersion) invalid('The quality codebook does not match its original pin.')
  const book = object(original.resolved_definitions) ? original.resolved_definitions.quality_codebook : undefined
  let qualityMeaning: string | undefined
  if (object(book)) {
    if (book.quality_codebook_id !== codebookId || version(book.quality_codebook_metadata_version) !== codebookVersion) invalid()
    if (!Array.isArray(book.quality_codebook_entries)) invalid()
    const entry = book.quality_codebook_entries.find((entry: unknown) => object(entry) && entry.code === value.quality_code)
    if (object(entry) && typeof entry.meaning === 'string') qualityMeaning = entry.meaning
  }
  if (!isJson(value.source) || !isJson(original.scientific_context)) invalid('The sample source or scientific context is malformed.')
  const aggregate = Object.fromEntries(Object.entries(value).filter(([key]) =>
    /^(?:aggregate(?:_|$)|coverage(?:_|$)|status$|partial$|stale$|is_(?:partial|stale)$|covered_seconds$|quality_policy$|excluded$|(?:input|usable|expected)_(?:count|duration|seconds))/.test(key))
    .map(([key, entry]) => [key, json(entry)]))
  const recordedAt = value.recorded_at == null ? undefined : sampleTime(value.recorded_at).text
  const recordedBy = value.recorded_by == null ? undefined : text(value.recorded_by)
  return {
    timestamp, micros, value: number, state, detectionBound, revision: version(value.revision_no), seriesVersion,
    qualityCode: value.quality_code, codebookId, codebookVersion, qualityMeaning, definition: meta,
    source: value.source, scientificContext: original.scientific_context,
    period, occurrence, occurrenceReason: typeof value.occurrence_unavailable_reason === 'string' ? value.occurrence_unavailable_reason : undefined,
    aggregate, recordedAt, recordedBy,
  }
}
export function plotNumber(value: ExactNumber | null): number | null {
  return typeof value === 'number' && (!Number.isInteger(value) || Number.isSafeInteger(value)) ? value : null
}
export function plotValue(sample: ScientificSample, component: number): number | null {
  return sample.state === 'valid' ? plotNumber(Array.isArray(sample.value) ? sample.value[component] ?? null : sample.value) : null
}
export async function readScientificSamples(client: MetadataClient, selected: DetailSelection, query: SampleQuery,
  signal: AbortSignal, cutoff?: string, onCutoff?: (cutoff: string) => void,
  budget = { bytes: 0, rows: 0 }): Promise<SampleResult> {
  validateSampleQuery(query)
  const metadata = await client.read(catalogPath({ filters: [], q: '', asOf: query.asOf }, 'series',
    { mode: 'detail', id: selected.id }, cutoff), (body) => decodePage(body, decodeNode), signal)
  signal.throwIfAborted()
  const resolved = metadata.cutoff
  onCutoff?.(resolved)
  const node = metadata.items[0]
  if (!node || node.collection !== 'series' || identity(node) !== selected.id || metadata.items.length !== 1) {
    throw new ApiError('http', 'This series is missing or not accessible at the requested cutoff.', 404)
  }
  const sampling = node.item.series_sampling_definition
  const alignment = node.item.series_sampling_alignment
  const grid = object(sampling) && sampling.kind === 'equidistant' && alignment != null
    ? { interval: intervalMicros(node.item.series_sampling_interval),
      origin: timestampMicros(text(object(alignment) ? alignment.origin : undefined)) }
    : undefined
  const samples: ScientificSample[] = []
  const activeVersion = nodeVersion(node)
  let chartDefinition: SampleDefinition | undefined
  const start = timestampMicros(query.start)
  const end = timestampMicros(query.end)
  let previous: bigint | undefined
  let after = ''
  do {
    signal.throwIfAborted()
    const params = new URLSearchParams({ start: query.start, end: query.end, limit: String(samplePageLimit),
      read_cutoff: resolved, interpretation: 'original', ...(after ? { after } : {}) })
    const page = await client.readSamples(`/api/v1/series/${encodeURIComponent(selected.id)}/samples?${params}`, (body) => {
      if (!object(body) || body.series_id !== selected.id || body.read_cutoff !== resolved || body.selection !== 'primary' ||
        !Array.isArray(body.items) || body.items.length > samplePageLimit ||
        !(body.next_after === null || typeof body.next_after === 'string') ||
        timestampMicros(text(body.start)) !== start || timestampMicros(text(body.end)) !== end) invalid('The sample response changed the requested series, window, or cutoff.')
      budget.bytes += new TextEncoder().encode(JSON.stringify(body, (_key, value: unknown) => typeof value === 'bigint' ? value.toString() : value)).byteLength
      if (budget.bytes > byteLimit) throw new ApiError('invalid-input', `Sample reads exceed the ${sampleLimitMiB} MiB viewer limit. Narrow the UTC range; no partial plot was displayed.`)
      return { items: body.items.map((value) => decodeSample(value, selected.id)), next: body.next_after }
    }, signal)
    signal.throwIfAborted()
    for (const sample of page.items) {
      if (sample.micros < start || sample.micros >= end || (previous !== undefined && sample.micros <= previous)) invalid('Sample timestamps are outside the query or do not advance.')
      previous = sample.micros
      if (!chartDefinition && sample.seriesVersion === activeVersion) chartDefinition = sample.definition
      samples.push(sample)
      if (++budget.rows > sampleLimit) throw new ApiError('invalid-input', `The viewer is limited to ${sampleLimit.toLocaleString('en')} samples. Narrow the UTC range; no partial plot was displayed.`)
    }
    if (page.next !== null) {
      if (!page.items.length || timestampMicros(page.next) !== previous) invalid('The sample cursor does not match the last returned timestamp.')
      if (budget.rows === sampleLimit) throw new ApiError('invalid-input', `The range contains more than ${sampleLimit.toLocaleString('en')} samples. Narrow the UTC range; no partial plot was displayed.`)
    }
    after = page.next ?? ''
  } while (after)
  if (samples.length && !chartDefinition) {
    const params = new URLSearchParams({ read_cutoff: resolved, mode: 'original',
      series_metadata_version: activeVersion, observation_time: query.start })
    chartDefinition = await client.read(`/api/v1/metadata/series/${encodeURIComponent(selected.id)}/interpretation?${params}`, (body) => {
      if (!object(body) || body.read_cutoff !== resolved || !object(body.original)) {
        invalid('The API did not return the active Series definition at the graph cutoff.')
      }
      return definition(body.original, selected.id, activeVersion)
    }, signal)
    signal.throwIfAborted()
  }
  return { query, cutoff: resolved, node, samples, chartDefinition, grid }
}

export async function readSelectedSeries(client: MetadataClient, selections: readonly DetailSelection[], query: SampleQuery,
  signal: AbortSignal, cutoff?: string, onCutoff?: (cutoff: string) => void): Promise<SampleResult[]> {
  if (!selections.length || selections.length > seriesSelectionLimit) {
    throw new ApiError('invalid-input', `Select between 1 and ${seriesSelectionLimit} time series.`)
  }
  const datasets: SampleResult[] = []
  const budget = { bytes: 0, rows: 0 }
  for (const selected of selections) {
    signal.throwIfAborted()
    datasets.push(await readScientificSamples(client, selected, query, signal, cutoff, (resolved) => {
      if (!datasets.length) onCutoff?.(resolved)
      cutoff = resolved
    }, budget))
  }
  return datasets
}

export function alignSamples(datasets: readonly SampleResult[]) {
  const byTime = new Map<bigint, { micros: bigint; timestamp: string; samples: Map<string, ScientificSample> }>()
  for (const { node, samples } of datasets) {
    const column = `series:${identity(node)}`
    for (const sample of samples) {
      let row = byTime.get(sample.micros)
      if (!row) {
        const micros = sample.micros
        // Keep sub-millisecond precision when normalizing an offset timestamp to UTC.
        const timestamp = sample.timestamp.endsWith('Z') ? sample.timestamp : timestampFromMicros(micros)
        row = { micros, timestamp, samples: new Map() }
        byTime.set(micros, row)
      }
      row.samples.set(column, sample)
    }
  }
  return [...byTime.values()].sort((a, b) => a.micros < b.micros ? -1 : a.micros > b.micros ? 1 : 0)
}

export function componentPlotPoints(samples: ScientificSample[], component: number, interval?: bigint): { value: [number, number | null]; sampleIndex: number }[] {
  const points: { value: [number, number | null]; sampleIndex: number }[] = []
  samples.forEach((sample, index) => {
    const previous = samples[index - 1]
    if (previous && interval && sample.micros - previous.micros > interval) {
      points.push({ value: [Number(previous.micros + interval) / 1000, null], sampleIndex: -1 })
    }
    points.push({ value: [Number(sample.micros) / 1000, plotValue(sample, component)], sampleIndex: index })
  })
  return points
}

export function sampleValueLabel(sample: ScientificSample, definition = sample.definition): string {
  const value = reportedValueLabel(sample, definition)
  if (sample.detectionBound !== null) return `${sample.state === 'censored_below' ? '<' : '>'} ${sample.detectionBound} (detection bound)${sample.value !== null ? `; reported: ${value}` : ''}`
  return value
}

function reportedValueLabel(sample: ScientificSample, definition: SampleDefinition): string {
  if (sample.value === null) return sample.state === 'missing' ? 'Missing' : 'No reported value'
  return Array.isArray(sample.value) ? sample.value.map((value, index) => `${definition.axes[index]?.axis}: ${value}`).join('; ') : String(sample.value)
}

export function occurrenceLabel(sample: ScientificSample): string | undefined {
  return sample.occurrence === null ? 'Unknown' : sample.occurrence
}

export function intervalPlotPoints(samples: ScientificSample[], component: number) {
  return samples.flatMap((sample, sampleIndex) => {
    const value = plotValue(sample, component)
    if (!sample.period || value === null) return []
    const { startMicros, endMicros } = sample.period
    return [{ value: [Number(startMicros) / 1000, Number(endMicros) / 1000, value], sampleIndex }]
  })
}
