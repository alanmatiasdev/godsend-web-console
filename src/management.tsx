import { useCallback, useEffect, useRef, useState } from 'react'
import {
  backupAllSaves, convertIso, copyFtp, copySave, deleteFtp, deleteSave, discoverSaves, downloadBrowserArchive, downloadBrowserFile, downloadSave,
  getContent, getFtpJobs, getServerPaths, getTitleUpdates, listFtp, listSaves, mkdirFtp, probeIso,
  queueContent, removeFtpJob, renameFtp, setTitleUpdateActive, uploadBrowserFiles, uploadFtp, uploadIso,
  deleteInstalledContent, discoverAuroraRoot, getAuroraCover, getDrives, loadAuroraLibrary, moveInstalledContent, moveXboxGame,
  type AuroraGame,
  type ContentItem, type ContentManifest, type FtpEntry, type FtpJob, type IsoInfo, type SaveEntry, type SaveProfile,
} from './api'
import { ArtworkDialog } from './artwork'
import { useI18n } from './i18n'

function errorText(error: unknown): string { return error instanceof Error ? error.message : 'Unknown error' }
function joinPath(path: string, name: string): string { return `${path.replace(/\/+$/, '')}/${name}`.replace(/\/+/g, '/') }
function validXboxDestination(value: string): boolean { return /^\/[A-Za-z0-9]+\/.+/.test(value) && !value.includes('\\') && value.split('/').every(part => part !== '.' && part !== '..') }
function bytes(value?: number): string {
  if (!value) return '—'
  const units = ['B', 'KB', 'MB', 'GB']; let n = value; let unit = 0
  while (n >= 1024 && unit < units.length - 1) { n /= 1024; unit += 1 }
  return `${n.toFixed(unit ? 1 : 0)} ${units[unit]}`
}

let activeCoverReads = 0
const waitingCoverReads: Array<() => void> = []
async function withCoverReadSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeCoverReads >= 3) await new Promise<void>(resolve => waitingCoverReads.push(resolve))
  activeCoverReads += 1
  try { return await work() }
  finally { activeCoverReads -= 1; waitingCoverReads.shift()?.() }
}

function LibraryCover({ xboxIp, root, game }: { xboxIp: string; root: string; game: AuroraGame }) {
  const element = useRef<HTMLSpanElement>(null)
  const [cover, setCover] = useState<string | null>(null)
  useEffect(() => {
    if (!root) return
    setCover(null)
    let active = true
    let started = false
    const load = () => {
      if (started) return
      started = true
      void withCoverReadSlot(() => active ? getAuroraCover(xboxIp, root, game) : Promise.resolve(null)).then(image => { if (active) setCover(image) }).catch(() => {})
    }
    if (!('IntersectionObserver' in window)) load()
    else {
      const observer = new IntersectionObserver(items => { if (items.some(item => item.isIntersecting)) { observer.disconnect(); load() } }, { rootMargin: '200px' })
      if (element.current) observer.observe(element.current)
      return () => { active = false; observer.disconnect() }
    }
    return () => { active = false }
  }, [xboxIp, root, game])
  return <span ref={element} className="game-cover-placeholder" aria-hidden="true">{cover ? <img src={cover} alt="" /> : game.name.slice(0, 1).toUpperCase()}</span>
}

