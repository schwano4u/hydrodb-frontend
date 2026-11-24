import { useRef } from 'react'
import type { ColumnResize } from './tableColumnLayout'

export function ResizeHandle({ title, width, minimum, maximum, resize }: ColumnResize) {
  const drag = useRef<{ x: number; width: number } | null>(null)
  const adjust = (value: number) => resize(Math.max(minimum, Math.min(maximum, value)))
  return <span className="metadata-column-resize" role="separator" tabIndex={0} aria-label={`Resize ${title}`}
    aria-orientation="vertical" aria-valuemin={Math.round(minimum)} aria-valuemax={Math.round(maximum)} aria-valuenow={Math.round(width)}
    onKeyDown={(event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      adjust(event.key === 'Home' ? minimum : event.key === 'End' ? maximum : width + (event.key === 'ArrowLeft' ? -10 : 10))
    }}
    onPointerDown={(event) => {
      event.preventDefault()
      drag.current = { x: event.clientX, width }
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={(event) => { if (drag.current) adjust(drag.current.width + event.clientX - drag.current.x) }}
    onPointerUp={() => { drag.current = null }}
    onPointerCancel={() => { drag.current = null }} />
}

export function ColumnSortButton({ label, direction, onSort, pressed, title }: {
  label: string; direction?: 'asc' | 'desc'; onSort: (direction?: 'asc' | 'desc') => void
  pressed?: boolean; title?: string
}) {
  const arrow = direction === 'asc' ? 'M8 13V3m-4 4 4-4 4 4'
    : direction === 'desc' ? 'M8 3v10m-4-4 4 4 4-4' : 'm4 6 4-3 4 3M4 10l4 3 4-3'
  return <button type="button" className="metadata-column-sort" title={title} aria-pressed={pressed}
    onClick={() => onSort(direction === 'asc' ? 'desc' : direction === 'desc' ? undefined : 'asc')}>
    <span>{label}</span>
    <svg className="metadata-sort-icon" data-sort={direction ?? 'none'} viewBox="0 0 16 16" aria-hidden="true">
      <path d={arrow} />
    </svg>
  </button>
}
