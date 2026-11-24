import { useId, useState } from 'react'
import type { ReactNode } from 'react'

export default function FilterAttributeHelp({ children, label = 'Filter attribute help' }: { children: ReactNode; label?: string }) {
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  return <>
    <div className="metadata-filter-label">
      {children}
      <button type="button" className="metadata-help" aria-label={label}
        aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded((current) => !current)}>
        <span aria-hidden="true">?</span>
      </button>
    </div>
    <p id={id} hidden={!expanded}>
      Values within an attribute match any selection. Different attributes must all match one declared metadata path.
      Select up to 12 attributes and 20 values per attribute.
    </p>
  </>
}
