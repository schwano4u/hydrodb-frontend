import { ApiError } from './api'
import { catalogPath, decodeNode, decodePage, entities, identity, name } from './metadata'
import type { CatalogSort, Collection, Json, MetadataClient, MetadataNode, Selection } from './metadata'

export type ExportFormat = 'csv' | 'json' | 'parquet'
const maxBytes = 50 * 1024 * 1024
const encode = new TextEncoder()
const json = (value: unknown) => JSON.stringify(value, (_key, item: unknown) =>
  typeof item === 'bigint' ? item.toString() : item)

function row(node: MetadataNode, selection: Selection): Record<string, Json> {
  return Object.fromEntries([
    ['name', name(node)], ['id', identity(node)],
    ...entities[node.collection].fields.map((field) => [field, field === 'status' ? node.status
      : node.references.some((ref) => ref.field === field)
        ? node.references.filter((ref) => ref.field === field).map((ref) => `${ref.id} / v${ref.version}`).join('; ')
        : selection.asOf && field.startsWith('station_location') ? null : node.item[field] ?? null]),
  ])
}

function cell(value: Json): string | null {
  return value === null ? null : typeof value === 'object' ? json(value) : String(value)
}

function csvCell(value: Json): string {
  const text = cell(value) ?? ''
  const safe = /^[=+\-@\t\r\n]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}

export async function exportMetadata({
  client, selection, collection, cutoff, format, signal, progress, columns = ['name', 'id', ...entities[collection].fields], sort,
}: {
  client: MetadataClient; selection: Selection; collection: Collection; cutoff: string
  format: ExportFormat; signal: AbortSignal; progress: (rows: number) => void
  columns?: string[]; sort?: CatalogSort
}): Promise<Blob> {
  const allowed = ['name', 'id', ...entities[collection].fields]
  if (!columns.length || new Set(columns).size !== columns.length || columns.some((column) => !allowed.includes(column))) {
    throw new ApiError('invalid-input', 'Select at least one valid table column before downloading.')
  }
  const context = { collection, read_cutoff: cutoff, as_of: selection.asOf, filters: selection.filters, q: selection.q, columns, sort }
  const parts: BlobPart[] = []
  const columnData = columns.map((name) => ({ name, data: [] as (string | null)[], type: 'STRING' as const }))
  let bytes = 0
  function account(size: number) {
    bytes += size
    if (bytes > maxBytes) throw new ApiError('invalid-input', 'Download exceeds the 50 MiB browser export limit. Narrow the filters and try again. No partial file was downloaded.')
  }
  function append(text: string) {
    const data = encode.encode(text)
    account(data.byteLength)
    parts.push(data)
  }
  if (format === 'csv') append(`${columns.map(csvCell).join(',')}\r\n`)
  if (format === 'json') append(`${json(context).slice(0, -1)},"rows":[`)
  let count = 0
  let after = ''
  const seen = new Set<string>()
  do {
    signal.throwIfAborted()
    const page = await client.read(catalogPath(selection, collection, { after }, cutoff, sort),
      (body) => decodePage(body, decodeNode), signal)
    signal.throwIfAborted()
    for (const node of page.items) {
      if (node.collection !== collection) throw new ApiError('malformed', 'The export returned an unexpected metadata collection.')
      const all = row(node, selection)
      const values = Object.fromEntries(columns.map((column) => [column, all[column]!]))
      if (format === 'csv') append(`${columns.map((column) => csvCell(values[column]!)).join(',')}\r\n`)
      else if (format === 'json') append(`${count ? ',' : ''}${json(values)}`)
      else {
        account(encode.encode(json(values)).byteLength)
        columnData.forEach((column) => column.data.push(cell(values[column.name]!)))
      }
      count++
    }
    progress(count)
    after = page.next ?? ''
    if (after && (seen.has(after) || !page.items.length)) {
      throw new ApiError('malformed', 'The export returned a non-advancing metadata page.')
    }
    seen.add(after)
  } while (after)
  signal.throwIfAborted()
  if (format === 'json') append(']}')
  if (format === 'parquet') {
    const { parquetWriteBuffer } = await import('hyparquet-writer')
    signal.throwIfAborted()
    const buffer = parquetWriteBuffer({
      columnData, codec: 'UNCOMPRESSED',
      kvMetadata: [{ key: 'hydrodb.read_context', value: json(context) }],
    })
    if (buffer.byteLength > maxBytes) account(buffer.byteLength)
    parts.push(buffer)
  }
  signal.throwIfAborted()
  return new Blob(parts, { type: format === 'csv' ? 'text/csv;charset=utf-8' : format === 'json' ? 'application/json' : 'application/vnd.apache.parquet' })
}
