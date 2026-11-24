import { entities, label, metadataFields } from './metadata'
import type { CatalogSort, Collection } from './metadata'

export interface TableSettings {
  visible: string[]
  widths: Record<string, number>
  sort?: CatalogSort
  selectedFirst?: boolean
  pageSize: number
}

const seriesColumnWidths: Record<string, number> = {
  name_id: 380,
  station_id: 216,
  parameter_id: 144,
  unit_id: 100,
  series_processing_level: 142,
  series_value_shape: 122,
  series_value_statistic: 138,
  series_sampling_definition: 168,
  series_sampling_interval: 132,
  series_period_definition: 168,
}

const columnLabels: Record<string, string> = {
  series_processing_level: 'processing level',
  series_value_shape: 'value shape',
  series_value_statistic: 'value statistic',
  series_sampling_definition: 'sampling definition',
  series_sampling_interval: 'sampling interval',
  series_period_definition: 'period definition',
}

export const coverageFields = ['first_sample_at', 'last_sample_at'] as const
export function isCoverageField(field: string): field is typeof coverageFields[number] {
  return coverageFields.some((value) => value === field)
}

export function tableColumns(collection: Collection) {
  const widths = collection === 'series' ? seriesColumnWidths : undefined
  return [
    { id: 'name_id', label: 'Name / stable ID', sort: 'name', fields: ['name', 'id'], width: widths?.name_id ?? 250 },
    ...metadataFields(collection).map((field) => ({
      id: field, label: columnLabels[field] ?? label(field),
      sort: field.startsWith('station_location') ? undefined : field,
      fields: [field], width: widths?.[field] ?? 180,
    })),
    ...(collection === 'series' ? coverageFields.map((id, index) => ({
      id, label: index === 0 ? 'First sample (UTC)' : 'Last sample (UTC)',
      sort: id, fields: [], width: 190,
    })) : []),
  ]
}
export function defaultTableSettings(collection: Collection): TableSettings {
  const fields = entities[collection].fields
  const visible = collection === 'series'
    ? [...fields.filter((field) => field !== 'series_period_definition'), ...coverageFields]
    : fields
  return { visible: ['name_id', ...visible], widths: {}, pageSize: 10 }
}
export function tableExportColumns(collection: Collection, settings: TableSettings) {
  return tableColumns(collection).filter((column) => settings.visible.includes(column.id)).flatMap((column) => column.fields)
}
