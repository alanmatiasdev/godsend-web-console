import { useEffect, useMemo, useRef, useState } from 'react'
import { getServerLogs, type ServerLog } from './api'
import { useI18n } from './i18n'

export function ServerLogs({ serverUrl }: { serverUrl: string }) {
  const { t } = useI18n()
  const [lines, setLines] = useState<ServerLog[]>([])
  const [filter, setFilter] = useState('')
  const [follow, setFollow] = useState(true)
  const [error, setError] = useState('')
  const cursor = useRef(0)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    let pending = false
    cursor.current = 0
    setLines([])
    async function refresh() {
      if (pending) return
      pending = true
      try {
        const next = await getServerLogs(cursor.current)
        if (!active) return
        if (next.length) {
          cursor.current = next[next.length - 1].id
          setLines(current => [...current, ...next].slice(-500))
        }
        setError('')
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : String(cause)) }
      finally { pending = false }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2000)
    return () => { active = false; window.clearInterval(timer) }
  }, [serverUrl])

  const shown = useMemo(() => lines.filter(item => item.line.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase())), [lines, filter])
  useEffect(() => { if (follow && list.current) list.current.scrollTop = list.current.scrollHeight }, [shown, follow])
  function exportLogs() {
    const url = URL.createObjectURL(new Blob([lines.map(item => item.line).join('\n')], { type: 'text/plain;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = 'godsend-logs.txt'
    document.body.append(anchor); anchor.click(); anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 60000)
  }

  return <div className="page-content tool-page logs-page">
    <div className="page-intro"><span className="eyebrow">SERVER / LOGS</span><h1>{t('logsTitle')}</h1><p>{t('logsDescription')}</p></div>
    <section className="tool-panel"><div className="logs-toolbar"><label className="search-field"><span aria-hidden="true">⌕</span><input value={filter} onChange={event => setFilter(event.target.value)} placeholder={t('filterLogs')} aria-label={t('filterLogs')} /></label><label className="check-field"><input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)} />{t('followLogs')}</label><button className="button secondary" disabled={!lines.length} onClick={exportLogs}>{t('exportLogs')}</button><button className="button secondary" disabled={!lines.length} onClick={() => setLines([])}>{t('clearView')}</button></div>
      {error && <p className="inline-error">{error}</p>}
      <div ref={list} className="logs-output" role="log" aria-live="off">{shown.length ? shown.map(item => <div key={item.id} className={item.line.includes('[WARN]') || item.line.includes('ERROR') ? 'log-line warning' : 'log-line'}>{item.line}</div>) : <p>{t('noLogLines')}</p>}</div>
    </section>
  </div>
}
