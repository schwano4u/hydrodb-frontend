import { ApiError } from './api'
import { csvCell, json } from './metadataExport'
import type { ExportFormat } from './metadataExport'
import { identity, name } from './metadata'
import type { SampleResult } from './sampleViewer'

const exportLimitMiB = 64

export async function exportSelectedSamples(datasets: SampleResult[], format: ExportFormat, signal: AbortSignal) {
  const first = datasets[0]
  if (!first) throw new ApiError('invalid-input', 'Select at least one time series.')
  const context = {
    ...first.query, read_cutoff: first.cutoff, interpretation: 'original',
    series: datasets.map(({ node, samples }) => ({ id: identity(node), name: name(node), count: samples.length })),
  }
  const columns = ['series_id', 'timestamp', 'value', 'state', 'detection_bound', 'unit', 'period_start', 'period_end',
    'quality_code', 'quality_meaning', 'read_cutoff', 'sample_details']
  const parts: BlobPart[] = []
  const columnData = columns.map((name) => ({ name, type: 'STRING' as const, data: [] as (string | null)[] }))
  const encode = new TextEncoder()
  const limit = exportLimitMiB * 1024 * 1024
  let bytes = 0
  function checkSize(size: number) {
    if (size > limit) throw new ApiError('invalid-input', `The download exceeds ${exportLimitMiB} MiB. Narrow the UTC range.`)
  }
  function append(text: string) {
    const encoded = encode.encode(text)
    bytes += encoded.byteLength
    checkSize(bytes)
    parts.push(encoded)
  }
  if (format === 'csv') append(`${columns.map(csvCell).join(',')}\r\n`)
  if (format === 'json') append(`{"read_context":${json(context)},"samples":[`)
  let count = 0
  for (const { node, samples } of datasets) {
    const id = identity(node)
    for (const sample of samples) {
      signal.throwIfAborted()
      const exact = (value: number | bigint | string | null) => value === null ? null : String(value)
      const value = Array.isArray(sample.value) ? sample.value.map(exact) : exact(sample.value)
      const details = { ...sample, value, detectionBound: exact(sample.detectionBound) }
      if (format === 'json') append(`${count++ ? ',' : ''}${json({ series_id: id, ...details })}`)
      else {
        const cells = [id, sample.timestamp, Array.isArray(value) ? json(value) : value, sample.state,
          exact(sample.detectionBound), sample.definition.unitLabel, sample.period?.start ?? null, sample.period?.end ?? null,
          String(sample.qualityCode), sample.qualityMeaning ?? null, first.cutoff, json(details)]
        if (format === 'csv') {
          append(`${cells.map((cell, i) => cell !== null && (i === 2 || i === 4) && /^-\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(cell)
            ? `"${cell}"` : csvCell(cell)).join(',')}\r\n`)
        } else {
          bytes += encode.encode(json(cells)).byteLength
          checkSize(bytes)
          columnData.forEach((column, i) => column.data.push(cells[i] ?? null))
        }
      }
    }
  }
  if (format === 'json') append(']}')
  if (format === 'parquet') {
    const { parquetWriteBuffer } = await import('hyparquet-writer')
    signal.throwIfAborted()
    const buffer = parquetWriteBuffer({ columnData, codec: 'UNCOMPRESSED',
      kvMetadata: [{ key: 'hydrodb.read_context', value: json(context) }] })
    checkSize(buffer.byteLength)
    parts.push(buffer)
  }
  return new Blob(parts, { type: format === 'csv' ? 'text/csv;charset=utf-8' : format === 'json' ? 'application/json' : 'application/vnd.apache.parquet' })
}
