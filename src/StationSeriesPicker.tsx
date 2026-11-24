import { useEffect, useId, useRef, useState } from 'react'
import { seriesSelectionLimit } from './sampleViewer'
import type { SelectedSeries } from './metadata'

export default function StationSeriesPicker({ station, series, onClose, onOpen }: {
  station: string; series: SelectedSeries[]; onClose: () => void; onOpen: (series: SelectedSeries[]) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const [selected, setSelected] = useState<string[]>([])
  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
  }, [])
  return <dialog ref={dialog} className="station-series-picker" aria-labelledby={heading} onClose={onClose}>
    <h2 id={heading}>Choose time series for {station}</h2>
    <p>{series.length} readable series. Choose up to {seriesSelectionLimit}.</p>
    <form onSubmit={(event) => {
      event.preventDefault()
      if (!selected.length) return
      dialog.current?.close()
      onOpen(series.filter(({ id }) => selected.includes(id)))
    }}>
      <fieldset>
        <legend>Time series</legend>
        {series.map(({ id, name }) => <label key={id} className="metadata-choice">
          <input type="checkbox" checked={selected.includes(id)}
            disabled={!selected.includes(id) && selected.length >= seriesSelectionLimit}
            onChange={(event) => {
              const checked = event.target.checked
              setSelected((current) => checked ? [...current, id] : current.filter((value) => value !== id))
            }} />
          {name === id ? id : `${name} / ${id}`}
        </label>)}
      </fieldset>
      <div className="station-series-picker-actions">
        <button type="button" onClick={() => dialog.current?.close()}>Cancel</button>
        <button type="submit" disabled={!selected.length}>Open time series graph</button>
      </div>
    </form>
  </dialog>
}
