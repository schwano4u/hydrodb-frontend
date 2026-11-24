import { useEffect, useEffectEvent, useState } from 'react'
import ReloadIcon from './ReloadIcon'
import IconButton from './components/IconButton'

export default function TableRefresh({ label, updatedAt, onRefresh, onAutoRefresh, type, disabled, busy, paused }: {
  label: string; updatedAt?: string; disabled?: boolean; busy?: boolean; paused?: boolean
} & ({ type?: 'button'; onRefresh: () => void; onAutoRefresh?: () => void } |
  { type: 'submit'; onRefresh?: never; onAutoRefresh: () => void })) {
  const [seconds, setSeconds] = useState(0)
  const [manual, setManual] = useState(0)
  const tick = useEffectEvent(() => (onAutoRefresh ?? onRefresh)?.())
  useEffect(() => {
    if (!seconds || disabled || busy || paused) return
    const timer = window.setInterval(() => tick(), seconds * 1000)
    return () => window.clearInterval(timer)
  }, [seconds, disabled, busy, paused, manual])

  return <div className="metadata-refresh-group" data-reloading={!!busy}>
    {updatedAt && <small>Last updated <time dateTime={updatedAt}>{updatedAt}</time></small>}
    <IconButton label={label} onClick={() => {
      setManual((revision) => revision + 1)
      onRefresh?.()
    }} type={type} disabled={disabled || busy}>
      <ReloadIcon />
    </IconButton>
    <select aria-label="Auto reload" title="Auto reload" value={seconds}
      onChange={(event) => setSeconds(Number(event.target.value))}>
      <option value="0">Off</option>
      <option value="15">15 seconds</option>
      <option value="30">30 seconds</option>
      <option value="60">1 minute</option>
      <option value="300">5 minutes</option>
    </select>
    <span className="metadata-refresh-status" role="status">{busy ? 'Reloading' : ''}</span>
  </div>
}
