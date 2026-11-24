import { useId, useRef, useState } from 'react'
import { positionMetadataPopup } from './metadataPopup'

export default function SampleTablePicker({ label, value, options, disabled, onSelect }: {
  label: string; value: string; options: { value: string; label: string; disabled?: boolean }[]
  disabled?: boolean; onSelect: (value: string) => void
}) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const selected = options.find((option) => option.value === value)
  return <div className="metadata-instance-select metadata-columns">
    <button type="button" ref={trigger} popoverTarget={id} disabled={disabled}
      aria-haspopup="dialog" aria-expanded={expanded}>
      {label}: {selected?.label}
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    <div id={id} ref={popupRef} className="metadata-columns-popup sample-table-picker" popover="auto"
      role="dialog" aria-label={label} onToggle={(event) => {
        const open = event.newState === 'open'
        setExpanded(open)
        if (!open || !trigger.current) return
        const popup = event.currentTarget
        positionMetadataPopup(popup, trigger.current)
        const choice = popup.querySelector<HTMLButtonElement>('[aria-pressed="true"]:not(:disabled)')
          ?? popup.querySelector<HTMLButtonElement>('button:not(:disabled)')
        choice?.focus()
      }}>
      {options.map((option) => <button key={option.value} type="button" disabled={option.disabled}
        aria-pressed={option.value === value} onClick={() => {
          popupRef.current?.hidePopover()
          onSelect(option.value)
          trigger.current?.focus()
        }}>{option.label}</button>)}
    </div>
  </div>
}
