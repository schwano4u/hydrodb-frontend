import { useId, useRef, useState } from 'react'
import IconButton from './components/IconButton'
import SettingsIcon from './components/SettingsIcon'
import { entities } from './metadata'
import type { Collection } from './metadata'
import { positionMetadataPopup } from './metadataPopup'
import type { TreeNaming } from './useMetadataSelection'

const treeCollections: Collection[] = ['stations', 'sampling_positions', 'instruments', 'instrument_deployments', 'parameter_groups', 'parameters', 'series']

export default function TreeNamingSettings({ settings, change }: { settings: TreeNaming; change: (settings: TreeNaming) => void }) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const [expanded, setExpanded] = useState(false)
  return <div>
    <IconButton ref={trigger} popoverTarget={id} label="Tree naming settings" aria-haspopup="dialog" aria-expanded={expanded}>
      <SettingsIcon />
    </IconButton>
    <div id={id} className="metadata-columns-popup metadata-tree-settings" popover="auto" role="dialog" aria-label="Tree naming settings"
      onToggle={(event) => {
        setExpanded(event.newState === 'open')
        if (event.newState !== 'open') return
        positionMetadataPopup(event.currentTarget, trigger.current!)
        event.currentTarget.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus()
      }}>
      <fieldset><legend>Tree instance labels</legend>{treeCollections.map((collection) => {
        const selected = settings[collection] ?? ['name']
        return <fieldset key={collection}><legend>{entities[collection].title}</legend>
          <div className="metadata-tree-options">{(['name', 'id'] as const).map((field) =>
            <label key={field} className="metadata-choice"><input type="checkbox"
              aria-label={`${entities[collection].title} ${field === 'name' ? 'Name' : 'ID'}`}
              checked={selected.includes(field)} disabled={selected.length === 1 && selected.includes(field)}
              onChange={(event) => change({ ...settings, [collection]: event.target.checked
                ? [...selected, field] : selected.filter((value) => value !== field) })} />
              {field === 'name' ? 'Name' : 'ID'}
            </label>)}</div>
        </fieldset>
      })}</fieldset>
    </div>
  </div>
}
