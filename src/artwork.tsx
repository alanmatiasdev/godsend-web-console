import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { artworkTypes, getAuroraArtworkSet, searchArtwork, uploadAuroraArtwork, type ArtworkResult, type AuroraGame } from './api'
import { useI18n } from './i18n'

type Translate = ReturnType<typeof useI18n>['t']
type Candidate = { blob: Blob; preview: string }

const typeKeys = { cover: 'artworkCover', background: 'artworkBackground', banner: 'artworkBanner', icon: 'artworkIcon' } as const

function typeLabel(type: string, t: Translate): string {
  const key = typeKeys[type as keyof typeof typeKeys]
  return key ? t(key) : t('artworkScreenshot', { number: type.replace('screenshot', '') })
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : 'Unknown error' }
const isTitleId = (value: string) => /^[0-9A-F]{8}$/i.test(value.trim())

export function ArtworkDialog({ xboxIp, root, game, onClose }: { xboxIp: string; root: string; game: AuroraGame; onClose: () => void }) {
  const { t } = useI18n()
  const [type, setType] = useState('cover')
  const [current, setCurrent] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [searchText, setSearchText] = useState(game.titleId)
  const [results, setResults] = useState<ArtworkResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [selectedResult, setSelectedResult] = useState<ArtworkResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const searchToken = useRef(0)

  const load = useCallback(async () => {
    setLoading(true)
    try { setCurrent(await getAuroraArtworkSet(xboxIp, root, game)) }
    catch (cause) { setError(errorText(cause)) }
    finally { setLoading(false) }
  }, [xboxIp, root, game])
  useEffect(() => { void load() }, [load])
  useEffect(() => () => { if (candidate?.preview.startsWith('blob:')) URL.revokeObjectURL(candidate.preview) }, [candidate])

  function changeType(next: string) {
    searchToken.current += 1
    setType(next); setResults(null); setSearching(false); setCandidate(null); setSelectedResult(null); setError(''); setNotice('')
  }

  async function search() {
    const text = searchText.trim()
    if (!text) return
    const token = ++searchToken.current
    setSearching(true); setError(''); setNotice(''); setResults(null)
    try {
      // Searching by the untouched Title ID falls back to the game name, like the desktop app.
      const found = await searchArtwork(type, isTitleId(text) ? text : '', text === game.titleId ? game.name : text)
      if (token === searchToken.current) setResults(found)
    } catch (cause) { if (token === searchToken.current) setError(errorText(cause)) }
    finally { if (token === searchToken.current) setSearching(false) }
  }

  async function pickResult(result: ArtworkResult) {
    setError('')
    try { setCandidate({ blob: await (await fetch(result.image)).blob(), preview: result.image }); setSelectedResult(result) }
    catch (cause) { setError(errorText(cause)) }
  }

  function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setNotice(''); setSelectedResult(null)
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') { setError(t('artworkFormats')); return }
    setError(''); setCandidate({ blob: file, preview: URL.createObjectURL(file) })
  }

  async function upload() {
    if (!candidate) return
    setBusy(true); setError(''); setNotice('')
    try {
      await uploadAuroraArtwork(xboxIp, root, game, type, candidate.blob)
      setNotice(t('artworkUploaded', { type: typeLabel(type, t), game: game.name }))
      setCandidate(null); setSelectedResult(null)
      await load()
    } catch (cause) { setError(errorText(cause)) }
    finally { setBusy(false) }
  }

  const label = typeLabel(type, t)
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="modal artwork-modal" role="dialog" aria-modal="true" aria-labelledby="artwork-title">
      <div className="modal-head"><span className="eyebrow">{t('artwork')}</span><button className="icon-button" aria-label={t('close')} onClick={onClose}>×</button></div>
      <h2 id="artwork-title">{game.name}</h2>
      <p className="modal-subtitle">{game.titleId}</p>
      <label className="field"><span>{t('artworkType')}</span><select value={type} onChange={event => changeType(event.target.value)}>{artworkTypes.map(item => <option key={item} value={item}>{typeLabel(item, t)}</option>)}</select></label>
      <div className="artwork-compare">
        <figure className="artwork-frame"><figcaption>{t('artworkOnXbox')}</figcaption>{loading ? <p>{t('loadingArtwork')}</p> : current[type] ? <img src={current[type]} alt={`${label} · ${game.name}`} /> : <p>{t('noArtwork')}</p>}</figure>
        <figure className="artwork-frame"><figcaption>{t('artworkNewImage')}</figcaption>{candidate ? <img src={candidate.preview} alt={`${t('artworkNewImage')} · ${label}`} /> : <p>{t('artworkNoSelection')}</p>}</figure>
      </div>
      <form className="artwork-search" onSubmit={event => { event.preventDefault(); void search() }}>
        <label className="field"><span>{t('artworkSearchLabel')}</span><input value={searchText} onChange={event => setSearchText(event.target.value)} /></label>
        <button className="button secondary" type="submit" disabled={searching || !searchText.trim()}>{searching ? t('searchingArtwork') : t('artworkSearch')}</button>
      </form>
      {results && (results.length === 0
        ? <p className="hint">{t('noArtworkResults')}</p>
        : <div className="artwork-results">{results.map((result, index) => <button key={index} className="artwork-result" aria-pressed={selectedResult === result} onClick={() => void pickResult(result)}><img src={result.image} alt="" /><span>{result.source}{result.official ? ` · ${t('artworkOfficial')}` : ''}</span></button>)}</div>)}
      <div className="artwork-file">
        <label className="button secondary"><input className="visually-hidden" type="file" accept="image/png,image/jpeg" onChange={pickFile} />{t('chooseImageFile')}</label>
        <small>{t('artworkFormats')}</small>
      </div>
      {/^(icon|banner|screenshot)/.test(type) && <p className="modal-subtitle">{t('artworkSharedHint')}</p>}
      {error && <p className="inline-error">{error}</p>}{notice && <p className="connection-message success">{notice}</p>}
      <div className="modal-actions"><button className="button secondary" onClick={onClose}>{t('close')}</button><button className="button primary" disabled={!candidate || busy} onClick={() => void upload()}>{busy ? t('uploadingArtwork') : t('uploadArtwork')}</button></div>
    </section>
  </div>
}
