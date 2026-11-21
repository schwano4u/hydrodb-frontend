import { entities, label } from './metadata'
import type { CatalogSort, Collection } from './metadata'

export interface TableSettings {
  visible: string[]
  widths: Record<string, number>
  sort?: CatalogSort
  pageSize: number
}
export function tableColumns(collection: Collection) {
  return [
    { id: 'name_id', label: 'Name / stable ID', sort: 'name', fields: ['name', 'id'], width: 250 },
    ...entities[collection].fields.map((field) => ({
      id: field, label: label(field),
      sort: field.startsWith('station_location') ? undefined : field,
      fields: [field], width: 180,
    })),
  ]
}
export function defaultTableSettings(collection: Collection): TableSettings {
  return { visible: tableColumns(collection).map((column) => column.id), widths: {}, pageSize: 50 }
}
export function tableExportColumns(collection: Collection, settings: TableSettings) {
  return tableColumns(collection).filter((column) => settings.visible.includes(column.id)).flatMap((column) => column.fields)
}
