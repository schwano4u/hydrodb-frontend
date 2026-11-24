import { useRef, useState } from 'react'
import IconButton from './components/IconButton'
import { downloadBlob } from './downloadBlob'
import SelectionActionBar from './components/SelectionActionBar'
import DownloadIcon from './DownloadIcon'
import { seriesSelectionLimit } from './sampleViewer'

const series = [
  { id: 'WL-01', name: 'Alder Reach', level: 2.4 },
  { id: 'WL-02', name: 'Birch Island', level: 1.7 },
  { id: 'WL-03', name: 'Cedar Reach', level: 2.9 },
]

export default function SelectionActionBarDemo() {
  const [selected, setSelected] = useState([series[0]!.id])
  const chart = useRef<HTMLDialogElement>(null)
  const firstCheckbox = useRef<HTMLInputElement>(null)
  const selections = series.filter(({ id }) => selected.includes(id))

  function downloadSamples() {
    const csv = ['series_id,station,water_level_m', ...selections.map(({ id, name, level }) => `${id},${name},${level}`)].join('\r\n')
    downloadBlob(new Blob([csv], { type: 'text/csv' }), 'hydrodb-fixture-samples.csv')
  }

  return <div className="components-demo-selection">
    <fieldset>
      <legend>Water level series</legend>
      {series.map(({ id, name }, index) => <label className="metadata-choice" key={id}>
        <input type="checkbox" ref={index === 0 ? firstCheckbox : undefined} checked={selected.includes(id)}
          onChange={(event) => {
            const checked = event.target.checked
            setSelected((current) => checked ? [...current, id] : current.filter((value) => value !== id))
          }} />
        {name}
      </label>)}
    </fieldset>
    {selections.length > 0 && <SelectionActionBar selections={selections} limit={seriesSelectionLimit}
      onOpen={() => chart.current?.showModal()}
      onClear={() => { setSelected([]); firstCheckbox.current?.focus() }}
      onRemove={(id) => {
        setSelected((current) => current.filter((value) => value !== id))
        if (selected.length === 1) requestAnimationFrame(() => firstCheckbox.current?.focus())
      }}
      downloadAction={<IconButton label="Download samples" onClick={downloadSamples}><DownloadIcon /></IconButton>} />}
    <dialog ref={chart} className="components-demo-selection-chart" aria-labelledby="selection-chart-title">
      <h3 id="selection-chart-title">Selected water levels</h3>
      {selections.map(({ id, name, level }) => <div key={id}>
        <label htmlFor={`level-${id}`}>{name} · {level} m</label>
        <meter id={`level-${id}`} min={0} max={4} value={level} />
      </div>)}
      <form method="dialog"><button type="submit">Close</button></form>
    </dialog>
  </div>
}
