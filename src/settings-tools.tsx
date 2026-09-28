import { useCallback, useEffect, useState } from 'react'
import { clearServerData, getCacheStatus, getDataStatus, refreshCaches, testXboxCredentials, uploadAuroraScripts, type CacheStatus, type DataStatus } from './api'
import { useI18n } from './i18n'

function errorText(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause) }

export function ServerTools({ xboxIp, serverUrl }: { xboxIp: string; serverUrl: string }) {
  const { t } = useI18n()
  const [cache, setCache] = useState<CacheStatus>({})
  const [data, setData] = useState<DataStatus | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [scriptsDir, setScriptsDir] = useState('')
  const [remotePath, setRemotePath] = useState('/Hdd1/Aurora/User/Scripts/Utility/GODSend')
  const [serverIp, setServerIp] = useState(() => new URL(serverUrl || window.location.origin).hostname)
  const [serverPort, setServerPort] = useState(() => serverUrl ? new URL(serverUrl).port || '8080' : '8080')
  const [ftpUser, setFtpUser] = useState('')
  const [ftpPassword, setFtpPassword] = useState('')
  const [ftpTest, setFtpTest] = useState<{ ok: boolean; log: string[] } | null>(null)
  const [testingFtp, setTestingFtp] = useState(false)

  const load = useCallback(async () => {
    try {
      const [nextCache, nextData] = await Promise.all([getCacheStatus(), getDataStatus()])
      setCache(nextCache); setData(nextData); setError('')
    } catch (cause) { setError(errorText(cause)) }
  }, [serverUrl])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const url = new URL(serverUrl || window.location.origin)
    setServerIp(url.hostname); setServerPort(serverUrl ? url.port || '8080' : '8080')
  }, [serverUrl])

  async function perform(action: () => Promise<void>, success: string) {
    setBusy(true); setError(''); setNotice('')
    try { await action(); setNotice(success); await load() }
    catch (cause) { setError(errorText(cause)) }
    finally { setBusy(false) }
  }
  const cacheRows = Object.entries(cache).sort(([a], [b]) => a.localeCompare(b))
  const validPort = Number.isInteger(Number(serverPort)) && Number(serverPort) >= 1 && Number(serverPort) <= 65535

  async function testCredentials() {
    setTestingFtp(true); setFtpTest(null); setError('')
    try { setFtpTest(await testXboxCredentials(xboxIp, ftpUser.trim(), ftpPassword)) }
    catch (cause) { setError(errorText(cause)) }
    finally { setTestingFtp(false) }
  }

  return <div className="settings-tools">
    <section className="settings-panel maintenance-panel">
      <div className="section-heading"><div><span className="eyebrow">GODSEND</span><h2>{t('serverMaintenance')}</h2></div><button className="button secondary" disabled={busy} onClick={() => void load()}>{t('refresh')}</button></div>
      <p>{t('serverMaintenanceHint')}</p>
      <div className="maintenance-metrics"><span>{t('activeJobsCount', { count: data?.active_jobs ?? '—' })}</span><span>{t('pendingFtpCount', { count: data?.pending_ftp_jobs ?? '—' })}</span><span>{t('localDataSize', { size: data ? `${(data.local_data_bytes / 1048576).toFixed(1)} MB` : '—' })}</span></div>
      {cacheRows.length > 0 && <div className="cache-list">{cacheRows.map(([platform, status]) => <div key={platform}><strong>{platform}</strong><span>{status.state} · {status.loaded}/{status.total} · {t('manyTitles', { count: status.games })}</span></div>)}</div>}
      <div className="maintenance-actions"><button className="button secondary" disabled={busy} onClick={() => void perform(refreshCaches, t('cacheRefreshStarted'))}>{t('refreshAllCaches')}</button><button className="button danger" disabled={busy} onClick={() => { if (window.confirm(t('confirmClearServerData'))) void perform(clearServerData, t('serverDataCleared')) }}>{t('clearServerData')}</button></div>
      {error && <p className="inline-error">{error}</p>}{notice && <p className="connection-message success">{notice}</p>}
    </section>
    <section className="settings-panel scripts-panel">
      <div className="section-heading"><div><span className="eyebrow">AURORA</span><h2>{t('installAuroraScripts')}</h2></div></div>
      <p>{t('installAuroraScriptsHint')}</p>
      <div className="settings-grid"><label className="field"><span>{t('scriptsDirectory')}</span><input value={scriptsDir} onChange={event => setScriptsDir(event.target.value)} placeholder="/srv/godsend/aurora-scripts" /></label><label className="field"><span>{t('scriptsDestination')}</span><input value={remotePath} onChange={event => setRemotePath(event.target.value)} /></label><label className="field"><span>{t('serverIpForXbox')}</span><input value={serverIp} onChange={event => setServerIp(event.target.value)} inputMode="decimal" /></label><label className="field"><span>{t('serverPortForXbox')}</span><input value={serverPort} onChange={event => setServerPort(event.target.value)} inputMode="numeric" /></label></div>
      <div className="maintenance-actions"><button className="button primary" disabled={busy || !xboxIp || !scriptsDir.trim() || !remotePath.startsWith('/') || !serverIp.trim() || !validPort} onClick={() => void perform(() => uploadAuroraScripts(xboxIp, scriptsDir.trim(), remotePath.trim(), serverIp.trim(), serverPort.trim()), t('scriptsQueued'))}>{t('uploadScripts')}</button></div>
    </section>
    <section className="settings-panel ftp-test-panel">
      <div className="section-heading"><div><span className="eyebrow">XBOX FTP</span><h2>{t('ftpCredentialTest')}</h2></div></div>
      <p>{t('ftpCredentialTestHint')}</p>
      <div className="settings-grid"><label className="field"><span>{t('ftpUsername')}</span><input value={ftpUser} onChange={event => setFtpUser(event.target.value)} autoComplete="username" placeholder={t('serverDefault')} /></label><label className="field"><span>{t('ftpPassword')}</span><input type="password" value={ftpPassword} onChange={event => setFtpPassword(event.target.value)} autoComplete="off" placeholder={t('serverDefault')} /></label></div>
      <div className="maintenance-actions"><button className="button secondary" disabled={!xboxIp || testingFtp} onClick={() => void testCredentials()}>{testingFtp ? t('testingFtp') : t('testFtpCredentials')}</button></div>
      {ftpTest && <pre className={ftpTest.ok ? 'ftp-test-result success' : 'ftp-test-result'}>{ftpTest.log.join('\n')}</pre>}
    </section>
  </div>
}
