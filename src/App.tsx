import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import {
  addToWishlist, browse, enqueueGame, getConfig, getDiscInfo, getDrives, pingXbox,
  ApiError, getUnifiedQueue, removeFtpJob, removeGameJob, setApiBaseUrl, type BrowseResult, type InstallType, type Job, type ServerConfig, type Source,
} from './api'
import { useI18n, type Translate, type TranslationKey } from './i18n'
import { ContentManager, FtpManager, IsoTools, SaveManager, XboxLibrary } from './management'
import { IsoUpload, WaitingQueue, Wishlist, useScheduler } from './queue'

const platforms = [
  { id: 'xbox360', label: 'platformXbox360' },
  { id: 'xbox', label: 'platformXbox' },
  { id: 'xbla', label: 'platformXbla' },
  { id: 'digital', label: 'platformDigital' },
  { id: 'dlc', label: 'platformDlc' },
  { id: 'xblig', label: 'platformXblig' },
  { id: 'games', label: 'platformGames' },
] satisfies { id: string; label: TranslationKey }[]

const sources: { id: Source; label: TranslationKey }[] = [
  { id: 'local', label: 'sourceLocal' },
  { id: 'minerva', label: 'sourceMinerva' },
  { id: 'ia', label: 'sourceIa' },
]

type Page = 'catalog' | 'queue' | 'wishlist' | 'library' | 'ftp' | 'content' | 'saves' | 'iso' | 'settings'
type RouteState = { page: Page; source: Source; platform: string; search: string; limit: number }

function readRouteState(): RouteState {
  const params = new URLSearchParams(window.location.search)
  const requestedPage = params.get('view') as Page | null
  const validPages: Page[] = ['catalog', 'queue', 'wishlist', 'library', 'ftp', 'content', 'saves', 'iso', 'settings']
  const requestedSource = params.get('source') as Source | null
  const validSources: Source[] = ['local', 'minerva', 'ia']
  const requestedPlatform = params.get('platform') || 'xbox360'
  const validPlatforms = platforms.map(item => item.id)
  const requestedLimit = Number(params.get('limit'))
  return {
    page: requestedPage && validPages.includes(requestedPage) ? requestedPage : 'catalog',
    source: requestedSource && validSources.includes(requestedSource) ? requestedSource : 'minerva',
    platform: validPlatforms.includes(requestedPlatform) ? requestedPlatform : 'xbox360',
    search: params.get('q') || '',
    limit: Number.isInteger(requestedLimit) && requestedLimit >= 80 && requestedLimit <= 2000 ? requestedLimit : 80,
  }
}

function writeRouteState(state: RouteState): void {
  const params = new URLSearchParams(window.location.search)
  for (const key of ['view', 'source', 'platform', 'q', 'limit']) params.delete(key)
  if (state.page !== 'catalog') params.set('view', state.page)
  if (state.source !== 'minerva') params.set('source', state.source)
  if (state.platform !== 'xbox360') params.set('platform', state.platform)
  if (state.search) params.set('q', state.search)
  if (state.limit !== 80) params.set('limit', String(state.limit))
  const query = params.toString()
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
}

class LocalizedError extends Error {
  constructor(public key: TranslationKey) { super(key) }
}

function message(error: unknown, t: Translate): string {
  if (error instanceof LocalizedError) return t(error.key)
  if (error instanceof ApiError) {
    return t(error.code === 'timeout' ? 'requestTimeout' : error.code === 'network' ? 'networkError' : 'localIsoUnavailable')
  }
  return error instanceof Error ? error.message : t('unknownError')
}

