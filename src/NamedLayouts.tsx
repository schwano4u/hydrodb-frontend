import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Menu } from './ApplicationMenu'
import { ApiError, deleteNamedLayout, listNamedLayouts, readNamedLayout, writeNamedLayout } from './api'
import type { LayoutScope, NamedLayout } from './api'

export default function NamedLayouts({ csrfToken, onExpired, capture, apply }: {
  csrfToken: string; onExpired: () => void; capture: () => unknown; apply: (snapshot: unknown) => void
}) {
  const [catalog, setCatalog] = useState<{ items: NamedLayout[]; canPublish: boolean }>()
  const [manage, setManage] = useState(false)
  const [save, setSave] = useState<{ snapshot: unknown }>()
  const [action, setAction] = useState<{ kind: 'Rename' | 'Replace' | 'Delete'; item: NamedLayout }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = useRef<AbortController | null>(null)
  const listing = useRef<AbortController | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const editing = manage || !!save
  useEffect(() => () => { active.current?.abort(); listing.current?.abort() }, [])
  useEffect(() => {
    if (editing) dialog.current?.showModal()
  }, [editing])

  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return
    listing.current?.abort()
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    setError('')
    try {
      await work(controller.signal)
    } catch (failure) {
      if (!controller.signal.aborted) {
        if (failure instanceof ApiError && failure.status === 401) onExpired()
        else setError(failure instanceof Error ? failure.message : 'The layout operation failed.')
      }

    } finally {
      active.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  async function refresh() {
    if (active.current) return
    listing.current?.abort()
    const controller = new AbortController()
    listing.current = controller
    setError('')
    try {
      setCatalog(await listNamedLayouts(controller.signal))
    } catch (failure) {
      if (!controller.signal.aborted) {
        if (failure instanceof ApiError && failure.status === 401) onExpired()
        else setError(failure instanceof Error ? failure.message : 'Saved layouts could not be listed.')
      }
    }
  }

  function close() {
    setManage(false)
    setSave(undefined)
    setAction(undefined)
    setError('')
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const name = String(fields.get('name') ?? '')
    void run(async (signal) => {
      const scope: LayoutScope = fields.get('scope') === 'public' ? 'public' : 'private'
      if (save) await writeNamedLayout({ name, scope, snapshot: save.snapshot }, csrfToken, signal)
      else if (action?.kind === 'Delete') await deleteNamedLayout(action.item.id, csrfToken, signal)
      else if (action?.kind === 'Rename') await writeNamedLayout({ id: action.item.id, name }, csrfToken, signal)
      else if (action?.kind === 'Replace') await writeNamedLayout({ id: action.item.id, snapshot: capture() }, csrfToken, signal)
      dialog.current?.close()
      setCatalog(await listNamedLayouts(signal))
    })
  }

  const groups = (['private', 'public'] as const).map((scope) => {
    const items = (catalog?.items ?? []).filter((item) => item.scope === scope)
    return { heading: scope === 'private' ? 'Private' : 'Public', items: items.length ? items.map((item) => ({
      label: item.name, disabled: busy, action: () => void run(async (signal) => apply(await readNamedLayout(item.id, signal))),
    })) : [{ label: catalog ? 'No saved layouts' : 'Layouts not loaded', disabled: true }] }
  })
  const writable = catalog?.items.filter(({ scope }) => scope === 'private' || catalog.canPublish) ?? []
  return <>
    <Menu title="Layout" onOpen={() => void refresh()} items={[
      { label: 'Save current layout', disabled: busy, action: () => {
        try { setError(''); setSave({ snapshot: capture() }) }
        catch (failure) { setError(failure instanceof Error ? failure.message : 'The current layout could not be captured.') }
      } },
      ...groups,
      { separator: true },
      { label: 'Manage saved layouts', disabled: busy || !writable.length, action: () => { setError(''); setManage(true) } },
    ]} />
    {!editing && error && <p className="layout-operation-error" role="alert">{error}</p>}
    {editing && <dialog ref={dialog} aria-labelledby={titleId} className="sample-chart-settings layout-dialog"
      onCancel={(event) => { if (busy) event.preventDefault() }} onClose={close}>
      <form onSubmit={submit}>
        <h2 id={titleId}>{save ? 'Save current layout' : action ? `${action.kind} layout` : 'Manage saved layouts'}</h2>
        {save && <>
          <label>Layout name <input name="name" required maxLength={80} autoFocus /></label>
          <label>Visibility <select name="scope" defaultValue="private">
            <option value="private">Private</option>
            <option value="public" disabled={!catalog?.canPublish}>Public</option>
          </select></label>
        </>}
        {manage && !action && <ul>{writable.map((item) => <li key={item.id}>
          <strong>{item.name}</strong> ({item.scope === 'private' ? 'Private' : 'Public'})
          <div className="layout-actions">{(['Rename', 'Replace', 'Delete'] as const).map((kind) =>
            <button key={kind} type="button" onClick={() => { setError(''); setAction({ kind, item }) }}>{kind}</button>)}</div>
        </li>)}</ul>}
        {action?.kind === 'Rename' && <label>Layout name <input name="name" defaultValue={action.item.name} required maxLength={80} /></label>}
        {action?.kind === 'Replace' && <p>Replace “{action.item.name}” with the current panel arrangement?</p>}
        {action?.kind === 'Delete' && <p>Delete “{action.item.name}”? This does not change the current workspace.</p>}
        {error && <p role="alert">{error}</p>}
        <div className="sample-chart-settings-actions">
          <button type="button" disabled={busy} onClick={() => action ? setAction(undefined) : dialog.current?.close()}>
            {manage && !action ? 'Close' : 'Cancel'}
          </button>
          {(save || action) && <button type="submit" disabled={busy}>{save ? 'Save layout' : action?.kind}</button>}
        </div>
      </form>
    </dialog>}
  </>
}
