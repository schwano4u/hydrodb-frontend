import { useId, useRef } from 'react'
import type { KeyboardEvent, Ref } from 'react'

export type MenuItem = { label: string; action?: () => void; checked?: boolean; disabled?: boolean } | { separator: true }

function Menu({ title, items, disabled = false }: { title: string; items: MenuItem[]; disabled?: boolean }) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const last = useRef(false)

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    const menu = popup.current
    if (!menu) return
    const controls = Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    const visible = menu.matches(':popover-open')
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const triggers = Array.from(event.currentTarget.closest('[role="menubar"]')!
        .querySelectorAll<HTMLButtonElement>('button[data-menu-trigger]:not(:disabled)'))
      const index = triggers.indexOf(trigger.current!)
      const next = triggers[(index + (event.key === 'ArrowRight' ? 1 : triggers.length - 1)) % triggers.length]
      if (visible) menu.hidePopover()
      next?.focus()
      if (visible) next?.click()
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      if (!visible) {
        last.current = event.key === 'ArrowUp' || event.key === 'End'
        menu.showPopover({ source: trigger.current! })
      } else {
        const index = controls.findIndex((control) => control === document.activeElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : controls.length - 1)) % controls.length
        controls[next]?.focus()
      }
    } else if (event.key === 'Tab' && visible) {
      menu.hidePopover()
    }
  }

  return <div className="application-menu-entry" onKeyDown={keyboard}>
    <button type="button" role="menuitem" data-menu-trigger aria-haspopup="menu" disabled={disabled}
      popoverTarget={id} ref={trigger}>
      {title}{title === 'View' && <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>}
    </button>
    <div id={id} role="menu" aria-label={title} className="menu-popup" popover="auto" ref={popup} tabIndex={-1}
      onToggle={(event) => {
        if (event.newState !== 'open') return
        const menu = event.currentTarget
        const bounds = trigger.current!.getBoundingClientRect()
        menu.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - menu.offsetWidth - 8))}px`
        menu.style.top = `${bounds.bottom + 4}px`
        menu.style.maxHeight = `${Math.max(80, window.innerHeight - bounds.bottom - 12)}px`
        const controls = menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
        ;(controls[last.current ? controls.length - 1 : 0] ?? menu).focus()
        last.current = false
      }}>
      {items.map((item, index) => 'separator' in item ? <hr key={index} role="separator" /> :
        <button key={item.label} type="button" role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
          aria-checked={item.checked} disabled={item.disabled} onClick={() => {
            popup.current?.hidePopover()
            item.action?.()
          }}>
          <span className="menu-check" aria-hidden="true">{item.checked &&
            <svg viewBox="0 0 16 16"><path d="m3 8 3 3 7-7" /></svg>}</span>
          {item.label}
        </button>)}
    </div>
  </div>
}

export function WorkspaceMenus({ items = [], onHealth, healthOpen = false }: {
  items?: MenuItem[]; onHealth?: () => void; healthOpen?: boolean
}) {
  return <>
    <Menu title="View" items={items} disabled={!items.length} />
    <Menu title="Tools" disabled={!onHealth} items={[{ label: 'Health', checked: healthOpen, action: onHealth }]} />
  </>
}

export default function ApplicationMenu({ viewHost }: { viewHost: Ref<HTMLDivElement> }) {
  return <nav className="application-menu" role="menubar" aria-label="Application menu">
    {['File', 'Edit'].map((title) => <Menu key={title} title={title} items={[{ label: `${title} commands are not available yet.`, disabled: true }]} />)}
    <div className="workspace-menus" ref={viewHost} />
    <Menu title="Help" items={[{ label: 'Help commands are not available yet.', disabled: true }]} />
  </nav>
}
