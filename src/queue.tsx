import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { HttpError, getDrives, getSchedulerState, schedulerAction, uploadIso, type InstallType, type QueueItem, type SchedulerAction, type SchedulerState } from './api'
import { useI18n, type Translate, type TranslationKey } from './i18n'

const sourceKeys = { local: 'sourceLocal', minerva: 'sourceMinerva', ia: 'sourceIa', rom: 'sourceRom' } as const satisfies Record<string, TranslationKey>
const installTypes: InstallType[] = ['god', 'content', 'xex']

function errorText(error: unknown): string { return error instanceof Error ? error.message : 'Unknown error' }

// Whether the install format applies: only disc-based Xbox platforms offer more than GOD.
function hasFormats(item: QueueItem): boolean { return item.source === 'local' || ['xbox360', 'xbox', 'games'].includes(item.platform) }

export type Scheduler = {
  // null while the first request is pending; false when this GODsend build has no scheduler.
  available: boolean | null
  state: SchedulerState
  error: string
  refresh: () => Promise<void>
  act: (action: SchedulerAction) => Promise<SchedulerState | null>
}

const emptyState: SchedulerState = { paused: false, maxConcurrent: 1, wishlist: [], pending: [] }

export function useScheduler(serverUrl: string): Scheduler {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [state, setState] = useState<SchedulerState>(emptyState)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try { setState(await getSchedulerState()); setAvailable(true); setError('') }
    catch (cause) {
      if (cause instanceof HttpError && (cause.status === 404 || cause.status === 405)) { setAvailable(false); setState(emptyState) }
      else setError(errorText(cause))
    }
  }, [])
  const act = useCallback(async (action: SchedulerAction) => {
    try { const next = await schedulerAction(action); setState(next); setAvailable(true); setError(''); return next }
    catch (cause) { setError(errorText(cause)); return null }
  }, [])

  useEffect(() => { void refresh() }, [serverUrl, refresh])
  useEffect(() => { const id = window.setInterval(() => void refresh(), 5000); return () => clearInterval(id) }, [refresh])
  return { available, state, error, refresh, act }
}

function Unavailable() {
  const { t } = useI18n()
  return <div className="empty-state panel-message"><p>{t('queueSchedulerUnavailable')}</p></div>
}

// A destructive bulk action asks for a second click instead of a modal.
function ConfirmButton({ label, onConfirm, disabled }: { label: string; onConfirm: () => void; disabled?: boolean }) {
  const { t } = useI18n()
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const id = window.setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(id)
  }, [armed])
  return <button className={armed ? 'button danger' : 'button secondary'} disabled={disabled} onClick={() => { if (armed) { setArmed(false); onConfirm() } else setArmed(true) }}>{armed ? t('confirmAgain') : label}</button>
}

function entryMeta(item: QueueItem, t: Translate): string {
  const source = t(sourceKeys[item.source as keyof typeof sourceKeys] ?? 'sourceLocal')
  return [source, t('entryDestination', { drive: item.drive, format: item.installType.toUpperCase() }), item.ip].join(' · ')
}

