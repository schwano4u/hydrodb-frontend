import { useState } from 'react'
import SessionPanel from './SessionPanel'
import ApplicationMenu from './ApplicationMenu'
import SettingsIcon from './components/SettingsIcon'
import './App.css'

export default function App() {
  const [identityHost, setIdentityHost] = useState<HTMLDivElement | null>(null)
  const [menuHost, setMenuHost] = useState<HTMLDivElement | null>(null)
  return (
    <div className="application">
      <header className="header">
        <div className="brand">
          <svg viewBox="0 0 32 32" aria-hidden="true" className="brand-mark">
            <path d="M3 11c5-6 8 6 13 0s8 6 13 0M3 21c5-6 8 6 13 0s8 6 13 0" />
          </svg>
          <h1>Next-generation HydroDB Demonstrator</h1>
        </div>
        <div className="header-actions">
          <button type="button" className="header-icon" aria-label="Settings" aria-haspopup="dialog" popoverTarget="header-settings">
            <SettingsIcon />
          </button>
          <div ref={setIdentityHost} />
        </div>
          <section id="header-settings" className="header-popover" popover="auto"
            role="dialog" aria-labelledby="header-settings-title"
            onToggle={(event) => {
              if (event.newState !== 'open') return
              const popup = event.currentTarget
              const bottom = popup.closest('header')!.getBoundingClientRect().bottom
              popup.style.top = `${bottom + 12}px`
              popup.style.maxHeight = `${Math.max(80, window.innerHeight - bottom - 24)}px`
              popup.querySelector('button')?.focus()
            }}>
            <h3 id="header-settings-title">Settings</h3>
            <p className="scope-note">Application settings will be available here. No settings can be changed yet.</p>
            <button type="button" popoverTarget="header-settings" popoverTargetAction="hide">Close settings</button>
          </section>
      </header>
      <ApplicationMenu viewHost={setMenuHost} />
      <main>
        <SessionPanel identityHost={identityHost} menuHost={menuHost} />
      </main>
    </div>
  )
}
