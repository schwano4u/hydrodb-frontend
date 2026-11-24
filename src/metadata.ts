import { ApiError, metadataGet, sampleGet } from './api'
import type { MetadataPath, SamplePath } from './api'
import type { MapPoint } from './mapPolygon'

export const entities = {
  stations: { title: 'Stations', prefix: 'station', fields: ['station_external_id', 'station_location_status', 'station_location', 'status'] },
  sampling_positions: { title: 'Sampling positions', prefix: 'sampling_position', fields: ['station_id', 'sampling_position_vertical_offset', 'unit_id', 'sampling_position_reference'] },
  instruments: { title: 'Instruments', prefix: 'instrument', fields: ['instrument_type', 'instrument_manufacturer', 'instrument_model', 'instrument_serial_number'] },
  instrument_deployments: { title: 'Instrument deployments', prefix: 'instrument_deployment', fields: ['instrument_id', 'station_id', 'sampling_position_id', 'instrument_deployment_valid_from', 'instrument_deployment_valid_to'] },
  parameters: { title: 'Parameters', prefix: 'parameter', fields: ['parameter_group_id', 'parameter_quantity_kind', 'parameter_canonical_unit_id', 'parameter_allowed_value_shapes'] },
  parameter_groups: { title: 'Parameter groups', prefix: 'parameter_group', fields: ['parameter_group_metadata_version'] },
  quality_codebooks: { title: 'Quality codebooks', prefix: 'quality_codebook', fields: ['quality_codebook_metadata_version'] },
  series: { title: 'Time series', prefix: 'series', fields: ['station_id', 'parameter_id', 'unit_id', 'series_processing_level', 'series_value_shape', 'series_value_statistic', 'series_sampling_definition', 'series_sampling_interval', 'series_period_definition'] },
  units: { title: 'Units', prefix: 'unit', fields: ['unit_symbol', 'unit_ucum_code', 'unit_dimension'] },
}
export type Collection = keyof typeof entities

const optionalFields: Record<Collection, readonly string[]> = {
  stations: ['station_owner', 'station_provider', 'station_type', 'station_time_zone', 'station_user_attributes'],
  sampling_positions: [],
  instruments: [],
  instrument_deployments: [],
  parameters: [
    'parameter_allowed_unit_ids', 'parameter_allowed_value_statistics', 'parameter_allowed_timestamp_positions',
    'parameter_temporal_semantics', 'parameter_numeric_precision', 'parameter_plausibility_rules',
    'parameter_user_attributes', 'parameter_mappings',
  ],
  parameter_groups: [],
  quality_codebooks: ['quality_codebook_entries'],
  series: [
    'dataset_id', 'quality_codebook_id', 'sampling_position_id', 'instrument_deployment_id',
    'series_sampling_alignment', 'series_timestamp_position', 'series_calendar_definition', 'series_quality_coverage_policy',
  ],
  units: ['unit_definition_uri', 'unit_si_scale', 'unit_si_offset'],
}

export function metadataFields(collection: Collection): string[] {
  const { fields, prefix } = entities[collection]
  return [...new Set([
    ...fields, ...optionalFields[collection],
    ...['description', 'external_id', 'provenance', 'metadata_version', 'validity_start'].map((field) => `${prefix}_${field}`),
    'status',
  ])]
}