export function WaitingQueue({ scheduler, runningJobs }: { scheduler: Scheduler; runningJobs: number }) {
  const { t } = useI18n()
  const { state, act } = scheduler
  if (scheduler.available === false) return <section className="tool-panel"><Unavailable /></section>
  return <section className="tool-panel queue-panel">
    <div className="section-heading"><div><span className="eyebrow">{state.paused ? t('queuePaused') : t('queueActive')}</span><h2>{t('queueWaiting')}</h2></div></div>
    <p className="tool-hint">{t('queueWaitingHint')}</p>
    <div className="queue-controls">
      <button className={state.paused ? 'button primary' : 'button secondary'} onClick={() => void act({ action: state.paused ? 'resume' : 'pause' })}>{state.paused ? `▶ ${t('resumeQueue')}` : `❚❚ ${t('pauseQueue')}`}</button>
      <label className="compact-field"><span>{t('simultaneousJobs')}</span><select value={state.maxConcurrent} onChange={event => void act({ action: 'set_max', value: Number(event.target.value) })}>{[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      <span className="queue-count">{runningJobs > 0 ? `${runningJobs} · ${t('runningJobs')}` : ''}</span>
      <button className="button secondary" onClick={() => void act({ action: 'clear_finished' })}>{t('clearFinished')}</button>
      <ConfirmButton label={t('clearWaiting')} disabled={state.pending.length === 0} onConfirm={() => void act({ action: 'clear_pending' })} />
    </div>
    {scheduler.error && <p className="inline-error">{t('queueAction', { error: scheduler.error })}</p>}
    {state.pending.length === 0
      ? <div className="empty-jobs"><span className="empty-mark">○</span><p>{t('waitingEmpty')}</p><small>{t('waitingEmptyHint')}</small></div>
      : state.pending.map((item, index) => <article className="content-row queue-row" key={item.id}>
        <div>
          <strong><span className="queue-position">{String(index + 1).padStart(2, '0')}</span>{item.game}</strong>
          <small>{entryMeta(item, t)}</small>
          {item.error ? <small className="queue-error">{t('itemFailed', { error: item.error })}</small> : <span className={item.held ? 'tag' : 'tag ready-tag'}>{item.held ? t('itemHeld') : t('itemWaiting')}</span>}
        </div>
        <div className="content-actions">
          <button className="icon-button" aria-label={`${t('moveUp')}: ${item.game}`} title={t('moveUp')} disabled={index === 0} onClick={() => void act({ action: 'move', id: item.id, direction: 'up' })}>↑</button>
          <button className="icon-button" aria-label={`${t('moveDown')}: ${item.game}`} title={t('moveDown')} disabled={index === state.pending.length - 1} onClick={() => void act({ action: 'move', id: item.id, direction: 'down' })}>↓</button>
          <button className="button secondary" onClick={() => void act({ action: 'start', id: item.id })}>{t('startNow')}</button>
          <button className="button secondary" onClick={() => void act({ action: item.held ? 'unhold' : 'hold', id: item.id })}>{item.held ? t('releaseItem') : t('holdItem')}</button>
          <button className="text-button" onClick={() => void act({ action: 'to_wishlist', id: item.id })}>{t('moveToWishlist')}</button>
          <button className="text-button" onClick={() => void act({ action: 'remove', id: item.id })}>{t('remove')}</button>
        </div>
      </article>)}
  </section>
}

export function Wishlist({ scheduler, xboxIp }: { scheduler: Scheduler; xboxIp: string }) {
  const { t } = useI18n()
  const { state, act } = scheduler
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [drives, setDrives] = useState<string[]>([])
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    if (xboxIp) getDrives(xboxIp).then(found => { if (active) setDrives(found) }).catch(() => {})
    return () => { active = false }
  }, [xboxIp])
  // Drop selections for entries that no longer exist.
  useEffect(() => { setSelected(current => { const ids = new Set(state.wishlist.map(item => item.id)); const kept = new Set([...current].filter(id => ids.has(id))); return kept.size === current.size ? current : kept }) }, [state.wishlist])

  async function send(ids?: string[]) {
    setNotice('')
    const before = state.wishlist.length
    const next = await act({ action: 'wishlist_send', ids })
    if (!next) return
    const skipped = next.skipped ?? []
    const sent = before - next.wishlist.length
    setNotice([sent > 0 ? t('wishlistSent', { count: sent }) : '', skipped.length ? t('wishlistSkipped', { count: skipped.length, games: skipped.join(', ') }) : ''].filter(Boolean).join(' '))
    setSelected(new Set())
  }
  function toggle(id: string) {
    setSelected(current => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next })
  }

  const allSelected = state.wishlist.length > 0 && selected.size === state.wishlist.length
  const body: ReactNode = scheduler.available === false ? <Unavailable /> : <>
    <div className="tool-actions wishlist-actions">
      <label className="check-field"><input type="checkbox" checked={allSelected} disabled={state.wishlist.length === 0} onChange={() => setSelected(allSelected ? new Set() : new Set(state.wishlist.map(item => item.id)))} />{t('selectAll')}</label>
      <button className="button primary" disabled={selected.size === 0} onClick={() => void send([...selected])}>{t('sendSelectedToQueue')}{selected.size > 0 && ` (${selected.size})`}</button>
      <button className="button secondary" disabled={state.wishlist.length === 0} onClick={() => void send()}>{t('sendAllToQueue')}</button>
      <ConfirmButton label={t('clearList')} disabled={state.wishlist.length === 0} onConfirm={() => void act({ action: 'wishlist_clear' })} />
    </div>
    {scheduler.error && <p className="inline-error">{t('queueAction', { error: scheduler.error })}</p>}
    {notice && <p className="connection-message success">{notice}</p>}
    {state.wishlist.length === 0
      ? <div className="empty-jobs"><span className="empty-mark">○</span><p>{t('wishlistEmpty')}</p><small>{t('wishlistEmptyHint')}</small></div>
      : state.wishlist.map(item => <article className="content-row queue-row" key={item.id}>
        <label className="check-field wishlist-check"><input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} aria-label={t('selectEntry', { game: item.game })} />
          <span className="wishlist-title"><strong>{item.game}</strong><small>{t(sourceKeys[item.source as keyof typeof sourceKeys] ?? 'sourceLocal')} · {item.ip}</small></span></label>
        <div className="content-actions">
          <select aria-label={t('destinationDrive')} value={item.drive} onChange={event => void act({ action: 'wishlist_update', id: item.id, drive: event.target.value })}>{[...new Set([item.drive, ...drives])].map(drive => <option key={drive} value={drive}>{drive}</option>)}</select>
          {hasFormats(item) && <select aria-label={t('installFormat')} value={item.installType} onChange={event => void act({ action: 'wishlist_update', id: item.id, installType: event.target.value as InstallType })}>{installTypes.map(type => <option key={type} value={type}>{type.toUpperCase()}</option>)}</select>}
          <button className="text-button" onClick={() => void act({ action: 'wishlist_remove', id: item.id })}>{t('remove')}</button>
        </div>
      </article>)}
  </>
  return <div className="page-content tool-page">
    <div className="page-intro"><span className="eyebrow">{t('wishlist').toUpperCase()}</span><h1>{t('wishlistTitle')}</h1><p>{t('wishlistDescription')}</p></div>
    <section className="tool-panel">{body}</section>
  </div>
}

