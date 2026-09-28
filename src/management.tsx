import { useCallback, useEffect, useRef, useState } from 'react'
import {
  backupAllSaves, convertIso, copyFtp, copySave, deleteFtp, deleteSave, discoverSaves, downloadSave,
  getContent, getFtpJobs, getTitleUpdates, listFtp, listSaves, mkdirFtp, probeIso,
  queueContent, removeFtpJob, renameFtp, setTitleUpdateActive, uploadBrowserFiles, uploadFtp,
  discoverAuroraRoot, getDrives, loadAuroraLibrary, moveXboxGame,
  type AuroraGame,
  type ContentItem, type ContentManifest, type FtpEntry, type FtpJob, type IsoInfo, type SaveEntry, type SaveProfile,
} from './api'
import { useI18n } from './i18n'

function errorText(error: unknown): string { return error instanceof Error ? error.message : 'Unknown error' }
function joinPath(path: string, name: string): string { return `${path.replace(/\/+$/, '')}/${name}`.replace(/\/+/g, '/') }
function bytes(value?: number): string {
  if (!value) return '—'
  const units = ['B', 'KB', 'MB', 'GB']; let n = value; let unit = 0
  while (n >= 1024 && unit < units.length - 1) { n /= 1024; unit += 1 }
  return `${n.toFixed(unit ? 1 : 0)} ${units[unit]}`
}

