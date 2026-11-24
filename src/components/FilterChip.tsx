export default function FilterChip({ label, removeLabel, onRemove }: {
  label: string
  removeLabel: string
  onRemove: () => void
}) {
  return <span className="metadata-filter-chip">
    <span title={label}>{label}</span>
    <button type="button" aria-label={removeLabel} onClick={onRemove}>
      <span aria-hidden="true">&times;</span>
    </button>
  </span>
}