export type Json = null | boolean | string | number | bigint | Json[] | { [key: string]: Json }
export interface Reference { collection: Collection; id: string; version: string; field: string }
export interface MetadataNode {
  collection: Collection
  item: { [key: string]: Json }
  status: 'active' | 'retired'
  references: Reference[]
  position_scope: 'current_only' | 'unavailable'
}
export interface Page<T> { items: T[]; next: string | null; cutoff: string; total?: number }
export interface Filter { collection: Collection; field: string; values: string[] }
export interface Choice { value: string; label: string }
export interface Selection {
  filters: Filter[]; q: string; asOf: string; instanceStatus?: MetadataNode['status']; polygon?: MapPoint[]
}
export interface CatalogSort { column: string; direction: 'asc' | 'desc' }
export interface DetailSelection extends Reference { cutoff: string; asOf: string }
export interface SelectedSeries extends DetailSelection { name: string }
export const collections = Object.keys(entities).filter(isCollection)
export function isCollection(value: unknown): value is Collection {
  return typeof value === 'string' && Object.hasOwn(entities, value)
}
export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function invalid(): never { throw new ApiError('malformed', 'The API returned an invalid metadata page or revision pin.') }
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 }
export function version(value: unknown): string {
  const exact = typeof value === 'bigint' || (typeof value === 'number' && Number.isSafeInteger(value)) ? String(value) : value
  if (typeof exact !== 'string' || !/^[1-9]\d{0,18}$/.test(exact) || BigInt(exact) > 9223372036854775807n) invalid()
  return exact
}
export function isJson(value: unknown, depth = 0, budget = { count: 0 }): value is Json {
  if (depth > 32 || ++budget.count > 50000) return false
  return value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'bigint' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    (Array.isArray(value) ? value.every((v: unknown) => isJson(v, depth + 1, budget)) :
      object(value) && Object.values(value).every((v) => isJson(v, depth + 1, budget)))
}
export function decodeNode(value: unknown): MetadataNode {
  if (!object(value) || !isCollection(value.collection) || !object(value.item) || !isJson(value.item) ||
    !['active', 'retired'].includes(String(value.status)) || !['current_only', 'unavailable'].includes(String(value.position_scope)) ||
    !Array.isArray(value.references)) invalid()
  const prefix = entities[value.collection].prefix
  if (!text(value.item[`${prefix}_id`]) || !text(value.item[`${prefix}_validity_start`])) invalid()
  version(value.item[`${prefix}_metadata_version`])
  const references = value.references.map((ref: unknown): Reference => {
    if (!object(ref) || !isCollection(ref.collection) || !text(ref.id) || !text(ref.field)) invalid()
    return { collection: ref.collection, id: ref.id, field: ref.field, version: version(ref.version) }
  })
  return {
    collection: value.collection, item: value.item,
    status: value.status === 'active' ? 'active' : 'retired',
    position_scope: value.position_scope === 'current_only' ? 'current_only' : 'unavailable',
    references,
  }
}
export function decodePage<T>(body: unknown, decode: (value: unknown) => T, maxItems = 50): Page<T> {
  if (!object(body) || !Array.isArray(body.items) || body.items.length > maxItems ||
    !(body.next_after === null || text(body.next_after) || typeof body.next_after === 'number' || typeof body.next_after === 'bigint') ||
    !text(body.read_cutoff)) invalid()
  const total = typeof body.total === 'bigint' && body.total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(body.total) : body.total
  if (total !== undefined && (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0)) invalid()
  return { items: body.items.map(decode), next: body.next_after === null ? null : String(body.next_after), cutoff: body.read_cutoff,
    ...(total === undefined ? {} : { total }) }
}
export const decodeChoice = (value: unknown): Choice => {
  if (!object(value) || !text(value.value) || !text(value.label)) invalid()
  return { value: value.value, label: value.label }
}
export function decodeBranch(value: unknown): MetadataNode[] {
  if (!object(value) || !Array.isArray(value.path) || value.path.length > 100) invalid()
  return value.path.map(decodeNode)
}
export function identity(node: MetadataNode): string { return String(node.item[`${entities[node.collection].prefix}_id`]) }
export function nodeVersion(node: MetadataNode): string { return version(node.item[`${entities[node.collection].prefix}_metadata_version`]) }
export function name(node: MetadataNode): string { return String(node.item[`${entities[node.collection].prefix}_name`] ?? identity(node)) }
export function reference(node: MetadataNode): Reference {
  return { collection: node.collection, id: identity(node), version: nodeVersion(node), field: '' }
}
export function format(value: Json | undefined, depth = 0): string {
  if (value === undefined) return 'Unknown / unspecified'
  if (value === null) return depth ? 'null' : 'Unknown / unspecified'
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string') return depth ? JSON.stringify(value) : value
  if (typeof value !== 'object') return String(value)
  if (Array.isArray(value)) return `[${value.map((v) => format(v, depth + 1)).join(', ')}]`
  return `{\n${Object.entries(value).map(([k, v]) => `${'  '.repeat(depth + 1)}${JSON.stringify(k)}: ${v === null ? 'null' : format(v, depth + 1)}`).join(',\n')}\n${'  '.repeat(depth)}}`
}
export const label = (field: string) => field.replaceAll('_', ' ')
export function attributes(collection: Collection): string[] {
  const prefix = entities[collection].prefix
  const scalar = entities[collection].fields.filter((f) =>
    !['station_location', 'station_location_status', 'parameter_quantity_kind', 'parameter_allowed_value_shapes', 'unit_dimension', 'series_sampling_definition', 'series_sampling_interval', 'series_period_definition', 'parameter_metadata_version'].includes(f))
  return [...new Set([`${prefix}_id`, `${prefix}_name`, `${prefix}_external_id`, 'status', ...scalar,
    ...(collection === 'series' ? ['series_sampling_kind'] : [])])]
}
export function catalogPath(selection: Selection, collection: Collection, options: Record<string, string>, cutoff?: string, sort?: CatalogSort): MetadataPath {
  const params = new URLSearchParams({ collection, limit: '25', filters: JSON.stringify(selection.filters), q: selection.q, ...options })
  if (selection.polygon && !selection.asOf && options.mode !== 'detail') params.set('polygon', JSON.stringify(selection.polygon))
  if (selection.instanceStatus) params.set('status', selection.instanceStatus)
  if (cutoff) params.set('read_cutoff', cutoff)
  else if (selection.asOf) params.set('as_of', selection.asOf)
  if (sort) { params.set('sort', sort.column); params.set('order', sort.direction) }
  return `/api/v1/metadata/browser?${params}`
}

