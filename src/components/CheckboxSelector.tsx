import { useId, useRef, useState } from 'react'
import { positionMetadataPopup } from '../metadataPopup'

export default function CheckboxSelector<T extends string>({ label, legend, choices, selected, toggle, summary }: {
  label: string; legend: string; summary?: string
  choices: readonly { id: T; label: string; required?: boolean }[]
  selected: readonly T[]
  toggle: (id: T, checked: boolean) => void
}) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const [expanded, setExpanded] = useState(false)
  return <div className="metadata-columns">
    <button type="button" ref={trigger} popoverTarget={id} aria-haspopup="dialog" aria-expanded={expanded}>
      {label}{summary && `: ${summary}`}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    <div id={id} className="metadata-columns-popup" popover="auto" role="dialog" aria-label={label}
      onToggle={(event) => {
        setExpanded(event.newState === 'open')
        if (event.newState !== 'open' || !trigger.current) return
        const popup = event.currentTarget
        positionMetadataPopup(popup, trigger.current)
        popup.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus()
      }}>
      <fieldset><legend>{legend}</legend>{choices.map((choice) => {
        const checked = selected.includes(choice.id)
        return <div key={choice.id}><label className="metadata-choice">
          <input type="checkbox" checked={checked} disabled={choice.required || (checked && selected.length === 1)}
            onChange={(event) => toggle(choice.id, event.target.checked)} />{choice.label}
        </label></div>
      })}</fieldset>
    </div>
  </div>
}
