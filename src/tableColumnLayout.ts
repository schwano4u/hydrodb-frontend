export type ColumnResize = {
  title: string; width: number; minimum: number; maximum: number; resize: (width: number) => void
}

type ColumnWidths = Record<string, number>
type TableColumn = { id: string; label: string; width: number }

export function tableColumnLayout(columns: readonly TableColumn[], widths: ColumnWidths, measuredWidth: number,
  changeWidths: (widths: ColumnWidths) => void, fixedWidth = 0) {
  // The two outer half-borders occupy one pixel outside the column grid.
  const available = Math.max(0, measuredWidth - fixedWidth - 1)
  const weights = columns.map((column) => widths[column.id] ?? column.width)
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const displayed = weights.map((weight) => available * weight / total)
  const minimum = Math.min(80, available / (columns.length * 2), ...displayed)

  return columns.map((column, index) => {
    let handle: ColumnResize | undefined
    if (available > 0 && index < columns.length - 1) {
      const right = displayed.slice(index + 1)
      const rightWeight = weights.slice(index + 1).reduce((sum, weight) => sum + weight, 0)
      const current = displayed[index]!
      handle = {
        title: column.label, width: current, minimum,
        maximum: current + right.reduce((sum, width) => sum + width, 0) * (1 - minimum / Math.min(...right)),
        resize(value) {
          const nextWeight = value * total / available
          const scale = (rightWeight + weights[index]! - nextWeight) / rightWeight
          const next = { ...widths, [column.id]: nextWeight }
          for (let i = index + 1; i < columns.length; i++) next[columns[i]!.id] = weights[i]! * scale
          changeWidths(next)
        },
      }
    }
    return { width: displayed[index]!, percentage: 100 * weights[index]! / total, handle }
  })
}
