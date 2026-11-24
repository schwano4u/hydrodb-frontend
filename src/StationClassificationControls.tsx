import { useEffect, useEffectEvent, useId, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from './api'
import type { Choice, Filter, MetadataClient } from './metadata'
import { attributeLabels, classificationParameterChoices, readClassificationChoices } from './stationClassification'
import type { Assignment, Attribute, Band, Classification, ClassificationChoice, Mode } from './stationClassification'
import { stationPinCenter, stationPinPath, stationPinViewBox } from './stationPinIcon'

type CatalogRead = { client: MetadataClient; cutoff?: string; onExpired: () => void } |
  { catalogChoices: Record<'parameters' | 'units', ClassificationChoice[]> }

function useClassificationCatalog(catalog: CatalogRead, collection: 'parameters' | 'units', enabled: boolean) {
  const { client, cutoff, onExpired } = 'client' in catalog ? catalog : {}
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ cutoff: string; attempt: number; choices?: ClassificationChoice[]; error?: string }>()
  const expired = useEffectEvent(() => onExpired?.())
  const current = result?.cutoff === cutoff && result?.attempt === attempt ? result : undefined
  useEffect(() => {
    if (!client || !cutoff || !enabled) return
    const controller = new AbortController()
    void readClassificationChoices(client, collection, cutoff, controller.signal).then((choices) => {
      if (!controller.signal.aborted) setResult({ cutoff, attempt, choices })
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) { client.clear(); expired() }
      setResult({ cutoff, attempt, error: failure instanceof ApiError ? failure.message : `Could not load ${collection}.` })
    })
    return () => controller.abort()
  }, [client, collection, cutoff, attempt, enabled])
  const choices = 'catalogChoices' in catalog ? catalog.catalogChoices[collection] : undefined
  return { choices: choices ?? current?.choices ?? [], error: current?.error, loading: !choices && !current, retry: () => setAttempt((n) => n + 1) }
}

