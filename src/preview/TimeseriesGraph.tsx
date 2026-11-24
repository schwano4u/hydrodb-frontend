import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { isSafeNumber } from 'lossless-json'
import SampleChart from '../SampleChart'
import { timestampMicros } from '../sampleViewer'
import type { SampleDefinition, ScientificSample } from '../sampleViewer'

interface Snapshot { captured: string; readings: [string, number][] }
interface DwdSnapshot {
  captured: string
  version: string
  unitVersion: string
  readings: {
    timestamp: string; period_start: string; period_end: string; value: string | null
    state: 'valid' | 'missing'; revision: string; seriesVersion: string
    qualityCode: number; codebookId: string; codebookVersion: string; qualityMeaning?: string
  }[]
}
const snapshot: Snapshot = JSON.parse(document.getElementById('snapshot')!.textContent!)
const seriesId = 'pegelonline:0d8233b8-36c9-4a24-ad77-a4e7c617932f:W'
const definition: SampleDefinition = {
  seriesId, name: 'Helgoland Südhafen', unitLabel: 'cm', level: 'raw', sampling: 'equidistant',
  statistic: 'instantaneous', interval: 'PT1M', intervalMicros: 60_000_000n,
  axes: [{ axis: 'Value', meaning: 'Water level' }], support: null, calendar: null, policy: null,
  version: '', unitId: '', unitVersion: '',
}
const samples: ScientificSample[] = snapshot.readings.map(([timestamp, value]) => ({
  timestamp, micros: timestampMicros(timestamp), value, definition, state: 'valid',
  detectionBound: null, revision: '', seriesVersion: '', qualityCode: 0, codebookId: '', codebookVersion: '',
  source: null, scientificContext: null, aggregate: {},
}))
const start = new Date(samples[0]!.timestamp).toISOString()
const last = new Date(samples.at(-1)!.timestamp).toISOString()
const end = new Date(Date.parse(last) + 60_000).toISOString()
const data = { query: { start, end, asOf: '' }, samples, chartDefinition: definition }

const dwd: DwdSnapshot = JSON.parse(document.getElementById('dwd-snapshot')!.textContent!)
const dwdDefinition: SampleDefinition = {
  seriesId: 'dwd:00259:1_minute/precipitation:RS_01', name: 'DWD 1-minute observation', unitLabel: 'kg/m²',
  unitId: 'kg/m2', unitVersion: dwd.unitVersion, version: dwd.version, level: 'raw',
  sampling: 'equidistant', statistic: 'total', position: 'end', interval: 'PT60S', intervalMicros: 60_000_000n,
  axes: [{ axis: 'Value', meaning: 'Precipitation amount' }], support: { kind: 'per_sample' }, calendar: null, policy: null,
}
const dwdSamples: ScientificSample[] = dwd.readings.map((row) => ({
  timestamp: row.timestamp, micros: timestampMicros(row.timestamp),
  value: row.value !== null && isSafeNumber(row.value, { approx: false }) ? Number(row.value) : row.value,
  state: row.state,
  period: { start: row.period_start, end: row.period_end,
    startMicros: timestampMicros(row.period_start), endMicros: timestampMicros(row.period_end) },
  revision: row.revision, seriesVersion: row.seriesVersion, qualityCode: row.qualityCode,
  codebookId: row.codebookId, codebookVersion: row.codebookVersion, qualityMeaning: row.qualityMeaning,
  definition: dwdDefinition, detectionBound: null, source: null, scientificContext: null, aggregate: {},
}))
const dwdStart = dwd.readings[0]!.period_start
const dwdEnd = dwd.readings.at(-1)!.period_end
const dwdData = { query: { start: dwdStart, end: dwdEnd, asOf: '' }, samples: dwdSamples, chartDefinition: dwdDefinition }