export class MetadataClient {
  private cache = new Map<string, { bytes: number; value: unknown }>()
  private bytes = 0
  private active = 0
  clear() { this.cache.clear(); this.bytes = 0 }
  private admitRead() {
    if (this.active >= 4) throw new ApiError('invalid-input', 'Four data reads are already active. Close a branch or retry.')
    this.active++
  }
  async readSamples<T>(path: SamplePath, decode: (body: unknown) => T, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted()
    this.admitRead()
    try { return await sampleGet(path, decode, signal) } finally { this.active-- }
  }
  async read<T>(path: MetadataPath, decode: (value: unknown) => T, signal: AbortSignal, { fresh = false } = {}): Promise<T> {
    signal.throwIfAborted()
    const cacheable = !fresh && path.startsWith('/api/v1/metadata/')
    const cached = fresh ? undefined : this.cache.get(path)
    if (cached) return decode(cached.value)
    this.admitRead()
    try {
      return await metadataGet(path, (body) => {
        const result = decode(body)
        const expected = new URL(path, window.location.origin).searchParams.get('read_cutoff')
        if (expected && (!object(body) || body.read_cutoff !== expected)) {
          throw new ApiError('malformed', 'The metadata response changed the requested read cutoff.')
        }
        const bytes = new TextEncoder().encode(JSON.stringify(body, (_key, value: unknown) =>
          typeof value === 'bigint' ? value.toString() : value)).byteLength
        if (cacheable && !signal.aborted && bytes <= 1024 * 1024) {
          while (this.cache.size && (this.cache.size >= 12 || this.bytes + bytes > 4 * 1024 * 1024)) {
            const key = this.cache.keys().next().value
            if (key === undefined) break
            this.bytes -= this.cache.get(key)!.bytes
            this.cache.delete(key)
          }
          const previous = this.cache.get(path)
          if (previous) this.bytes -= previous.bytes
          this.cache.set(path, { bytes, value: body }); this.bytes += bytes
          const url = new URL(path, window.location.origin)
          if (url.pathname === '/api/v1/metadata/browser' && !url.searchParams.has('read_cutoff') &&
            object(body) && typeof body.read_cutoff === 'string') {
            url.searchParams.delete('as_of')
            url.searchParams.set('read_cutoff', body.read_cutoff)
            const captured = `${url.pathname}?${url.searchParams}`
            const existing = this.cache.get(captured)
            if (existing) this.bytes -= existing.bytes
            this.cache.set(captured, { bytes, value: body }); this.bytes += bytes
            while (this.cache.size > 12 || this.bytes > 4 * 1024 * 1024) {
              const oldest = this.cache.keys().next().value
              if (oldest === undefined) break
              this.bytes -= this.cache.get(oldest)!.bytes
              this.cache.delete(oldest)
            }
          }
        }
        return result
      }, signal)
    } finally { this.active-- }
  }
}