function isIp(value: string): boolean {
  const parts = value.trim().split('.')
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function normalizeServerUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function storedServerUrl(): string {
  try { return localStorage.getItem('godsend.serverUrl') || '' }
  catch { return '' }
}

function stateLabel(state: string, t: Translate): string {
  const key = ({ Processing: 'stateProcessing', Ready: 'stateReady', Error: 'stateError', Idle: 'stateIdle' } as Record<string, TranslationKey>)[state]
  return key ? t(key) : state
}

function Jobs({ jobs, error, onRefresh, onRemoved }: { jobs: Job[]; error: unknown; onRefresh: () => void; onRemoved: () => void }) {
  const { t } = useI18n()
  return <div className="jobs-list">
    <div className="section-heading">
      <div><span className="eyebrow">{t('activity')}</span><h2>{t('jobQueue')}</h2></div>
      <button className="icon-button" onClick={onRefresh} aria-label={t('refreshQueue')} title={t('refreshQueue')}>↻</button>
    </div>
    {Boolean(error) && <p className="inline-error">{message(error, t)}</p>}
    {!Boolean(error) && jobs.length === 0 && <div className="empty-jobs"><span className="empty-mark">○</span><p>{t('noJobs')}</p><small>{t('sentGamesAppearHere')}</small></div>}
    {jobs.map(job => <article className="job" key={`${job.kind || 'game'}-${job.game}`}>
      <div className="job-head"><span className={`status-dot ${job.state.toLowerCase()}`} /><strong>{job.game}</strong></div>
      <div className="job-meta"><span>{job.kind === 'ftp' ? 'FTP' : t('gameJob')} · {stateLabel(job.state, t)}{job.progress !== undefined && ` · ${job.progress}%`}</span><span>{job.message}</span></div>
      {['Ready', 'Error', 'Idle'].includes(job.state) && <button className="text-button" onClick={() => { const action = job.kind === 'ftp' && job.removeId !== undefined ? removeFtpJob(job.removeId) : removeGameJob(job.game); void action.then(onRemoved) }}>{t('remove')}</button>}
    </article>)}
  </div>
}

function QueueDialog({ game, platform, source, ip, defaultDrive, onClose, onQueued, onWishlisted }: {
  game: string; platform: string; source: Source; ip: string; defaultDrive: string;
  onClose: () => void; onQueued: (status: string) => void; onWishlisted: () => void
}) {
  const { t } = useI18n()
  const [drives, setDrives] = useState<string[]>([])
  const [drive, setDrive] = useState(defaultDrive || 'Hdd1:')
  const [installType, setInstallType] = useState<InstallType>('god')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const hasMethods = source === 'local' || ['xbox360', 'xbox', 'games'].includes(platform)

  useEffect(() => {
    let active = true
    if (isIp(ip)) getDrives(ip).then(data => { if (active) setDrives(data) }).catch(() => {})
    if (hasMethods) getDiscInfo(game).then(info => {
      if (!active || !info) return
      if (info.recommendation && ['god', 'content', 'xex'].includes(info.recommendation)) setInstallType(info.recommendation)
      if (info.notes) setNotes(info.notes)
    })
    return () => { active = false }
  }, [game, ip, hasMethods])

  async function submit(target: 'queue' | 'wishlist') {
    if (!isIp(ip)) { setError(new LocalizedError('ipRequiredBeforeQueue')); return }
    setBusy(true); setError(null)
    try {
      const entry = { game, platform, source, ip: ip.trim(), drive, installType: hasMethods ? installType : 'god' as InstallType }
      if (target === 'wishlist') { await addToWishlist(entry); onWishlisted() }
      else onQueued(await enqueueGame(entry))
    } catch (cause) { setError(cause) }
    finally { setBusy(false) }
  }

  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <div className="modal-head"><span className="eyebrow">{t('sendToXbox')}</span><button className="icon-button" aria-label={t('close')} onClick={onClose}>×</button></div>
      <h2 id="dialog-title">{game}</h2>
      <p className="modal-subtitle">{source === 'local' ? t('localLibrary') : `${t(sources.find(item => item.id === source)?.label || 'sourceMinerva')} · ${t(platforms.find(item => item.id === platform)?.label || 'platformXbox360')}`}</p>
      <label className="field"><span>{t('destinationDrive')}</span>
        <select value={drive} onChange={event => setDrive(event.target.value)}>
          {[...new Set([drive, defaultDrive, ...drives].filter(Boolean))].map(item => <option key={item}>{item}</option>)}
        </select>
      </label>
      {hasMethods && <fieldset className="method-field"><legend>{t('installFormat')}</legend>
        {(['god', 'content', 'xex'] as InstallType[]).map(type => <label key={type} className={installType === type ? 'method active' : 'method'}>
          <input type="radio" name="installType" checked={installType === type} onChange={() => setInstallType(type)} />{type.toUpperCase()}
        </label>)}
      </fieldset>}
      {notes && <p className="hint">{notes}</p>}
      {Boolean(error) && <p className="inline-error">{message(error, t)}</p>}
      <div className="modal-actions"><button className="button secondary" onClick={onClose}>{t('cancel')}</button><button className="button secondary" disabled={busy} onClick={() => void submit('wishlist')}>{t('addToWishlist')}</button><button className="button primary" disabled={busy} onClick={() => void submit('queue')}>{busy ? t('sending') : t('addToQueue')}</button></div>
    </section>
  </div>
}

export default function App() {
  const { language, setLanguage, t } = useI18n()
  const [page, setPage] = useState<Page>(() => readRouteState().page)
  const [source, setSource] = useState<Source>(() => readRouteState().source)
  const [platform, setPlatform] = useState(() => readRouteState().platform)
  const [search, setSearch] = useState(() => readRouteState().search)
  const [limit, setLimit] = useState(() => readRouteState().limit)
  const [catalog, setCatalog] = useState<BrowseResult>({ games: [] })
  const [catalogState, setCatalogState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [catalogError, setCatalogError] = useState<unknown>(null)
  const [config, setConfig] = useState<ServerConfig | null>(null)
  const [serverError, setServerError] = useState<unknown>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [queueError, setQueueError] = useState<unknown>(null)
  const [serverUrl, setServerUrl] = useState(storedServerUrl)
  const [serverInput, setServerInput] = useState(() => storedServerUrl() || window.location.origin)
  const [serverInputError, setServerInputError] = useState<unknown>(null)
  const [serverSaving, setServerSaving] = useState(false)
  const [xboxIp, setXboxIp] = useState(() => localStorage.getItem('godsend.xboxIp') || '')
  const [ipInput, setIpInput] = useState(xboxIp)
  const [xboxState, setXboxState] = useState<'idle' | 'checking' | 'connected' | 'error'>('idle')
  const [xboxError, setXboxError] = useState<unknown>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [notice, setNotice] = useState<TranslationKey | null>(null)

  const refreshConfig = useCallback(async () => {
    try { setConfig(await getConfig()); setServerError(null) }
    catch (cause) { setConfig(null); setServerError(cause) }
  }, [])
  const refreshQueue = useCallback(async () => {
    try { setJobs(await getUnifiedQueue()); setQueueError(null) }
    catch (cause) { setQueueError(cause) }
  }, [])
  const refreshCatalog = useCallback(async () => {
    setCatalogState('loading'); setCatalogError(null)
    try { setCatalog(await browse(platform, source)); setCatalogState('ready') }
    catch (cause) { setCatalogError(cause); setCatalogState('error') }
  }, [platform, source])

  useEffect(() => { setApiBaseUrl(serverUrl) }, [serverUrl])
  const scheduler = useScheduler(serverUrl)
  useEffect(() => { void refreshConfig(); void refreshQueue() }, [serverUrl, refreshConfig, refreshQueue])
  useEffect(() => { const id = window.setInterval(() => void refreshConfig(), 15000); return () => clearInterval(id) }, [refreshConfig])
  useEffect(() => { void refreshCatalog() }, [refreshCatalog])
  // Persist route state before the browser can paint the updated filters. This
  // keeps a refresh immediately after a filter change from restoring stale URL
  // parameters.
  useLayoutEffect(() => { writeRouteState({ page, source, platform, search, limit }) }, [page, source, platform, search, limit])
  useEffect(() => {
    const restoreFromUrl = () => {
      const state = readRouteState()
      setPage(state.page); setSource(state.source); setPlatform(state.platform); setSearch(state.search); setLimit(state.limit)
    }
    window.addEventListener('popstate', restoreFromUrl)
    return () => window.removeEventListener('popstate', restoreFromUrl)
  }, [])
  useEffect(() => { const id = window.setInterval(() => void refreshQueue(), 5000); return () => clearInterval(id) }, [refreshQueue])
  useEffect(() => {
    if (!catalog.loading || page !== 'catalog') return
    const id = window.setInterval(() => void refreshCatalog(), 5000)
    return () => clearInterval(id)
  }, [catalog.loading, page, refreshCatalog])
  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(id)
  }, [notice])

  const filtered = useMemo(() => catalog.games.filter(game => game.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [catalog.games, search])
  const activeJobs = jobs.filter(job => job.state === 'Processing').length
  const waitingCount = scheduler.state.pending.length

  const checkXbox = useCallback(async (ip = xboxIp) => {
    if (!isIp(ip)) { setXboxError(new LocalizedError('invalidIp')); setXboxState('error'); return }
    setXboxState('checking'); setXboxError(null)
    try { await pingXbox(ip.trim()); setXboxState('connected') }
    catch (cause) { setXboxError(cause); setXboxState('error') }
  }, [serverUrl, xboxIp])

  useEffect(() => {
    if (xboxIp) void checkXbox(xboxIp)
  }, [xboxIp, checkXbox])

  function saveXboxIp() {
    if (!isIp(ipInput)) { setXboxError(new LocalizedError('invalidIp')); return }
    const next = ipInput.trim()
    localStorage.setItem('godsend.xboxIp', next)
    setXboxIp(next)
    setXboxState('idle'); setXboxError(null); setNotice('xboxIpSaved')
  }

  async function saveServerAddress(value = serverInput) {
    const next = normalizeServerUrl(value)
    if (next === null) { setServerInputError(new LocalizedError('invalidServerUrl')); return }
    setServerSaving(true); setServerInputError(null)
    try {
      const nextConfig = await getConfig(next)
      setApiBaseUrl(next)
      if (next) localStorage.setItem('godsend.serverUrl', next)
      else localStorage.removeItem('godsend.serverUrl')
      setServerUrl(next)
      setServerInput(next || window.location.origin)
      setConfig(nextConfig)
      setServerError(null)
      setNotice('serverAddressSaved')
    } catch (cause) {
      setServerInputError(cause)
    } finally {
      setServerSaving(false)
    }
  }

  const effectiveServerAddress = serverUrl || window.location.origin
  const xboxStatus = xboxState === 'connected'
    ? { label: t('xboxConnected'), className: 'ready' }
    : xboxState === 'checking'
      ? { label: t('xboxChecking'), className: 'processing' }
      : xboxIp
        ? { label: t('xboxUnavailable'), className: 'error' }
        : { label: t('xboxNotConfigured'), className: '' }

  return <div className="app-shell">
    <aside className="rail">
      <div className="brand"><div className="brand-symbol">G<span>·</span></div><div className="brand-copy"><strong>GODsend</strong><small>{t('brandDescriptor')}</small></div></div>
      <div className="rail-rule" />
      <nav aria-label={t('mainNavigation')}>
        <button className={page === 'catalog' ? 'nav-item current' : 'nav-item'} onClick={() => setPage('catalog')}><span className="nav-glyph">▤</span>{t('catalog')}</button>
        <button className={page === 'queue' ? 'nav-item current' : 'nav-item'} onClick={() => setPage('queue')}><span className="nav-glyph">◷</span>{t('queue')} {activeJobs + waitingCount > 0 && <span className="nav-count">{activeJobs + waitingCount}</span>}</button>
        <button className={page === 'wishlist' ? 'nav-item current' : 'nav-item'} onClick={() => setPage('wishlist')}><span className="nav-glyph">☆</span>{t('wishlist')} {scheduler.state.wishlist.length > 0 && <span className="nav-count">{scheduler.state.wishlist.length}</span>}</button>
        <button className={page === 'library' ? 'nav-item current' : 'nav-item'} onClick={() => setPage('library')}><span className="nav-glyph">◉</span>{t('xboxLibrary')}</button>
        <button className={page === 'ftp' ? 'nav-item current' : 'nav-item'} onClick={() => setPage('ftp')}><span className="nav-glyph">▦</span>{t('ftpManager')}</button>
        <button className={page === 'content' ? 'nav-item current' : 'nav-item'} onClick={() => setPage('content')}><span className="nav-glyph">+</span>{t('content')}</button>
        <button className={page === 'saves' ? 'nav-item current' : 'nav-item'} onClick={() => setPage('saves')}><span className="nav-glyph">◫</span>{t('saves')}</button>
        <button className={page === 'iso' ? 'nav-item current' : 'nav-item'} onClick={() => setPage('iso')}><span className="nav-glyph">◇</span>{t('isoTools')}</button>
        <button className={page === 'settings' ? 'nav-item current' : 'nav-item'} onClick={() => setPage('settings')}><span className="nav-glyph">⚙</span>{t('connection')}</button>
      </nav>
      <div className="rail-bottom">
        <div className="rail-status">
          <span className="rail-caption">{t('server')}</span>
          <div className="connection-line"><span className={config ? 'status-dot ready' : 'status-dot error'} />{config ? t('serverConnected') : t('noConnection')}</div>
          <small>{effectiveServerAddress}</small>
        </div>
        <div className="rail-status">
          <span className="rail-caption">{t('xbox')}</span>
          <div className="connection-line"><span className={`status-dot ${xboxStatus.className}`} />{xboxStatus.label}</div>
          {xboxIp && <small>{xboxIp}</small>}
        </div>
      </div>
    </aside>

    <main className="main-content">
      <header className="topbar"><span>GODsend / {t(page === 'catalog' ? 'catalog' : page === 'queue' ? 'queue' : page === 'wishlist' ? 'wishlist' : page === 'library' ? 'xboxLibrary' : page === 'ftp' ? 'ftpManager' : page === 'content' ? 'content' : page === 'saves' ? 'saves' : page === 'iso' ? 'isoTools' : 'connection')}</span><div className="topbar-right"><label className="language-control"><span>{t('language')}</span><select aria-label={t('language')} value={language} onChange={event => setLanguage(event.target.value as 'en' | 'pt-BR')}><option value="en">EN</option><option value="pt-BR">PT-BR</option></select></label><span className="server-label">{t('backend')}</span><span className={config ? 'server-pill online' : 'server-pill'}>{config ? t('online') : t('offline')}</span></div></header>
      {notice && <div className="toast" role="status">{t(notice)}</div>}
      {Boolean(serverError) && <div className="server-alert" role="alert">{t('serverUnavailable', { error: message(serverError, t) })} <button onClick={refreshConfig}>{t('tryAgain')}</button></div>}

      {page === 'catalog' && <div className="page-content">
        <div className="page-intro"><span className="eyebrow">{t('libraryEyebrow')}</span><h1>{t('chooseNextGame')}</h1><p>{t('exploreAvailable')}</p></div>
        <div className="catalog-layout"><section className="catalog-panel">
          <div className="section-heading"><div><span className="eyebrow">{t('source')}</span><h2>{t('exploreCatalog')}</h2></div><button className="icon-button" onClick={refreshCatalog} title={t('refreshCatalog')} aria-label={t('refreshCatalog')}>↻</button></div>
          <div className="tab-row" role="group" aria-label={t('gameSource')}>{sources.map(item => <button key={item.id} className={source === item.id ? 'tab active' : 'tab'} onClick={() => setSource(item.id)}>{t(item.label)}</button>)}</div>
          {source !== 'local' && <div className="platform-row"><label htmlFor="platform">{t('platform')}</label><select id="platform" value={platform} onChange={event => setPlatform(event.target.value)}>{platforms.map(item => <option key={item.id} value={item.id}>{t(item.label)}</option>)}</select></div>}
          {source === 'local' && <IsoUpload onUploaded={() => void refreshCatalog()} />}
          <div className="search-row"><label className="search-field"><span aria-hidden="true">⌕</span><input value={search} onChange={event => { setSearch(event.target.value); setLimit(80) }} placeholder={t('searchPlaceholder')} aria-label={t('searchGames')} /></label><span className="result-count">{t(filtered.length === 1 ? 'oneTitle' : 'manyTitles', { count: filtered.length })}</span></div>
          <div className="catalog-results">
            {catalogState === 'loading' && <div className="empty-state"><span className="empty-mark">◌</span><p>{t('loadingCatalog')}</p></div>}
            {catalogState === 'error' && <div className="empty-state"><span className="empty-mark">!</span><p>{t('failedToLoadGames')}</p><small>{message(catalogError, t)}</small><button className="button secondary" onClick={refreshCatalog}>{t('tryAgain')}</button></div>}
            {catalogState === 'ready' && catalog.loading && <div className="empty-state"><span className="empty-mark">◌</span><p>{t('catalogPreparing')}</p><small>{t('catalogProgress', { loaded: catalog.loading.loaded, total: catalog.loading.total })}</small></div>}
            {catalogState === 'ready' && !catalog.loading && filtered.length === 0 && <div className="empty-state"><span className="empty-mark">□</span><p>{t(search ? 'noSearchMatches' : source === 'local' ? 'noLocalIso' : 'noGamesFromSource')}</p><small>{t(source === 'local' && !search ? 'addIsoToTransfer' : 'tryOtherSource')}</small></div>}
            {catalogState === 'ready' && !catalog.loading && filtered.slice(0, limit).map((game, index) => <button className="game-row" key={`${game}-${index}`} onClick={() => setSelected(game)}><span className="game-index">{String(index + 1).padStart(3, '0')}</span><span className="game-title">{game}</span><span className="game-action">{t('add')} <span aria-hidden="true">↗</span></span></button>)}
            {filtered.length > limit && <button className="load-more" onClick={() => setLimit(value => value + 80)}>{t('showMoreTitles', { count: Math.min(80, filtered.length - limit) })}</button>}
          </div>
        </section><aside className="activity-panel"><Jobs jobs={jobs.slice(0, 6)} error={queueError} onRefresh={refreshQueue} onRemoved={() => void refreshQueue()} />{jobs.length > 6 && <button className="view-all" onClick={() => setPage('queue')}>{t('viewAllJobs')}</button>}<div className="info-block"><span className="eyebrow">{t('destination')}</span><strong>{xboxIp || t('xboxNotConfigured')}</strong><small>{xboxIp ? t('defaultDrive', { drive: config?.default_drive || 'Hdd1:' }) : t('configureConsole')}</small><button onClick={() => setPage('settings')}>{t('openConnection')}</button></div></aside></div>
      </div>}

      {page === 'queue' && <div className="page-content narrow"><div className="page-intro"><span className="eyebrow">{t('processingFtp')}</span><h1>{t('workInProgress')}</h1><p>{t('queueRefreshHint')}</p></div><WaitingQueue scheduler={scheduler} runningJobs={activeJobs} /><section className="full-panel queue-running"><Jobs jobs={jobs} error={queueError} onRefresh={refreshQueue} onRemoved={() => void refreshQueue()} /></section></div>}

      {page === 'wishlist' && <Wishlist scheduler={scheduler} xboxIp={xboxIp} />}

      {page === 'library' && <XboxLibrary xboxIp={xboxIp} />}
      {page === 'ftp' && <FtpManager xboxIp={xboxIp} />}
      {page === 'content' && <ContentManager xboxIp={xboxIp} drive={config?.default_drive || 'Hdd1:'} />}
      {page === 'saves' && <SaveManager xboxIp={xboxIp} drive={config?.default_drive || 'auto'} />}
      {page === 'iso' && <IsoTools />}

      {page === 'settings' && <div className="page-content narrow"><div className="page-intro"><span className="eyebrow">{t('localNetwork')}</span><h1>{t('connectXbox')}</h1><p>{t('ftpDescription')}</p></div><section className="settings-panel"><div className="section-heading"><div><span className="eyebrow">XBOX 360</span><h2>{t('xboxAddress')}</h2></div></div><p>{t('xboxIpInstructions')}</p><div className="settings-form"><label className="field"><span>{t('xboxIp')}</span><input inputMode="decimal" value={ipInput} onChange={event => setIpInput(event.target.value)} placeholder="192.168.1.50" /></label><button className="button primary" onClick={saveXboxIp}>{t('saveAndTest')}</button></div>{xboxState === 'checking' && <p className="connection-message">{t('testingFtp')}</p>}{xboxState === 'connected' && <p className="connection-message success">{t('ftpConnected')}</p>}{Boolean(xboxError) && <p className="inline-error">{message(xboxError, t)}</p>}<div className="settings-note"><span className="eyebrow">{t('godsendServer')}</span><strong>{effectiveServerAddress}</strong><small>{t('sameOriginApi')}</small></div><div className="server-settings"><span className="eyebrow">{t('server')}</span><h2>{t('serverAddress')}</h2><p>{t('serverAddressInstructions')}</p><div className="settings-form"><label className="field"><span>{t('serverAddress')}</span><input type="url" inputMode="url" value={serverInput} onChange={event => setServerInput(event.target.value)} placeholder={window.location.origin} /></label><button className="button primary" disabled={serverSaving} onClick={() => void saveServerAddress()}>{serverSaving ? t('connecting') : t('saveAndConnect')}</button></div><div className="server-actions"><small>{t('defaultServer', { address: window.location.origin })}</small><button className="text-button" onClick={() => void saveServerAddress('')}>{t('useDefaultServer')}</button></div>{Boolean(serverInputError) && <p className="inline-error">{message(serverInputError, t)}</p>}</div></section></div>}
    </main>
    {selected && <QueueDialog game={selected} platform={platform} source={source} ip={xboxIp} defaultDrive={config?.default_drive || 'Hdd1:'} onClose={() => setSelected(null)} onQueued={status => { setSelected(null); setNotice(status === 'already_processing' ? 'alreadyProcessing' : status === 'already_ready' ? 'alreadyReady' : 'gameQueued'); void refreshQueue(); void scheduler.refresh() }} onWishlisted={() => { setSelected(null); setNotice('gameWishlisted'); void scheduler.refresh() }} />}
  </div>
}