function CatalogSelector({ field, choices, selected, onChange, hint, error, retry }: {
  field: 'parameter' | 'unit'; choices: Choice[]; selected: string; onChange: (value: string) => void
  hint: string; error?: string; retry: () => void
}) {
  const label = field === 'parameter' ? 'Parameter' : 'Common unit'
  const id = useId()
  return <>
    <label htmlFor={id}>{label}</label>
    <select id={id} name={field} required value={choices.some(({ value }) => value === selected) ? selected : ''}
      disabled={!choices.length} onChange={(event) => onChange(event.target.value)}>
      <option value="">{hint}</option>
      {choices.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
    </select>
    {error && <div role="alert">{error} <button type="button" onClick={retry}>
      Retry loading {field === 'parameter' ? 'parameters' : 'units'}
    </button></div>}
  </>
}

export default function StationClassificationControls({ disabled, config, apply, legend, changeBand, hiddenClasses, toggleClass, reference, error: readError, retry, filters, ...catalog }: CatalogRead & {
  disabled: boolean; config: Classification; apply: (next: Classification) => void
  filters: readonly Filter[]
  legend: (Assignment & { count: number })[]; changeBand: (key: string, band: Band) => void
  hiddenClasses: ReadonlySet<string>; toggleClass: (key: string, visible: boolean) => void
  reference: number; error?: string; retry?: () => void
}) {
  const [mode, setMode] = useState<Mode>('off')
  const [error, setError] = useState('')
  const [draftParameter, setDraftParameter] = useState('')
  const [unitOverride, setUnitOverride] = useState<{ parameter: string; unit: string }>()
  const [settingsOpen, setSettingsOpen] = useState(true)
  const modeId = useId()
  const settingsId = useId()
  const sampleMode = mode === 'timestamp' || mode === 'value'
  const parameters = useClassificationCatalog(catalog, 'parameters', sampleMode)
  const { choices: parameterChoices, preset } = classificationParameterChoices(parameters.choices, filters)
  const parameter = preset || draftParameter
  const unitPolicy = parameterChoices.find(({ value }) => value === parameter)?.units
  const units = useClassificationCatalog(catalog, 'units', mode === 'value' && !!unitPolicy)
  const unitChoices = units.choices.filter(({ value }) => unitPolicy?.allowed.includes(value))
  const selectedUnit = unitOverride?.parameter === parameter && unitChoices.some(({ value }) => value === unitOverride.unit)
    ? unitOverride.unit : unitPolicy?.canonical ?? ''
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const text = (key: string) => String(form.get(key) ?? '').trim()
    try {
      if (mode === 'off') apply({ mode })
      else if (mode === 'attribute') apply({ mode, attribute: text('attribute') === 'station_owner' ? 'station_owner' : 'station_provider' })
      else {
        const breaks = text('breaks').split(',').map((part) => part.trim() ? Number(part) : NaN)
        if (breaks.length > 7 || breaks.some((edge, index) => !Number.isFinite(edge) ||
          (mode === 'timestamp' && edge <= 0) || (index > 0 && edge <= breaks[index - 1]!))) {
          throw new Error('Enter one to seven increasing breakpoints; age thresholds must be positive.')
        }
        const parameter = text('parameter')
        if (!parameter) throw new Error('Select a parameter.')
        const source = { parameter, level: text('level'), showValues: form.has('show-values') }
        if (mode === 'timestamp') apply({ ...source, mode, breaks })
        else {
          const freshness = text('freshness')
          if (freshness !== '1' && freshness !== '3' && freshness !== '7' && freshness !== 'off') throw new Error('Select a freshness limit.')
          const unit = text('unit')
          const unitChoice = unitChoices.find(({ value }) => value === unit)
          if (!unitChoice) throw new Error('Select a common unit.')
          apply({ ...source, mode, breaks, freshness, unit, unitLabel: unitChoice.symbol ?? unitChoice.label })
        }
      }
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Invalid classification settings.')
    }
  }
  return <details className="station-classification" hidden={disabled}>
    <summary>{config.mode === 'off' ? 'Classify stations' : 'Classify stations (active)'}</summary>
    <button type="button" className="station-classification-settings-toggle" aria-expanded={settingsOpen}
      aria-controls={settingsId} onClick={() => setSettingsOpen((open) => !open)}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>
      Setting
    </button>
    <form id={settingsId} hidden={!settingsOpen} onSubmit={submit}>
      <label htmlFor={modeId}>Mode</label>
      <select id={modeId} value={mode} onChange={(event) => {
        const value = event.target.value
        if (value === 'off' || value === 'attribute' || value === 'timestamp' || value === 'value') setMode(value)
        setError('')
      }}>
        <option value="off">Off</option><option value="attribute">Attribute</option>
        <option value="timestamp">Latest timestamp</option><option value="value">Latest value</option>
      </select>
      {mode === 'attribute' && <label>Station attribute <select name="attribute"
        defaultValue={config.mode === 'attribute' ? config.attribute : 'station_provider'}>
        {(Object.keys(attributeLabels) as Attribute[]).map((field) => <option key={field} value={field}>{attributeLabels[field]}</option>)}
      </select></label>}
      {sampleMode && <>
        <CatalogSelector {...parameters} field="parameter" choices={parameterChoices} selected={parameter}
          hint={parameters.error ? 'Could not load parameters' : parameters.loading ? 'Loading parameters…'
            : parameterChoices.length ? 'Select a parameter' : 'No active parameters match'}
          onChange={(value) => { setDraftParameter(value); setUnitOverride(undefined) }} />
        <label>Processing level <select name="level" defaultValue={'level' in config ? config.level : 'raw'}>
          <option value="raw">Raw</option><option value="validated">Validated</option>
          <option value="calculated">Calculated</option><option value="aggregated">Aggregated</option>
        </select></label>
        <label key={mode}>{mode === 'timestamp' ? 'Age thresholds (hours)' : 'Value breakpoints'}
          <input name="breaks" className="station-classification-breaks"
            required defaultValue={config.mode === mode ? config.breaks.join(', ') : mode === 'timestamp' ? '1, 24' : '0, 1'} />
        </label>
      </>}
      {mode === 'value' && <>
        <label>Not older than <select name="freshness" defaultValue={config.mode === 'value' ? config.freshness : 'off'}>
          <option value="1">1 day</option><option value="3">3 days</option><option value="7">7 days</option><option value="off">Off</option>
        </select></label>
        <CatalogSelector {...units} field="unit" choices={unitChoices} selected={selectedUnit}
          hint={!unitPolicy ? 'Select a parameter first' : units.error ? 'Could not load units' : units.loading ? 'Loading units…'
            : unitChoices.length ? 'Select a unit' : 'No allowed units available'}
          onChange={(unit) => setUnitOverride({ parameter, unit })} />
      </>}
      {sampleMode && <label key={`show-values:${mode}`} className="station-classification-marker-option">
        <input type="checkbox" name="show-values" defaultChecked={(config.mode === 'timestamp' || config.mode === 'value') &&
          config.mode === mode && config.showValues} />
        Show values on map
      </label>}
      <button type="submit" className="station-classification-apply">Apply</button>
      {error && <p role="alert">{error}</p>}
    </form>
    {config.mode !== 'off' && <section aria-label="Station classification legend">
      <strong>Classification legend</strong>
      {config.mode === 'timestamp' && !!reference && <p>Age at {new Date(reference).toISOString()}</p>}
      {readError && <p role="alert">{readError}</p>}
      {retry && <button type="button" onClick={retry}>Retry classification</button>}
      <table className="station-classification-legend">
        <thead><tr><th scope="col" aria-label="Show on map" /><th scope="col" aria-label="Map pin" /><th scope="col">Range</th>
          <th scope="col" className="station-classification-count">#Stations</th></tr></thead>
        <tbody>{legend.map(({ key, label, color, count, editable, boundary }) => <tr key={key}>
        <td><input className="station-classification-visibility" type="checkbox" aria-label={`Show ${label} on map`}
          checked={!hiddenClasses.has(key)} onChange={(event) => toggleClass(key, event.target.checked)} /></td>
        <td><span className="station-classification-pin">
          {editable && <input type="color" aria-label={`Color for ${label}`} title={`Color for ${label}`} value={color}
            onChange={(event) => changeBand(key, { label, color: event.target.value })} />}
          <svg className="station-pin-icon" viewBox={stationPinViewBox} aria-hidden="true" style={{ fill: color }}>
            <path d={stationPinPath} /><circle {...stationPinCenter} />
          </svg>
        </span></td>
        <td>{editable && <input className="station-classification-label" key={label} aria-label={`Label for ${boundary}`} defaultValue={label} onBlur={(event) => {
          const text = event.target.value.trim()
          if (text) changeBand(key, { color, label: text })
          else event.target.value = label
        }} />}
        {(!editable || label !== boundary) && <span>{boundary}</span>}</td>
        <td className="station-classification-count">{count}</td>
      </tr>)}</tbody></table>
    </section>}
  </details>
}
