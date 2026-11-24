export default function SearchField({ label, value, onChange, maxLength, className }: {
  label: string
  value: string
  onChange: (value: string) => void
  maxLength?: number
  className?: string
}) {
  return <input className={className ? `search-field ${className}` : 'search-field'}
    type="search" aria-label={label} placeholder={label} maxLength={maxLength}
    value={value} onChange={(event) => onChange(event.target.value)} />
}
