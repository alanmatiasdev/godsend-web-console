import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  browse, getConfig, getDiscInfo, getDrives, getQueue, pingXbox, queueGame,
  type BrowseResult, type InstallType, type Job, type ServerConfig, type Source,
} from './api'

const platforms = [
  { id: 'xbox360', label: 'Xbox 360' },
  { id: 'xbox', label: 'Xbox original' },
  { id: 'xbla', label: 'XBLA' },
  { id: 'digital', label: 'Digital' },
  { id: 'dlc', label: 'DLC' },
  { id: 'xblig', label: 'Indie' },
  { id: 'games', label: 'Games Archive' },
]

const sources: { id: Source; label: string }[] = [
  { id: 'local', label: 'Arquivos locais' },
  { id: 'minerva', label: 'Minerva' },
  { id: 'ia', label: 'Internet Archive' },
]

type Page = 'catalog' | 'queue' | 'settings'

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Falha desconhecida.'
}

function isIp(value: string): boolean {
  const parts = value.trim().split('.')
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function stateLabel(state: string): string {
  return ({ Processing: 'Em andamento', Ready: 'Pronto', Error: 'Erro', Idle: 'Aguardando' } as Record<string, string>)[state] || state
}

function Jobs({ jobs, error, onRefresh }: { jobs: Job[]; error: string; onRefresh: () => void }) {
  return <div className="jobs-list">
    <div className="section-heading">
      <div><span className="eyebrow">ATIVIDADE</span><h2>Fila de trabalho</h2></div>
      <button className="icon-button" onClick={onRefresh} aria-label="Atualizar fila" title="Atualizar fila">↻</button>
    </div>
    {error && <p className="inline-error">{error}</p>}
    {!error && jobs.length === 0 && <div className="empty-jobs"><span className="empty-mark">○</span><p>Nenhum trabalho na fila.</p><small>Os jogos enviados aparecem aqui.</small></div>}
    {jobs.map(job => <article className="job" key={job.game}>
      <div className="job-head"><span className={`status-dot ${job.state.toLowerCase()}`} /><strong>{job.game}</strong></div>
      <div className="job-meta"><span>{stateLabel(job.state)}</span><span>{job.message}</span></div>
    </article>)}
  </div>
}

function QueueDialog({ game, platform, source, ip, defaultDrive, onClose, onQueued }: {
  game: string; platform: string; source: Source; ip: string; defaultDrive: string;
  onClose: () => void; onQueued: (status: string) => void
}) {
  const [drives, setDrives] = useState<string[]>([])
  const [drive, setDrive] = useState(defaultDrive || 'Hdd1:')
  const [installType, setInstallType] = useState<InstallType>('god')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
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

  async function submit() {
    if (!isIp(ip)) { setError('Informe o IP do Xbox em Conexão antes de enviar.'); return }
    setBusy(true); setError('')
    try {
      const status = await queueGame({ game, platform, source, ip: ip.trim(), drive, installType: hasMethods ? installType : 'god' })
      onQueued(status)
    } catch (cause) { setError(message(cause)) }
    finally { setBusy(false) }
  }

  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <div className="modal-head"><span className="eyebrow">ENVIAR PARA O XBOX</span><button className="icon-button" aria-label="Fechar" onClick={onClose}>×</button></div>
      <h2 id="dialog-title">{game}</h2>
      <p className="modal-subtitle">{source === 'local' ? 'Biblioteca local' : `${sources.find(item => item.id === source)?.label} · ${platforms.find(item => item.id === platform)?.label}`}</p>
      <label className="field"><span>Unidade de destino</span>
        <select value={drive} onChange={event => setDrive(event.target.value)}>
          {[...new Set([drive, defaultDrive, ...drives].filter(Boolean))].map(item => <option key={item}>{item}</option>)}
        </select>
      </label>
      {hasMethods && <fieldset className="method-field"><legend>Formato de instalação</legend>
        {(['god', 'content', 'xex'] as InstallType[]).map(type => <label key={type} className={installType === type ? 'method active' : 'method'}>
          <input type="radio" name="installType" checked={installType === type} onChange={() => setInstallType(type)} />{type.toUpperCase()}
        </label>)}
      </fieldset>}
      {notes && <p className="hint">{notes}</p>}
      {error && <p className="inline-error">{error}</p>}
      <div className="modal-actions"><button className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" disabled={busy} onClick={submit}>{busy ? 'Enviando…' : 'Adicionar à fila'}</button></div>
    </section>
  </div>
}

export default function App() {
  const [page, setPage] = useState<Page>('catalog')
  const [source, setSource] = useState<Source>('minerva')
  const [platform, setPlatform] = useState('xbox360')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(80)
  const [catalog, setCatalog] = useState<BrowseResult>({ games: [] })
  const [catalogState, setCatalogState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [catalogError, setCatalogError] = useState('')
  const [config, setConfig] = useState<ServerConfig | null>(null)
  const [serverError, setServerError] = useState('')
  const [jobs, setJobs] = useState<Job[]>([])
  const [queueError, setQueueError] = useState('')
  const [xboxIp, setXboxIp] = useState(() => localStorage.getItem('godsend.xboxIp') || '')
  const [ipInput, setIpInput] = useState(xboxIp)
  const [xboxState, setXboxState] = useState<'idle' | 'checking' | 'connected' | 'error'>('idle')
  const [xboxError, setXboxError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  const refreshConfig = useCallback(async () => {
    try { setConfig(await getConfig()); setServerError('') }
    catch (cause) { setConfig(null); setServerError(message(cause)) }
  }, [])
  const refreshQueue = useCallback(async () => {
    try { setJobs(await getQueue()); setQueueError('') }
    catch (cause) { setQueueError(message(cause)) }
  }, [])
  const refreshCatalog = useCallback(async () => {
    setCatalogState('loading'); setCatalogError('')
    try { setCatalog(await browse(platform, source)); setCatalogState('ready') }
    catch (cause) { setCatalogError(message(cause)); setCatalogState('error') }
  }, [platform, source])

  useEffect(() => { void refreshConfig(); void refreshQueue() }, [refreshConfig, refreshQueue])
  useEffect(() => { const id = window.setInterval(() => void refreshConfig(), 15000); return () => clearInterval(id) }, [refreshConfig])
  useEffect(() => { void refreshCatalog(); setSearch(''); setLimit(80) }, [refreshCatalog])
  useEffect(() => { const id = window.setInterval(() => void refreshQueue(), 5000); return () => clearInterval(id) }, [refreshQueue])
  useEffect(() => {
    if (!catalog.loading || page !== 'catalog') return
    const id = window.setInterval(() => void refreshCatalog(), 5000)
    return () => clearInterval(id)
  }, [catalog.loading, page, refreshCatalog])
  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(() => setNotice(''), 5000)
    return () => clearTimeout(id)
  }, [notice])

  const filtered = useMemo(() => catalog.games.filter(game => game.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [catalog.games, search])
  const activeJobs = jobs.filter(job => job.state === 'Processing').length

  async function checkXbox(ip = xboxIp) {
    if (!isIp(ip)) { setXboxError('Informe um endereço IPv4 válido.'); setXboxState('error'); return }
    setXboxState('checking'); setXboxError('')
    try { await pingXbox(ip.trim()); setXboxState('connected') }
    catch (cause) { setXboxError(message(cause)); setXboxState('error') }
  }

  function saveXboxIp() {
    if (!isIp(ipInput)) { setXboxError('Informe um endereço IPv4 válido.'); return }
    const next = ipInput.trim()
    localStorage.setItem('godsend.xboxIp', next)
    setXboxIp(next)
    setXboxState('idle'); setXboxError(''); setNotice('Endereço do Xbox salvo neste navegador.')
    void checkXbox(next)
  }

  return <div className="app-shell">
    <aside className="rail">
      <div className="brand"><div className="brand-symbol">G<span>·</span></div><div className="brand-copy"><strong>GODsend</strong><small>WEB CONSOLE</small></div></div>
      <div className="rail-rule" />
      <nav aria-label="Navegação principal">
        <button className={page === 'catalog' ? 'nav-item current' : 'nav-item'} onClick={() => setPage('catalog')}><span className="nav-glyph">▤</span>Catálogo</button>
        <button className={page === 'queue' ? 'nav-item current' : 'nav-item'} onClick={() => setPage('queue')}><span className="nav-glyph">◷</span>Fila {activeJobs > 0 && <span className="nav-count">{activeJobs}</span>}</button>
        <button className={page === 'settings' ? 'nav-item current' : 'nav-item'} onClick={() => setPage('settings')}><span className="nav-glyph">⚙</span>Conexão</button>
      </nav>
      <div className="rail-bottom"><span className="rail-caption">SERVIDOR</span><div className="connection-line"><span className={config ? 'status-dot ready' : 'status-dot error'} />{config ? 'GODsend conectado' : 'Sem conexão'}</div><small>{window.location.host}</small></div>
    </aside>

    <main className="main-content">
      <header className="topbar"><span>GODsend / {page === 'catalog' ? 'Catálogo' : page === 'queue' ? 'Fila' : 'Conexão'}</span><div className="topbar-right"><span className="server-label">BACKEND</span><span className={config ? 'server-pill online' : 'server-pill'}>{config ? 'ONLINE' : 'OFFLINE'}</span></div></header>
      {notice && <div className="toast" role="status">{notice}</div>}
      {serverError && <div className="server-alert" role="alert">Não foi possível acessar o GODsend: {serverError} <button onClick={refreshConfig}>Tentar novamente</button></div>}

      {page === 'catalog' && <div className="page-content">
        <div className="page-intro"><span className="eyebrow">BIBLIOTECA / XBOX 360</span><h1>Escolha o próximo jogo.</h1><p>Explore os arquivos disponíveis e acompanhe o envio para o console.</p></div>
        <div className="catalog-layout"><section className="catalog-panel">
          <div className="section-heading"><div><span className="eyebrow">ORIGEM</span><h2>Explorar catálogo</h2></div><button className="icon-button" onClick={refreshCatalog} title="Atualizar catálogo" aria-label="Atualizar catálogo">↻</button></div>
          <div className="tab-row" role="group" aria-label="Origem dos jogos">{sources.map(item => <button key={item.id} className={source === item.id ? 'tab active' : 'tab'} onClick={() => setSource(item.id)}>{item.label}</button>)}</div>
          {source !== 'local' && <div className="platform-row"><label htmlFor="platform">Plataforma</label><select id="platform" value={platform} onChange={event => setPlatform(event.target.value)}>{platforms.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>}
          <div className="search-row"><label className="search-field"><span aria-hidden="true">⌕</span><input value={search} onChange={event => { setSearch(event.target.value); setLimit(80) }} placeholder="Buscar pelo nome do jogo" aria-label="Buscar jogos" /></label><span className="result-count">{filtered.length} {filtered.length === 1 ? 'título' : 'títulos'}</span></div>
          <div className="catalog-results">
            {catalogState === 'loading' && <div className="empty-state"><span className="empty-mark">◌</span><p>Consultando o catálogo…</p></div>}
            {catalogState === 'error' && <div className="empty-state"><span className="empty-mark">!</span><p>Não foi possível carregar os jogos.</p><small>{catalogError}</small><button className="button secondary" onClick={refreshCatalog}>Tentar novamente</button></div>}
            {catalogState === 'ready' && catalog.loading && <div className="empty-state"><span className="empty-mark">◌</span><p>O catálogo está sendo preparado.</p><small>{catalog.loading.loaded} de {catalog.loading.total} etapas concluídas. A lista atualiza automaticamente.</small></div>}
            {catalogState === 'ready' && !catalog.loading && filtered.length === 0 && <div className="empty-state"><span className="empty-mark">□</span><p>{search ? 'Nenhum título corresponde à busca.' : source === 'local' ? 'Nenhum ISO na pasta Transfer.' : 'Nenhum jogo encontrado nesta origem.'}</p><small>{source === 'local' && !search ? 'Copie seus arquivos ISO para a pasta Transfer configurada no servidor.' : 'Tente outra origem ou plataforma.'}</small></div>}
            {catalogState === 'ready' && !catalog.loading && filtered.slice(0, limit).map((game, index) => <button className="game-row" key={`${game}-${index}`} onClick={() => setSelected(game)}><span className="game-index">{String(index + 1).padStart(3, '0')}</span><span className="game-title">{game}</span><span className="game-action">Adicionar <span aria-hidden="true">↗</span></span></button>)}
            {filtered.length > limit && <button className="load-more" onClick={() => setLimit(value => value + 80)}>Mostrar mais {Math.min(80, filtered.length - limit)} títulos</button>}
          </div>
        </section><aside className="activity-panel"><Jobs jobs={jobs.slice(0, 6)} error={queueError} onRefresh={refreshQueue} />{jobs.length > 6 && <button className="view-all" onClick={() => setPage('queue')}>Ver fila completa →</button>}<div className="info-block"><span className="eyebrow">DESTINO</span><strong>{xboxIp || 'Xbox não configurado'}</strong><small>{xboxIp ? `Unidade padrão: ${config?.default_drive || 'Hdd1:'}` : 'Configure o endereço do console para enviar jogos.'}</small><button onClick={() => setPage('settings')}>Abrir conexão →</button></div></aside></div>
      </div>}

      {page === 'queue' && <div className="page-content narrow"><div className="page-intro"><span className="eyebrow">PROCESSAMENTO / FTP</span><h1>Trabalhos em andamento.</h1><p>A fila é atualizada a cada cinco segundos.</p></div><section className="full-panel"><Jobs jobs={jobs} error={queueError} onRefresh={refreshQueue} /></section></div>}

      {page === 'settings' && <div className="page-content narrow"><div className="page-intro"><span className="eyebrow">REDE LOCAL</span><h1>Conecte seu Xbox.</h1><p>O GODsend usa o FTP do Aurora para instalar os jogos no console.</p></div><section className="settings-panel"><div className="section-heading"><div><span className="eyebrow">XBOX 360</span><h2>Endereço do console</h2></div></div><p>Informe o IP do Xbox na mesma rede do servidor. O endereço fica salvo apenas neste navegador.</p><div className="settings-form"><label className="field"><span>IP do Xbox</span><input inputMode="decimal" value={ipInput} onChange={event => setIpInput(event.target.value)} placeholder="192.168.1.50" /></label><button className="button primary" onClick={saveXboxIp}>Salvar e testar</button></div>{xboxState === 'checking' && <p className="connection-message">Testando conexão FTP…</p>}{xboxState === 'connected' && <p className="connection-message success">FTP do Xbox conectado.</p>}{xboxError && <p className="inline-error">{xboxError}</p>}<div className="settings-note"><span className="eyebrow">SERVIDOR GODSEND</span><strong>{window.location.origin}</strong><small>Esta interface usa a API HTTP do servidor que a distribui.</small></div></section></div>}
    </main>
    {selected && <QueueDialog game={selected} platform={platform} source={source} ip={xboxIp} defaultDrive={config?.default_drive || 'Hdd1:'} onClose={() => setSelected(null)} onQueued={status => { setSelected(null); setNotice(status === 'already_processing' ? 'O jogo já está em processamento.' : status === 'already_ready' ? 'O jogo já está pronto.' : 'Jogo adicionado à fila.'); void refreshQueue() }} />}
  </div>
}
