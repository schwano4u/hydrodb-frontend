import { useState } from 'react'
import type { CSSProperties } from 'react'
import { decodeNode, identity, name } from './metadata'
import type { MapStation } from './metadataMap'
import StationClassificationControls from './StationClassificationControls'
import { assignStation, classificationClasses } from './stationClassification'
import type { Band, Classification, ClassificationChoice, Summary } from './stationClassification'
import { stationPinCenter, stationPinPath, stationPinTitle, stationPinViewBox } from './stationPinIcon'

const reference = Date.parse('2026-11-24T18:30:00Z')
const catalogChoices: Record<'parameters' | 'units', ClassificationChoice[]> = {
  parameters: [{ value: 'stage', label: 'Water level', units: { canonical: 'm', allowed: ['m'] } }],
  units: [{ value: 'm', label: 'Metre', symbol: 'm' }],
}
const fixtures: { station: MapStation; summary: Summary }[] = [
  { id: 'ST-001', stationName: 'Alder Reach', provider: 'DWD', owner: 'Example weather service',
    timestamp: '2026-11-24T18:00:00Z', value: 0.6 },
  { id: 'ST-002', stationName: 'Birch Island', provider: 'WSV', owner: 'Example waterways office',
    timestamp: '2026-11-24T12:00:00Z', value: 1.4 },
  { id: 'ST-003', stationName: 'Cedar Reach' },
].map(({ id, stationName, provider, owner, timestamp, value }) => ({
  station: { node: decodeNode({
    collection: 'stations', status: 'active', references: [], position_scope: 'current_only',
    item: { station_id: id, station_name: stationName, station_metadata_version: '1',
      station_validity_start: '2026-11-20T00:00:00Z', station_provider: provider ?? null, station_owner: owner ?? null },
  }), point: [0, 0] },
  summary: timestamp ? { status: 'sample', series: `demo:${id}:water-level`, timestamp, value, unit: 'm' } : { status: 'no_series' },
}))

export default function StationClassificationDemo() {
  const [config, setConfig] = useState<Classification>({ mode: 'off' })
  const [bands, setBands] = useState<ReadonlyMap<string, Band>>(new Map())
  const [hiddenClasses, setHiddenClasses] = useState<ReadonlySet<string>>(new Set())
  const markers = fixtures.map(({ station, summary }) => ({
    station,
    assignment: assignStation(config, station, 'level' in config && config.level === 'raw' ? summary : { status: 'no_series' },
      reference, bands, false),
  }))
  const categories = config.mode === 'attribute' ? [...new Set(fixtures.flatMap(({ station }) => {
    const value = station.node.item[config.attribute]
    return typeof value === 'string' ? [value] : []
  }))] : []
  const legend = classificationClasses(config, categories, bands).map((entry) => ({
    ...entry, count: markers.filter(({ assignment }) => assignment?.key === entry.key).length,
  }))

  return <>
    <StationClassificationControls catalogChoices={catalogChoices} disabled={false} filters={[]} config={config}
      apply={(next) => {
        if (next.mode !== config.mode || (next.mode === 'attribute' && config.mode === 'attribute' && next.attribute !== config.attribute)) {
          setHiddenClasses(new Set())
        }
        setConfig(next)
      }}
      legend={legend} reference={reference} hiddenClasses={hiddenClasses}
      changeBand={(key, band) => setBands((current) => new Map(current).set(key, band))}
      toggleClass={(key, visible) => setHiddenClasses((current) => {
        const next = new Set(current)
        if (visible) next.delete(key)
        else next.add(key)
        return next
      })} />
    <ul className="components-demo-station-pins" aria-label="Fixture station pins">
      {markers.map(({ station: { node }, assignment }) => {
        const id = identity(node)
        const stationName = name(node)
        if (assignment && hiddenClasses.has(assignment.key)) return null
        const value = assignment?.markerValue
        return <li key={id}>
          <span className={`station-map-marker${value === undefined ? '' : ' has-value'}`}
            style={{ '--station-pin-color': assignment?.color } as CSSProperties}
            title={stationPinTitle(stationName, id, assignment?.label, assignment?.mouseover)}>
            <svg className="station-pin-icon" viewBox={stationPinViewBox} aria-hidden="true">
              <path d={stationPinPath} /><circle {...stationPinCenter} />
            </svg>
            {value !== undefined && <span className="station-map-marker-value">{value}</span>}
          </span>
          {stationName}{assignment && ` — ${assignment.label}`}
        </li>
      })}
    </ul>
  </>
}
