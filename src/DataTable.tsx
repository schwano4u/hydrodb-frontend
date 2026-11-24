import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ColumnSortButton, ResizeHandle } from './TableColumnControls'
import { tableColumnLayout } from './tableColumnLayout'

export type TableColumn = {
  id: string; label: string; width: number; required?: boolean; sortable?: boolean; title?: string
}
export type TableSort = { column: string; direction: 'asc' | 'desc' }

export default function DataTable<Row>({ caption, hideCaption, region, columns, rows, rowKey, cell, cellTitle, cellClassName,
  rowHeader, rowLocation, widths, changeWidths, sort, changeSort, leading }: {
  caption: string; hideCaption?: boolean; region: string; columns: readonly TableColumn[]
  rows: readonly Row[]; rowKey: (row: Row) => string | number; cell: (row: Row, column: string) => ReactNode
  cellTitle?: (row: Row, column: string) => string | undefined
  cellClassName?: (row: Row, column: string) => string | undefined
  rowLocation?: { micros: bigint }
  rowHeader?: string; widths: Record<string, number>; changeWidths: (widths: Record<string, number>) => void
  sort?: TableSort; changeSort?: (sort?: TableSort) => void
  leading?: { width: number; header: ReactNode; descending?: boolean; cell: (row: Row) => ReactNode }
}) {
  const container = useRef<HTMLDivElement>(null)
  const locatedHeader = useRef<HTMLTableCellElement>(null)
  useEffect(() => {
    if (!rowLocation) return
    const frame = requestAnimationFrame(() => {
      const header = locatedHeader.current
      if (!header?.getClientRects().length) return
      header.focus({ preventScroll: true })
      header.scrollIntoView({ block: 'center', inline: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [rowLocation])
  const [measuredWidth, setMeasuredWidth] = useState(0)
  useEffect(() => {
    const element = container.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setMeasuredWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const leadingWidth = leading && (measuredWidth ? Math.min(leading.width, Math.floor(measuredWidth / 3)) : leading.width)
  const layout = tableColumnLayout(columns, widths, measuredWidth, changeWidths, leadingWidth)

  return <div ref={container} className="metadata-table-scroll" tabIndex={0} role="region" aria-label={region}>
    <table className="metadata-table">
      <caption className={hideCaption ? 'table-caption-hidden' : undefined}>
        {hideCaption ? <span className="identity-label">{caption}</span> : caption}
      </caption>
      <colgroup>{leading && <col style={{ width: leadingWidth }} />}
        {columns.map(({ id }, index) => {
          const { width, percentage } = layout[index]!
          return <col key={id} style={{ width: leading && width ? width : `${percentage}%` }} />
        })}
      </colgroup>
      <thead><tr>{leading && <th scope="col" className="metadata-series-checkbox"
        aria-sort={leading.descending ? 'descending' : undefined}>{leading.header}</th>}
        {columns.map(({ id, label, title, sortable }, index) => {
          const direction = sort?.column === id ? sort.direction : undefined
          const handle = layout[index]!.handle
          return <th key={id} scope="col" aria-label={label}
            aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : undefined}>
            {sortable && changeSort ? <ColumnSortButton label={label} direction={direction}
              onSort={(next) => changeSort(next && { column: id, direction: next })} /> : <span title={title}>{label}</span>}
            {handle && <ResizeHandle {...handle} />}
          </th>
        })}
      </tr></thead>
      <tbody>{rows.map((row) => {
        const key = rowKey(row)
        const located = rowLocation !== undefined && key === String(rowLocation.micros)
        return <tr key={key} aria-current={located || undefined}>
          {leading && <td className="metadata-series-checkbox">{leading.cell(row)}</td>}
          {columns.map(({ id }) => id === rowHeader ? <th key={id} scope="row"
            ref={located ? locatedHeader : undefined} tabIndex={located ? -1 : undefined}>{cell(row, id)}</th>
            : <td key={id} title={cellTitle?.(row, id)} className={cellClassName?.(row, id)}>{cell(row, id)}</td>)}
        </tr>
      })}</tbody>
    </table>
  </div>
}