const fiveMinuteDefinition: SampleDefinition = {
  ...dwdDefinition, seriesId: 'preview:dwd:00259:5-minute-total', name: '5-minute total (derived in preview)',
  version: '', level: 'aggregated', interval: 'PT5M', intervalMicros: 300_000_000n,
  support: { kind: 'fixed', duration: 'PT5M', method: { kind: 'sum' } },
}
const minute = 60_000
const byPeriodStart = new Map(dwd.readings.map((row) => [Date.parse(row.period_start), row]))
const fiveMinuteSamples: ScientificSample[] = []
for (let start = Math.ceil(Date.parse(dwdStart) / (5 * minute)) * 5 * minute;
  start + 5 * minute <= Date.parse(dwdEnd); start += 5 * minute) {
  let hundredths = 0n
  let usable = 0
  for (let offset = 0; offset < 5; offset++) {
    const minuteStart = start + offset * minute
    const row = byPeriodStart.get(minuteStart)
    if (!row || row.state !== 'valid' || row.value === null || Date.parse(row.period_end) !== minuteStart + minute) continue
    const decimal = /^(\d+)(?:\.(\d{1,2}))?$/.exec(row.value)
    if (!decimal) throw new Error('DWD preview totals require non-negative observations expressed in hundredths of kg/m².')
    hundredths += BigInt(decimal[1]!) * 100n + BigInt((decimal[2] ?? '').padEnd(2, '0'))
    usable++
  }
  if (usable !== 5) continue
  const exact = `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`
  const periodStart = new Date(start).toISOString()
  const end = new Date(start + 5 * minute).toISOString()
  fiveMinuteSamples.push({
    timestamp: end, micros: timestampMicros(end), definition: fiveMinuteDefinition, state: 'valid',
    value: isSafeNumber(exact, { approx: false }) ? Number(exact) : exact, detectionBound: null,
    period: { start: periodStart, end, startMicros: timestampMicros(periodStart), endMicros: timestampMicros(end) },
    revision: '', seriesVersion: '', qualityCode: 0, codebookId: '', codebookVersion: '',
    source: null, scientificContext: null, aggregate: { usable_count: usable, expected_count: 5 },
  })
}
const dwdOverlays = fiveMinuteSamples.length
  ? [dwdData, { ...dwdData, samples: fiveMinuteSamples, chartDefinition: fiveMinuteDefinition }]
  : undefined

export default function Preview() {
  const [rain, setRain] = useState(false)
  return <article className="metadata-panel sample-viewer-chart">
    <header>
      <div className="preview-heading">
        <h1>{rain ? 'DWD station 00259 — precipitation' : 'Helgoland Südhafen — water level'}</h1>
        <label>Dataset{' '}
          <select value={rain ? 'dwd' : 'pegelonline'} onChange={(event) => setRain(event.target.value === 'dwd')}>
            <option value="pegelonline">PEGELONLINE — instantaneous water level</option>
            <option value="dwd">DWD — one-minute precipitation totals</option>
          </select>
        </label>
      </div>
      <p><code>{rain ? dwdDefinition.seriesId : seriesId}</code></p>
      {rain
        ? <p>{dwdSamples.length.toLocaleString('en')} raw readings · {dwdStart} to {dwdEnd} (UTC) · Equidistant, 1 min · Total, period-end timestamp</p>
        : <p>{samples.length.toLocaleString('en')} raw readings · {start} to {last} (UTC)</p>}
    </header>
    <figure className="sample-figure" aria-labelledby="preview-legend">
      <figcaption id="preview-legend"><span className="sample-legend-key" aria-hidden="true" />
        {rain ? 'Precipitation amount (kg/m²)' : 'Water level (W)'}</figcaption>
      <SampleChart key={rain ? 'dwd' : 'pegelonline'} data={rain ? dwdData : data}
        overlays={rain ? dwdOverlays : undefined} providerSnapshot={!rain} />
    </figure>
    {rain ? <footer>Offline snapshot captured {dwd.captured}. Source:{' '}
      <a href="https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/1_minute/precipitation/">Deutscher Wetterdienst (DWD), Climate Data Center</a> ·{' '}
      <a href="https://www.dwd.de/DE/leistungen/cdc/climate-data-center.html">GeoNutzV</a>.
      Extract formatted by HydroDB, with values expressed in kg/m² instead of mm.{' '}
      {!dwd.version && 'Provider extract: no HydroDB revision metadata. '}
      {fiveMinuteSamples.length} derived 5-minute totals on UTC clock boundaries, each from five complete 1-minute observations.
      Incomplete windows are omitted, not filled.</footer>
      : <footer>Offline snapshot captured {snapshot.captured}. Source: <a href="https://www.pegelonline.wsv.de/">WSV PEGELONLINE</a> ·{' '}
        <a href="https://www.govdata.de/dl-de/zero-2-0">Data licence Germany — Zero 2.0</a>.
        Raw provider readings do not include HydroDB quality or revision metadata.</footer>}
  </article>
}

createRoot(document.getElementById('preview')!).render(<Preview />)
