import { useId } from 'react'
import type { ReactNode } from 'react'
import IconButton from './IconButton'

export default function SelectionActionBar({
  selections, limit, label = 'Selection Action Bar', downloadAction, onOpen, onClear, onRemove,
}: {
  selections: readonly { id: string; name: string }[]
  limit: number
  label?: string
  downloadAction: ReactNode
  onOpen: () => void
  onClear: () => void
  onRemove: (id: string) => void
}) {
  const id = useId()
  return <section className="series-selection-toolbar" aria-label={label}>
    <span role="status">{selections.length} of {limit} series selected</span>
    <IconButton label="Open visualization" onClick={onOpen}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3v18h18M7 14l4-4 4 3 5-6" /></svg>
    </IconButton>
    {downloadAction}
    <button type="button" className="series-selection-action" popoverTarget={id} aria-haspopup="dialog">Series</button>
    <button type="button" className="series-selection-action" onClick={onClear}>Clear</button>
    <div className="series-list-popover" id={id} popover="auto" role="dialog" aria-label="Selected series">
      <strong>Selected series</strong>
      <ul>{selections.map(({ id, name }) => {
        const label = name === id ? id : `${name} (${id})`
        return <li key={id}>
          <span>{label}</span>
          <button type="button" aria-label={`Remove ${label} from selection`} onClick={(event) => {
            const row = event.currentTarget.closest('li')
            const neighbor = row?.nextElementSibling ?? row?.previousElementSibling
            neighbor?.querySelector('button')?.focus()
            onRemove(id)
          }}>Remove</button>
        </li>
      })}</ul>
      <button type="button" popoverTarget={id} popoverTargetAction="hide">Close</button>
    </div>
  </section>
}