export function XboxLibrary({ xboxIp }: { xboxIp: string }) {
  const { t } = useI18n()
  const [root, setRoot] = useState(() => { try { return localStorage.getItem('godsend.auroraRoot') || '' } catch { return '' } })
  const [rootInput, setRootInput] = useState(root || '/Hdd1/Aurora')
  const [games, setGames] = useState<AuroraGame[]>([])
  const [drives, setDrives] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [targetByGame, setTargetByGame] = useState<Record<number, string>>({})
  const [moving, setMoving] = useState<number | null>(null)

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

  const filtered = games.filter(game => `${game.name} ${game.titleId} ${game.publisher}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
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
      <section className="tool-panel library-controls"><label className="compact-field grow"><span>{t('auroraRoot')}</span><input value={rootInput} onChange={event => setRootInput(event.target.value)} placeholder="/Hdd1/Aurora" /></label><button className="button primary" disabled={busy} onClick={() => void load()}>{busy ? t('loadingLibrary') : t('refreshLibrary')}</button><label className="search-field library-search"><span aria-hidden="true">⌕</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder={t('searchGames')} aria-label={t('searchGames')} /></label><span className="result-count">{t('manyTitles', { count: filtered.length })}</span></section>
      {error && <p className="inline-error">{error}</p>}{notice && <p className="connection-message success">{notice}</p>}
      <section className="tool-panel library-list"><div className="library-list-head"><span>{t('game')}</span><span>{t('titleId')}</span><span>{t('drive')}</span><span>{t('move')}</span></div>
        {busy && games.length === 0 && <div className="empty-table">{t('loadingLibrary')}</div>}
        {!busy && !error && filtered.length === 0 && <div className="empty-table">{games.length ? t('noSearchMatches') : t('noAuroraGames')}</div>}
        {filtered.map(game => <article className="library-game" key={game.contentId}><div className="library-game-title"><span className="game-cover-placeholder">{game.name.slice(0, 1).toUpperCase()}</span><div><strong>{game.name}{game.isFavorite ? ' ★' : ''}</strong><small>{[game.publisher, game.releaseDate, game.discsInSet > 1 ? `Disc ${game.discNum}/${game.discsInSet}` : ''].filter(Boolean).join(' · ')}</small></div></div><code>{game.titleId}</code><span>{game.sourceDrive || '—'}</span><div className="move-controls"><select aria-label={t('move')} value={targetByGame[game.contentId] || ''} disabled={!game.sourceDrive} onChange={event => setTargetByGame(current => ({ ...current, [game.contentId]: event.target.value }))}><option value="">{game.sourceDrive ? t('chooseDrive') : t('driveUnknown')}</option>{drives.filter(drive => drive.replace(/:$/, '') !== game.sourceDrive).map(drive => <option key={drive} value={drive}>{drive.replace(/:$/, '')}</option>)}</select><button className="button secondary" disabled={!targetByGame[game.contentId] || moving === game.contentId} onClick={() => void move(game)}>{moving === game.contentId ? '…' : t('move')}</button></div></article>)}
      </section>
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
        {selected.length > 0 && <div className="selection-bar"><span>{t('selectedItems', { count: selected.length })}</span><button className="text-button" onClick={() => void perform(async () => { for (const name of selected) await deleteFtp(xboxIp, joinPath(cwd, name)) })}>{t('delete')}</button><button className="text-button" onClick={() => { const target = window.prompt(t('move')); if (target) void perform(async () => { for (const name of selected) await renameFtp(xboxIp, joinPath(cwd, name), joinPath(target, name)) }) }}>{t('move')}</button><button className="text-button" onClick={() => { const target = window.prompt(t('copy')); if (target) void perform(async () => { for (const name of selected) { const entry = entries.find(item => item.name === name); await copyFtp(xboxIp, joinPath(cwd, name), joinPath(target, name), entry?.type === 'dir') } }, false) }}>{t('copy')}</button></div>}
        <div className="file-table" role="table"><div className="file-row file-head" role="row"><span /><span>{t('name')}</span><span>{t('type')}</span><span>{t('size')}</span></div>{entries.map(entry => <div className="file-row" role="row" key={entry.name}><input type="checkbox" checked={selected.includes(entry.name)} onChange={() => toggle(entry.name)} aria-label={entry.name} /><button className={entry.type === 'dir' ? 'file-name dir' : 'file-name'} onClick={() => navigate(entry)}>{entry.type === 'dir' ? '▸' : '·'} {entry.name}</button><span>{t(entry.type === 'dir' ? 'folder' : 'file')}</span><span>{bytes(entry.size)}</span></div>)}{!busy && entries.length === 0 && <div className="empty-table">{t('emptyDirectory')}</div>}</div>
      </section>
      <section className="tool-panel transfer-panel"><div className="section-heading"><div><span className="eyebrow">FTP</span><h2>{t('ftpTransfers')}</h2></div></div>{jobs.length === 0 ? <div className="empty-table">{t('noFtpTransfers')}</div> : jobs.map(job => <div className="transfer-row" key={job.id}><span className={`status-dot ${job.state === 'Ready' ? 'ready' : job.state === 'Error' ? 'error' : 'processing'}`} /><strong>{job.name}</strong><span>{job.state}{job.progress !== undefined ? ` · ${job.progress}%` : ''}</span>{['Ready', 'Error'].includes(job.state) && <button className="text-button" onClick={() => void removeFtpJob(job.id).then(loadJobs)}>{t('remove')}</button>}</div>)}</section>
    </>}
  </div>
}

function ContentRows({ items, title, onQueue, onToggle }: { items: ContentItem[]; title: string; onQueue: (item: ContentItem) => void; onToggle?: (item: ContentItem) => void }) {
  const { t } = useI18n()
  return <section className="tool-panel content-panel"><div className="section-heading"><div><span className="eyebrow">CONTENT</span><h2>{title}</h2></div></div>{items.length === 0 ? <div className="empty-table">{t('noContent')}</div> : items.map(item => <div className="content-row" key={`${item.file_name}-${item.source}`}><div><strong>{item.display_name}</strong><small>{item.source}{item.version ? ` · v${item.version}` : ''}{item.size ? ` · ${bytes(item.size)}` : ''}</small></div><div className="content-actions">{item.installed && <span className="tag">{t('installed')}</span>}{item.active && <span className="tag ready-tag">{t('active')}</span>}{onToggle && item.installed ? <button className="button secondary" onClick={() => onToggle(item)}>{t(item.active ? 'deactivate' : 'activate')}</button> : <button className="button primary" onClick={() => onQueue(item)}>{t('install')}</button>}</div></div>)}</section>
}

export function ContentManager({ xboxIp, drive }: { xboxIp: string; drive: string }) {
  const { t } = useI18n(); const [titleId, setTitleId] = useState(''); const [gameName, setGameName] = useState('')
  const [manifest, setManifest] = useState<ContentManifest | null>(null); const [tus, setTus] = useState<ContentItem[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  async function load() { if (!titleId.trim()) return; setBusy(true); setError(''); try { const [content, updates] = await Promise.all([getContent(titleId.trim(), gameName.trim(), xboxIp, drive), getTitleUpdates(titleId.trim())]); setManifest(content); setTus(updates.length ? updates : content.title_updates || []) } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) } }
  async function queue(item: ContentItem) { setBusy(true); setError(''); try { await queueContent(item, gameName.trim(), xboxIp, drive) } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) } }
  async function toggle(item: ContentItem) { setBusy(true); setError(''); try { await setTitleUpdateActive(item, xboxIp, drive, !item.active); await load() } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) } }
  return <div className="page-content tool-page"><div className="page-intro"><span className="eyebrow">XBOX / CONTENT</span><h1>{t('contentTitle')}</h1><p>{t('contentDescription')}</p></div>{!xboxIp ? <div className="empty-state panel-message"><p>{t('xboxRequired')}</p></div> : <><section className="tool-panel query-panel"><div className="settings-form"><label className="field"><span>{t('gameName')}</span><input value={gameName} onChange={event => setGameName(event.target.value)} /></label><label className="field"><span>{t('titleId')}</span><input value={titleId} onChange={event => setTitleId(event.target.value.toUpperCase())} placeholder="4D5307E6" /></label><button className="button primary" disabled={!titleId.trim() || busy} onClick={() => void load()}>{t('loadContent')}</button></div>{error && <p className="inline-error">{error}</p>}</section>{manifest && <div className="stacked-panels"><ContentRows title={t('availableDlc')} items={manifest.dlcs || []} onQueue={item => void queue(item)} /><ContentRows title={t('titleUpdates')} items={tus} onQueue={item => void queue(item)} onToggle={item => void toggle(item)} /></div>}</>}</div>
}

export function SaveManager({ xboxIp, drive }: { xboxIp: string; drive: string }) {
  const { t } = useI18n(); const [titleId, setTitleId] = useState(''); const [profiles, setProfiles] = useState<SaveProfile[]>([]); const [profile, setProfile] = useState<SaveProfile | null>(null); const [entries, setEntries] = useState<SaveEntry[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [targetProfile, setTargetProfile] = useState(''); const [useKeyVault, setUseKeyVault] = useState(false)
  async function discover() { setBusy(true); setError(''); try { const next = await discoverSaves(xboxIp, drive, titleId.trim()); setProfiles(next); setProfile(null); setEntries([]) } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) } }
  async function select(next: SaveProfile) { if (!titleId.trim()) return; setBusy(true); setError(''); try { setProfile(next); setEntries(await listSaves(xboxIp, drive, titleId.trim(), next.profile_id)) } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) } }
  async function action(work: () => Promise<void>) { setBusy(true); setError(''); try { await work() } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) } }
  return <div className="page-content tool-page"><div className="page-intro"><span className="eyebrow">XBOX / SAVES</span><h1>{t('savesTitle')}</h1><p>{t('savesDescription')}</p></div>{!xboxIp ? <div className="empty-state panel-message"><p>{t('xboxRequired')}</p></div> : <><section className="tool-panel query-panel"><div className="settings-form"><label className="field"><span>{t('titleId')}</span><input value={titleId} onChange={event => setTitleId(event.target.value.toUpperCase())} placeholder="4D5307E6" /></label><button className="button primary" disabled={busy} onClick={() => void discover()}>{t('discoverProfiles')}</button><button className="button secondary" disabled={busy} onClick={() => void action(() => backupAllSaves(xboxIp, drive))}>{t('backUpAll')}</button></div>{error && <p className="inline-error">{error}</p>}</section><div className="two-panel"><section className="tool-panel"><div className="section-heading"><div><span className="eyebrow">XBOX</span><h2>{t('profile')}</h2></div></div>{profiles.map(item => <button className={profile?.profile_id === item.profile_id ? 'profile-row selected' : 'profile-row'} key={item.profile_id} onClick={() => void select(item)}><strong>{item.profile_name || item.profile_id}</strong><small>{item.profile_id}{item.save_count !== undefined ? ` · ${item.save_count}` : ''}</small></button>)}</section><section className="tool-panel"><div className="section-heading"><div><span className="eyebrow">XBOX</span><h2>{t('saveFiles')}</h2></div>{profile && <button className="button secondary" disabled={busy} onClick={() => void action(() => downloadSave(xboxIp, drive, titleId, profile.profile_id, ''))}>{t('backUp')}</button>}</div>{!profile ? <div className="empty-table">{t('selectProfile')}</div> : entries.map(entry => <div className="save-row" key={entry.name}><strong>{entry.name}</strong><span>{bytes(entry.size)}</span></div>)}{profile && <div className="save-copy-controls"><label className="field"><span>{t('copyToProfile')}</span><select value={targetProfile} onChange={event => setTargetProfile(event.target.value)}><option value="">{t('chooseProfile')}</option>{profiles.filter(item => item.profile_id !== profile.profile_id).map(item => <option key={item.profile_id} value={item.profile_id}>{item.profile_name || item.profile_id}</option>)}</select></label><label className="check-field"><input type="checkbox" checked={useKeyVault} onChange={event => setUseKeyVault(event.target.checked)} />{t('useKeyVault')}</label><button className="button secondary" disabled={busy || !targetProfile || !entries.length} onClick={() => void action(() => copySave(xboxIp, drive, titleId, profile.profile_id, targetProfile, useKeyVault))}>{t('copy')}</button></div>}{profile && <button className="text-button destructive" disabled={busy} onClick={() => { if (window.confirm(t('delete'))) void action(() => deleteSave(xboxIp, drive, titleId, profile.profile_id).then(discover)) }}>{t('delete')}</button>}</section></div></>}</div>
}

export function IsoTools() {
  const { t } = useI18n(); const [isoPath, setIsoPath] = useState(''); const [outDir, setOutDir] = useState(''); const [info, setInfo] = useState<IsoInfo | null>(null); const [result, setResult] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  async function probe() { setBusy(true); setError(''); setResult(''); try { setInfo(await probeIso(isoPath.trim())) } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) } }
  async function convert(format: 'god' | 'xex') { setBusy(true); setError(''); setResult(''); try { const data = await convertIso(format, isoPath.trim(), outDir.trim()); setResult(t('conversionComplete', { path: data.outputDir })) } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) } }
  return <div className="page-content tool-page"><div className="page-intro"><span className="eyebrow">SERVER / ISO</span><h1>{t('isoToolsTitle')}</h1><p>{t('isoToolsDescription')}</p></div><section className="tool-panel"><div className="settings-form iso-form"><label className="field"><span>{t('isoPath')}</span><input value={isoPath} onChange={event => setIsoPath(event.target.value)} placeholder="/srv/godsend/Transfer/game.iso" /></label><label className="field"><span>{t('outputDirectory')}</span><input value={outDir} onChange={event => setOutDir(event.target.value)} placeholder="/srv/godsend/Ready" /></label><button className="button secondary" disabled={!isoPath.trim() || busy} onClick={() => void probe()}>{t('probe')}</button><button className="button primary" disabled={!isoPath.trim() || !outDir.trim() || busy} onClick={() => void convert('god')}>{t('convertToGod')}</button><button className="button primary" disabled={!isoPath.trim() || !outDir.trim() || busy} onClick={() => void convert('xex')}>{t('extractToXex')}</button></div>{error && <p className="inline-error">{error}</p>}{result && <p className="connection-message success">{result}</p>}{info && <div className="disc-info"><span className="eyebrow">{t('discInfo')}</span><strong>{info.displayName}</strong><span>{t('titleId')}: {info.titleId} · Media ID: {info.mediaId}</span><small>{t('disc', { number: info.discNumber, count: info.discCount })}{info.isOriginalXbox ? ' · Original Xbox' : ''}</small></div>}</section></div>
}