type UploadRow = { id: number; name: string; progress: number; status: 'uploading' | 'done' | 'error' | 'cancelled'; error?: string }

export function IsoUpload({ onUploaded }: { onUploaded: () => void }) {
  const { t } = useI18n()
  const [rows, setRows] = useState<UploadRow[]>([])
  const [busy, setBusy] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])

  function update(id: number, patch: Partial<UploadRow>) { setRows(current => current.map(row => row.id === id ? { ...row, ...patch } : row)) }

  async function start(files: File[]) {
    const abort = new AbortController()
    controller.current = abort
    const base = Date.now()
    const queue = files.map((file, index) => ({ file, id: base + index }))
    setBusy(true)
    setRows(queue.map(({ file, id }) => ({ id, name: file.name, progress: 0, status: file.name.toLowerCase().endsWith('.iso') ? 'uploading' : 'error', error: file.name.toLowerCase().endsWith('.iso') ? undefined : t('isoOnlyIso') })))
    for (const { file, id } of queue) {
      if (!file.name.toLowerCase().endsWith('.iso')) continue
      if (abort.signal.aborted) { update(id, { status: 'cancelled' }); continue }
      try {
        await uploadIso(file, progress => update(id, { progress }), abort.signal)
        update(id, { status: 'done', progress: 1 })
        onUploaded()
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') update(id, { status: 'cancelled' })
        else update(id, { status: 'error', error: errorText(cause) })
      }
    }
    setBusy(false)
  }

  return <div className="upload-panel">
    <div className="upload-head">
      <label className={busy ? 'button secondary disabled' : 'button secondary'}><input className="visually-hidden" type="file" accept=".iso" multiple disabled={busy} onChange={event => { const files = [...(event.target.files ?? [])]; event.target.value = ''; if (files.length) void start(files) }} />{t('uploadIso')}: {t('chooseIsoFiles')}</label>
      {busy && <button className="text-button" onClick={() => controller.current?.abort()}>{t('cancelUpload')}</button>}
      <small>{t('uploadIsoHint')}</small>
    </div>
    {rows.map(row => <div className="upload-row" key={row.id}>
      <span className="upload-name">{row.name}</span>
      {row.status === 'uploading' && <><progress max={1} value={row.progress} aria-label={row.name} /><span>{t('uploadingIso', { percent: Math.round(row.progress * 100) })}</span></>}
      {row.status === 'done' && <span className="upload-ok">{t('isoUploaded')}</span>}
      {row.status === 'cancelled' && <span>{t('uploadCancelled')}</span>}
      {row.status === 'error' && <span className="inline-error">{row.error}</span>}
    </div>)}
  </div>
}