export function XboxLibrary({ xboxIp, onOpenContent, onOpenSaves }: { xboxIp: string; onOpenContent: (game: AuroraGame) => void; onOpenSaves: (game: AuroraGame) => void }) {
  const { t } = useI18n()
  const [root, setRoot] = useState(() => { try { return localStorage.getItem('godsend.auroraRoot') || '' } catch { return '' } })
  const [rootInput, setRootInput] = useState(root || '/Hdd1/Aurora')
  const [games, setGames] = useState<AuroraGame[]>([])
  const [drives, setDrives] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'recent' | 'played'>('name')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [targetByGame, setTargetByGame] = useState<Record<number, string>>({})
  const [moving, setMoving] = useState<number | null>(null)
  const [artworkGame, setArtworkGame] = useState<AuroraGame | null>(null)

  const load = useCallback(async (requestedRoot = rootInput) => {
    if (!xboxIp) return
    setBusy(true); setError(''); setNotice('')
    try {
      let selectedRoot = requestedRoot.trim()
      if (!selectedRoot) selectedRoot = await discoverAuroraRoot(xboxIp)
      const [library, availableDrives] = await Promise.all([loadAuroraLibrary(xboxIp, selectedRoot), getDrives(xboxIp)])
      setRoot(selectedRoot); setRootInput(selectedRoot); setGames(library); setDrives(availableDrives)
      try { localStorage.setItem('godsend.auroraRoot', selectedRoot) } catch { /* Storage may be disabled. */ }
    } catch (cause) { setError(errorText(cause)) }
    finally { setBusy(false) }
  }, [rootInput, xboxIp])
  useEffect(() => { if (xboxIp) void load(root || '') }, [xboxIp]) // Load when this page first opens or when the console changes.

  const filtered = games.filter(game => (!favoritesOnly || game.isFavorite) && `${game.name} ${game.titleId} ${game.publisher}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).sort((a, b) => sortBy === 'recent' ? (b.lastPlayed || '').localeCompare(a.lastPlayed || '') || a.name.localeCompare(b.name) : sortBy === 'played' ? b.timesPlayed - a.timesPlayed || a.name.localeCompare(b.name) : a.name.localeCompare(b.name))
  async function move(game: AuroraGame) {
    const target = targetByGame[game.contentId]
    if (!target) return
    setMoving(game.contentId); setError(''); setNotice('')
    try { await moveXboxGame(xboxIp, game, target); setNotice(t('moveQueued', { game: game.name, drive: target })); setTargetByGame(current => ({ ...current, [game.contentId]: '' })) }
    catch (cause) { setError(errorText(cause)) }
    finally { setMoving(null) }
  }

  return <div className="page-content tool-page">
    <div className="page-intro"><span className="eyebrow">XBOX / AURORA</span><h1>{t('xboxLibraryTitle')}</h1><p>{t('xboxLibraryDescription')}</p></div>
    {!xboxIp ? <div className="empty-state panel-message"><p>{t('xboxRequired')}</p></div> : <>
      <section className="tool-panel library-controls"><label className="compact-field grow"><span>{t('auroraRoot')}</span><input value={rootInput} onChange={event => setRootInput(event.target.value)} placeholder="/Hdd1/Aurora" /></label><button className="button primary" disabled={busy} onClick={() => void load()}>{busy ? t('loadingLibrary') : t('refreshLibrary')}</button><label className="search-field library-search"><span aria-hidden="true">⌕</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder={t('searchGames')} aria-label={t('searchGames')} /></label><label className="compact-field library-sort"><span>{t('sortBy')}</span><select value={sortBy} onChange={event => setSortBy(event.target.value as 'name' | 'recent' | 'played')}><option value="name">{t('sortName')}</option><option value="recent">{t('sortRecent')}</option><option value="played">{t('sortMostPlayed')}</option></select></label><label className="check-field library-favorites"><input type="checkbox" checked={favoritesOnly} onChange={event => setFavoritesOnly(event.target.checked)} />{t('favoritesOnly')}</label><span className="result-count">{t('manyTitles', { count: filtered.length })}</span></section>
      {error && <p className="inline-error">{error}</p>}{notice && <p className="connection-message success">{notice}</p>}
      <section className="tool-panel library-list"><div className="library-list-head"><span>{t('game')}</span><span>{t('titleId')}</span><span>{t('drive')}</span><span>{t('move')}</span><span>{t('manage')}</span></div>
        {busy && games.length === 0 && <div className="empty-table">{t('loadingLibrary')}</div>}
        {!busy && !error && filtered.length === 0 && <div className="empty-table">{games.length ? t('noSearchMatches') : t('noAuroraGames')}</div>}
        {filtered.map(game => <article className="library-game" key={game.contentId}><div className="library-game-title"><LibraryCover xboxIp={xboxIp} root={root} game={game} /><div><strong>{game.name}{game.isFavorite ? ' ★' : ''}</strong><small>{[game.publisher, game.releaseDate, game.discsInSet > 1 ? `Disc ${game.discNum}/${game.discsInSet}` : ''].filter(Boolean).join(' · ')}</small></div></div><code>{game.titleId}</code><span>{game.sourceDrive || '—'}</span><div className="move-controls"><select aria-label={t('move')} value={targetByGame[game.contentId] || ''} disabled={!game.sourceDrive} onChange={event => setTargetByGame(current => ({ ...current, [game.contentId]: event.target.value }))}><option value="">{game.sourceDrive ? t('chooseDrive') : t('driveUnknown')}</option>{drives.filter(drive => drive.replace(/:$/, '') !== game.sourceDrive).map(drive => <option key={drive} value={drive}>{drive.replace(/:$/, '')}</option>)}</select><button className="button secondary" disabled={!targetByGame[game.contentId] || moving === game.contentId} onClick={() => void move(game)}>{moving === game.contentId ? '…' : t('move')}</button></div><div className="library-actions"><button className="button secondary" onClick={() => setArtworkGame(game)}>{t('artwork')}</button><button className="button secondary" onClick={() => onOpenContent(game)}>{t('content')}</button><button className="button secondary" onClick={() => onOpenSaves(game)}>{t('saves')}</button></div></article>)}
      </section>
      {artworkGame && <ArtworkDialog xboxIp={xboxIp} root={root} game={artworkGame} onClose={() => setArtworkGame(null)} />}
    </>}
  </div>
}

export function FtpManager({ xboxIp }: { xboxIp: string }) {
  const { t } = useI18n()
  const [cwd, setCwd] = useState('/')
  const [entries, setEntries] = useState<FtpEntry[]>([])
  const [jobs, setJobs] = useState<FtpJob[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [folderName, setFolderName] = useState('')
  const [serverPaths, setServerPaths] = useState('')
  const [uploadMessage, setUploadMessage] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null)
  const cwdRef = useRef(cwd)

  const load = useCallback(async (path?: string) => {
    if (!xboxIp) return
    const targetPath = path ?? cwdRef.current
    setBusy(true); setError('')
    try {
      const data = await listFtp(xboxIp, targetPath)
      setEntries(data.entries.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
      cwdRef.current = data.cwd; setCwd(data.cwd); setSelected([])
    } catch (cause) { setEntries([]); setError(errorText(cause)) }
    finally { setBusy(false) }
  }, [xboxIp])
  const loadJobs = useCallback(async () => { try { setJobs(await getFtpJobs()) } catch { /* Main panel shows API errors. */ } }, [])
  useEffect(() => { void load('/'); void loadJobs(); const id = window.setInterval(() => void loadJobs(), 2500); return () => clearInterval(id) }, [load, loadJobs])

  async function perform(action: () => Promise<void>, reload = true) {
    setBusy(true); setError('')
    try { await action(); if (reload) await load() }
    catch (cause) { setError(errorText(cause)) }
    finally { setBusy(false) }
  }
  function toggle(name: string) { setSelected(values => values.includes(name) ? values.filter(value => value !== name) : [...values, name]) }
  function navigate(entry: FtpEntry) { if (entry.type === 'dir') void load(joinPath(cwdRef.current, entry.name)) }
  function saveBrowserDownload(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = name
    document.body.append(link); link.click(); link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
  async function download(entry: FtpEntry) {
    setDownloading(entry.name); setDownloadProgress(null); setError('')
    try {
      const blob = await downloadBrowserFile(xboxIp, joinPath(cwdRef.current, entry.name), setDownloadProgress)
      saveBrowserDownload(blob, entry.name)
    } catch (cause) { setError(errorText(cause)) }
    finally { setDownloading(null); setDownloadProgress(null) }
  }
  async function downloadArchive(names: string[]) {
    setDownloading('archive'); setDownloadProgress(null); setError('')
    try {
      const blob = await downloadBrowserArchive(xboxIp, names.map(name => joinPath(cwdRef.current, name)))
      saveBrowserDownload(blob, names.length === 1 ? `${names[0]}.zip` : 'Xbox-files.zip')
    } catch (cause) { setError(errorText(cause)) }
    finally { setDownloading(null) }
  }
  const breadcrumbs = cwd.split('/').filter(Boolean)

  return <div className="page-content tool-page">
    <div className="page-intro"><span className="eyebrow">XBOX / FTP</span><h1>{t('ftpManagerTitle')}</h1><p>{t('ftpManagerDescription')}</p></div>
    {!xboxIp ? <div className="empty-state panel-message"><p>{t('xboxRequired')}</p></div> : <>
      <section className="tool-panel ftp-browser">
        <div className="tool-toolbar"><div className="breadcrumbs"><button onClick={() => void load('/')}>/</button>{breadcrumbs.map((part, index) => <button key={`${part}-${index}`} onClick={() => void load(`/${breadcrumbs.slice(0, index + 1).join('/')}`)}>/{part}</button>)}</div><button className="button secondary" disabled={busy} onClick={() => void load()}>{t('refresh')}</button></div>
        <div className="tool-actions"><label className="compact-field"><span>{t('folderName')}</span><input value={folderName} onChange={event => setFolderName(event.target.value)} /></label><button className="button secondary" disabled={!folderName.trim() || busy} onClick={() => void perform(async () => { await mkdirFtp(xboxIp, joinPath(cwd, folderName.trim())); setFolderName('') })}>{t('newFolder')}</button><label className="compact-field grow"><span>{t('serverPaths')}</span><input value={serverPaths} onChange={event => setServerPaths(event.target.value)} placeholder="/srv/godsend/Transfer/game.iso" /></label><button className="button secondary" disabled={!serverPaths.trim() || busy} onClick={() => void perform(async () => { await uploadFtp(xboxIp, serverPaths.split('\n').map(path => path.trim()).filter(Boolean), cwd); setServerPaths('') }, false)}>{t('upload')}</button><input ref={fileInput} className="visually-hidden" type="file" multiple onChange={event => { const files = Array.from(event.target.files || []); if (!files.length) return; setBusy(true); setError(''); setUploadMessage(t('uploadingFiles', { count: files.length })); void uploadBrowserFiles(xboxIp, cwd, files).then(() => { setUploadMessage(t('localUploadComplete', { count: files.length })); return load() }).catch(cause => setError(errorText(cause))).finally(() => { setBusy(false); event.target.value = '' }) }} /><button className="button primary" disabled={busy} onClick={() => fileInput.current?.click()}>{t('chooseLocalFiles')}</button></div>
        <p className="tool-hint">{t('serverPathsHint')}</p>
        {uploadMessage && <p className="connection-message success">{uploadMessage}</p>}
        {error && <p className="inline-error">{error}</p>}
        {selected.length > 0 && <div className="selection-bar"><span>{t('selectedItems', { count: selected.length })}</span><button className="text-button" disabled={downloading !== null} onClick={() => void downloadArchive(selected)}>{downloading === 'archive' ? t('preparingArchive') : t('downloadZip')}</button><button className="text-button" onClick={() => void perform(async () => { for (const name of selected) await deleteFtp(xboxIp, joinPath(cwd, name)) })}>{t('delete')}</button><button className="text-button" onClick={() => { const target = window.prompt(t('move')); if (target) void perform(async () => { for (const name of selected) await renameFtp(xboxIp, joinPath(cwd, name), joinPath(target, name)) }) }}>{t('move')}</button><button className="text-button" onClick={() => { const target = window.prompt(t('copy')); if (target) void perform(async () => { for (const name of selected) { const entry = entries.find(item => item.name === name); await copyFtp(xboxIp, joinPath(cwd, name), joinPath(target, name), entry?.type === 'dir') } }, false) }}>{t('copy')}</button></div>}
        <div className="file-table" role="table"><div className="file-row file-head" role="row"><span /><span>{t('name')}</span><span>{t('type')}</span><span>{t('size')}</span></div>{entries.map(entry => <div className="file-row" role="row" key={entry.name}><input type="checkbox" checked={selected.includes(entry.name)} onChange={() => toggle(entry.name)} aria-label={entry.name} /><div className="file-cell"><button className={entry.type === 'dir' ? 'file-name dir' : 'file-name'} onClick={() => navigate(entry)}>{entry.type === 'dir' ? '▸' : '·'} {entry.name}</button><button className="file-download" disabled={downloading !== null} title={entry.type === 'dir' ? t('downloadZip') : t('downloadToDevice')} aria-label={entry.type === 'dir' ? t('downloadFolder', { name: entry.name }) : t('downloadFile', { name: entry.name })} onClick={() => void (entry.type === 'dir' ? downloadArchive([entry.name]) : download(entry))}>{downloading === entry.name || (downloading === 'archive' && selected.length === 1 && selected[0] === entry.name) ? downloadProgress === null ? '…' : `${Math.round(downloadProgress * 100)}%` : '↓'}</button></div><span>{t(entry.type === 'dir' ? 'folder' : 'file')}</span><span>{bytes(entry.size)}</span></div>)}{!busy && entries.length === 0 && <div className="empty-table">{t('emptyDirectory')}</div>}</div>
      </section>
      <section className="tool-panel transfer-panel"><div className="section-heading"><div><span className="eyebrow">FTP</span><h2>{t('ftpTransfers')}</h2></div></div>{jobs.length === 0 ? <div className="empty-table">{t('noFtpTransfers')}</div> : jobs.map(job => <div className="transfer-row" key={job.id}><span className={`status-dot ${job.state === 'Ready' ? 'ready' : job.state === 'Error' ? 'error' : 'processing'}`} /><strong>{job.name}</strong><span>{job.state}{job.progress !== undefined ? ` · ${job.progress}%` : ''}</span>{['Ready', 'Error'].includes(job.state) && <button className="text-button" onClick={() => void removeFtpJob(job.id).then(loadJobs)}>{t('remove')}</button>}</div>)}</section>
    </>}
  </div>
}

function ContentRows({ items, title, drives, busy, onQueue, onToggle, onDelete, onMove }: { items: ContentItem[]; title: string; drives: string[]; busy: boolean; onQueue: (item: ContentItem) => void; onToggle?: (item: ContentItem) => void; onDelete: (item: ContentItem) => void; onMove: (item: ContentItem, drive: string) => void }) {
  const { t } = useI18n()
  const [targetByItem, setTargetByItem] = useState<Record<string, string>>({})
  return <section className="tool-panel content-panel"><div className="section-heading"><div><span className="eyebrow">CONTENT</span><h2>{title}</h2></div></div>{items.length === 0 ? <div className="empty-table">{t('noContent')}</div> : items.map(item => {
    const key = `${item.content_type}-${item.file_name}-${item.source}`
    const sourceDrive = item.drive?.replace(/:$/, '')
    return <div className="content-row" key={key}><div><strong>{item.display_name}</strong><small>{item.source}{item.version ? ` · v${item.version}` : ''}{item.size ? ` · ${bytes(item.size)}` : ''}{sourceDrive ? ` · ${sourceDrive}` : ''}</small></div><div className="content-actions">{item.installed && <span className="tag">{t('installed')}</span>}{item.active && <span className="tag ready-tag">{t('active')}</span>}{item.installed ? <>{onToggle && <button className="button secondary" disabled={busy} onClick={() => onToggle(item)}>{t(item.active ? 'deactivate' : 'activate')}</button>}<select aria-label={t('targetDriveFor', { name: item.display_name })} value={targetByItem[key] || ''} disabled={busy} onChange={event => setTargetByItem(current => ({ ...current, [key]: event.target.value }))}><option value="">{t('chooseDrive')}</option>{drives.filter(drive => drive.replace(/:$/, '').toLowerCase() !== sourceDrive?.toLowerCase()).map(drive => <option key={drive} value={drive}>{drive}</option>)}</select><button className="button secondary" disabled={busy || !targetByItem[key]} onClick={() => onMove(item, targetByItem[key])}>{t('move')}</button><button className="text-button destructive" disabled={busy} onClick={() => onDelete(item)}>{t('delete')}</button></> : <button className="button primary" disabled={busy} onClick={() => onQueue(item)}>{t('install')}</button>}</div></div>
  })}</section>
}

export function ContentManager({ xboxIp, drive, initialTitleId = '', initialGameName = '' }: { xboxIp: string; drive: string; initialTitleId?: string; initialGameName?: string }) {
  const { t } = useI18n(); const [titleId, setTitleId] = useState(initialTitleId); const [gameName, setGameName] = useState(initialGameName)
  const [manifest, setManifest] = useState<ContentManifest | null>(null); const [tus, setTus] = useState<ContentItem[]>([]); const [drives, setDrives] = useState<string[]>([]); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false)
  const [selectedDrive, setSelectedDrive] = useState(drive)
  useEffect(() => { if (xboxIp) void getDrives(xboxIp).then(setDrives).catch(() => setDrives([])) }, [xboxIp])
  useEffect(() => { setSelectedDrive(drive) }, [drive])
  async function load() { if (!titleId.trim()) return; setBusy(true); setError(''); try { const [content, updates] = await Promise.all([getContent(titleId.trim(), gameName.trim(), xboxIp, selectedDrive), getTitleUpdates(titleId.trim())]); setManifest(content); const installed = content.title_updates || []; const seen = new Set(installed.map(item => `${item.file_name}:${item.source}`)); setTus([...installed, ...updates.filter(item => !seen.has(`${item.file_name}:${item.source}`))]) } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) } }
  async function queue(item: ContentItem) { setBusy(true); setError(''); try { await queueContent(item, gameName.trim(), xboxIp, selectedDrive) } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) } }
  async function toggle(item: ContentItem) { setBusy(true); setError(''); try { await setTitleUpdateActive(item, xboxIp, item.drive || selectedDrive, !item.active); await load() } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) } }
  async function deleteItem(item: ContentItem) { if (!window.confirm(t('confirmDeleteContent', { name: item.display_name }))) return; setBusy(true); setError(''); setNotice(''); try { await deleteInstalledContent(item, xboxIp, selectedDrive); setNotice(t('contentDeleted', { name: item.display_name })); await load() } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) } }
  async function moveItem(item: ContentItem, target: string) { setBusy(true); setError(''); setNotice(''); try { await moveInstalledContent(item, xboxIp, selectedDrive, target); setNotice(t('contentMoved', { name: item.display_name, drive: target })); await load() } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) } }
  return <div className="page-content tool-page"><div className="page-intro"><span className="eyebrow">XBOX / CONTENT</span><h1>{t('contentTitle')}</h1><p>{t('contentDescription')}</p></div>{!xboxIp ? <div className="empty-state panel-message"><p>{t('xboxRequired')}</p></div> : <><section className="tool-panel query-panel"><div className="settings-form"><label className="field"><span>{t('gameName')}</span><input value={gameName} onChange={event => setGameName(event.target.value)} /></label><label className="field"><span>{t('titleId')}</span><input value={titleId} onChange={event => setTitleId(event.target.value.toUpperCase())} placeholder="4D5307E6" /></label><label className="field"><span>{t('drive')}</span><select value={selectedDrive} onChange={event => { setSelectedDrive(event.target.value); setManifest(null); setTus([]) }}>{[...new Set([selectedDrive, ...drives])].map(item => <option key={item} value={item}>{item}</option>)}</select></label><button className="button primary" disabled={!titleId.trim() || busy} onClick={() => void load()}>{t('loadContent')}</button></div>{error && <p className="inline-error">{error}</p>}{notice && <p className="connection-message success">{notice}</p>}</section>{manifest && <div className="stacked-panels"><ContentRows title={t('availableDlc')} items={manifest.dlcs || []} drives={drives} busy={busy} onQueue={item => void queue(item)} onDelete={item => void deleteItem(item)} onMove={(item, target) => void moveItem(item, target)} /><ContentRows title={t('titleUpdates')} items={tus} drives={drives} busy={busy} onQueue={item => void queue(item)} onToggle={item => void toggle(item)} onDelete={item => void deleteItem(item)} onMove={(item, target) => void moveItem(item, target)} /></div>}</>}</div>
}

export function SaveManager({ xboxIp, drive, initialTitleId = '' }: { xboxIp: string; drive: string; initialTitleId?: string }) {
  const { t } = useI18n(); const [titleId, setTitleId] = useState(initialTitleId); const [profiles, setProfiles] = useState<SaveProfile[]>([]); const [profile, setProfile] = useState<SaveProfile | null>(null); const [entries, setEntries] = useState<SaveEntry[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [targetProfile, setTargetProfile] = useState(''); const [useKeyVault, setUseKeyVault] = useState(false)
  async function discover() { setBusy(true); setError(''); try { const next = await discoverSaves(xboxIp, drive, titleId.trim()); setProfiles(next); setProfile(null); setEntries([]) } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) } }
  async function select(next: SaveProfile) { if (!titleId.trim()) return; setBusy(true); setError(''); try { setProfile(next); setEntries(await listSaves(xboxIp, drive, titleId.trim(), next.profile_id)) } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) } }
  async function action(work: () => Promise<void>) { setBusy(true); setError(''); try { await work() } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) } }
  return <div className="page-content tool-page"><div className="page-intro"><span className="eyebrow">XBOX / SAVES</span><h1>{t('savesTitle')}</h1><p>{t('savesDescription')}</p></div>{!xboxIp ? <div className="empty-state panel-message"><p>{t('xboxRequired')}</p></div> : <><section className="tool-panel query-panel"><div className="settings-form"><label className="field"><span>{t('titleId')}</span><input value={titleId} onChange={event => setTitleId(event.target.value.toUpperCase())} placeholder="4D5307E6" /></label><button className="button primary" disabled={busy} onClick={() => void discover()}>{t('discoverProfiles')}</button><button className="button secondary" disabled={busy} onClick={() => void action(() => backupAllSaves(xboxIp, drive))}>{t('backUpAll')}</button></div>{error && <p className="inline-error">{error}</p>}</section><div className="two-panel"><section className="tool-panel"><div className="section-heading"><div><span className="eyebrow">XBOX</span><h2>{t('profile')}</h2></div></div>{profiles.map(item => <button className={profile?.profile_id === item.profile_id ? 'profile-row selected' : 'profile-row'} key={item.profile_id} onClick={() => void select(item)}><strong>{item.profile_name || item.profile_id}</strong><small>{item.profile_id}{item.save_count !== undefined ? ` · ${item.save_count}` : ''}</small></button>)}</section><section className="tool-panel"><div className="section-heading"><div><span className="eyebrow">XBOX</span><h2>{t('saveFiles')}</h2></div>{profile && <button className="button secondary" disabled={busy} onClick={() => void action(() => downloadSave(xboxIp, drive, titleId, profile.profile_id, ''))}>{t('backUp')}</button>}</div>{!profile ? <div className="empty-table">{t('selectProfile')}</div> : entries.map(entry => <div className="save-row" key={entry.name}><strong>{entry.name}</strong><span>{bytes(entry.size)}</span></div>)}{profile && <div className="save-copy-controls"><label className="field"><span>{t('copyToProfile')}</span><select value={targetProfile} onChange={event => setTargetProfile(event.target.value)}><option value="">{t('chooseProfile')}</option>{profiles.filter(item => item.profile_id !== profile.profile_id).map(item => <option key={item.profile_id} value={item.profile_id}>{item.profile_name || item.profile_id}</option>)}</select></label><label className="check-field"><input type="checkbox" checked={useKeyVault} onChange={event => setUseKeyVault(event.target.checked)} />{t('useKeyVault')}</label><button className="button secondary" disabled={busy || !targetProfile || !entries.length} onClick={() => void action(() => copySave(xboxIp, drive, titleId, profile.profile_id, targetProfile, useKeyVault))}>{t('copy')}</button></div>}{profile && <button className="text-button destructive" disabled={busy} onClick={() => { if (window.confirm(t('delete'))) void action(() => deleteSave(xboxIp, drive, titleId, profile.profile_id).then(discover)) }}>{t('delete')}</button>}</section></div></>}</div>
}

export function IsoTools({ xboxIp, defaultDrive }: { xboxIp: string; defaultDrive: string }) {
  const { t } = useI18n(); const [isoPath, setIsoPath] = useState(''); const [outDir, setOutDir] = useState(''); const [info, setInfo] = useState<IsoInfo | null>(null); const [result, setResult] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [progress, setProgress] = useState<number | null>(null)
  const [sendAfterConversion, setSendAfterConversion] = useState(false)
  const [xboxDestination, setXboxDestination] = useState('')
  async function probe() { setBusy(true); setError(''); setResult(''); try { setInfo(await probeIso(isoPath.trim())) } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) } }
  async function convert(format: 'god' | 'xex') {
    setBusy(true); setError(''); setResult('')
    try {
      const data = await convertIso(format, isoPath.trim(), outDir.trim())
      setResult(t('conversionComplete', { path: data.outputDir }))
      if (sendAfterConversion) {
        await uploadFtp(xboxIp, [data.outputDir], xboxDestination.trim())
        setResult(t('conversionAndTransferQueued', { path: data.outputDir }))
      }
    } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }
  async function selectLocalIso(file: File) {
    setBusy(true); setError(''); setResult(''); setProgress(0); setInfo(null)
    try {
      const paths = await getServerPaths()
      const files = await uploadIso(file, setProgress)
      if (!files[0]?.name) throw new Error('The server did not return the uploaded ISO name.')
      const separator = paths.transfer_dir.includes('\\') ? '\\' : '/'
      setIsoPath(`${paths.transfer_dir.replace(/[\\/]$/, '')}${separator}${files[0].name}`)
      setOutDir(current => current || paths.ready_dir)
      setResult(t('isoReadyForTools', { name: files[0].name }))
    } catch (cause) { setError(errorText(cause)) }
    finally { setBusy(false); setProgress(null) }
  }
  const canConvert = Boolean(isoPath.trim() && outDir.trim() && !busy && (!sendAfterConversion || (xboxIp && validXboxDestination(xboxDestination.trim()))))
  return <div className="page-content tool-page"><div className="page-intro"><span className="eyebrow">SERVER / ISO</span><h1>{t('isoToolsTitle')}</h1><p>{t('isoToolsDescription')}</p></div><section className="tool-panel"><div className="iso-picker"><label className="button secondary"><input className="visually-hidden" type="file" accept=".iso" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void selectLocalIso(file) }} />{t('chooseIsoFiles')}</label>{progress !== null && <><progress value={progress} max={1} aria-label={t('uploadingIso', { percent: Math.round(progress * 100) })} /><span>{t('uploadingIso', { percent: Math.round(progress * 100) })}</span></>}</div><div className="settings-form iso-form"><label className="field"><span>{t('isoPath')}</span><input value={isoPath} onChange={event => setIsoPath(event.target.value)} placeholder="/srv/godsend/Transfer/game.iso" /></label><label className="field"><span>{t('outputDirectory')}</span><input value={outDir} onChange={event => setOutDir(event.target.value)} placeholder="/srv/godsend/Ready" /></label><label className="check-field iso-auto-ftp"><input type="checkbox" checked={sendAfterConversion} disabled={!xboxIp || busy} onChange={event => setSendAfterConversion(event.target.checked)} />{t('sendAfterConversion')}</label>{sendAfterConversion && <label className="field iso-ftp-destination"><span>{t('xboxTransferFolder')}</span><input value={xboxDestination} disabled={busy} onChange={event => setXboxDestination(event.target.value)} placeholder={`/${defaultDrive.replace(/:$/, '')}/Games`} /><small>{t('xboxTransferFolderHint')}</small></label>}<button className="button secondary" disabled={!isoPath.trim() || busy} onClick={() => void probe()}>{t('probe')}</button><button className="button primary" disabled={!canConvert} onClick={() => void convert('god')}>{t('convertToGod')}</button><button className="button primary" disabled={!canConvert} onClick={() => void convert('xex')}>{t('extractToXex')}</button></div>{error && <p className="inline-error">{error}</p>}{result && <p className="connection-message success">{result}</p>}{info && <div className="disc-info"><span className="eyebrow">{t('discInfo')}</span><strong>{info.displayName}</strong><span>{t('titleId')}: {info.titleId} · Media ID: {info.mediaId}</span><small>{t('disc', { number: info.discNumber, count: info.discCount })}{info.isOriginalXbox ? ' · Original Xbox' : ''}</small></div>}</section></div>
}
