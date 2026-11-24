import CheckboxSelector from './components/CheckboxSelector'

export default function ColumnVisibility(props: {
  columns: readonly { id: string; label: string; required?: boolean }[]
  visible: readonly string[]
  toggle: (column: string, checked: boolean) => void
}) {
  return <CheckboxSelector label="Columns" legend="Visible columns" choices={props.columns}
    selected={props.visible} toggle={props.toggle} />
}
