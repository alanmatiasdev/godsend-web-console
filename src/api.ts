export type Source = 'local' | 'minerva' | 'ia' | 'rom'
export type InstallType = 'god' | 'content' | 'xex'
export type Job = { game: string; state: string; message: string; kind?: 'game' | 'ftp'; progress?: number; removeId?: number }
export type ServerConfig = { default_drive?: string; custom_god_path?: string; custom_xex_path?: string }
export type BrowseResult = { games: string[]; loading?: { loaded: number; total: number } }
export type FtpEntry = { name: string; type: 'dir' | 'file'; size?: number }
export type FtpJob = { id: number; name: string; state: string; progress?: number; detail?: string; speed?: string; error?: string }
export type ContentItem = { title_id: string; content_type: string; display_name: string; file_name: string; size?: number; version?: number; source: string; source_url?: string; installed: boolean; active: boolean; drive?: string }
export type ContentManifest = { title_id: string; game_name?: string; dlcs?: ContentItem[]; title_updates?: ContentItem[] }
export type SaveProfile = { profile_id: string; profile_name: string; save_count?: number; last_modified?: string }
export type SaveEntry = { name: string; size: number }
export class HttpError extends Error {
  constructor(message: string, public status: number) { super(message) }
}
export class ApiError extends Error {
  constructor(public code: 'timeout' | 'network' | 'localUnavailable') { super(code) }
}

let apiBaseUrl = ''

export function setApiBaseUrl(url: string): void {
  apiBaseUrl = url.replace(/\/$/, '')
}

export function getApiBaseUrl(): string {
  return apiBaseUrl
}

export function artworkThumbnailUrl(game: string): string {
  const path = query('/webui/artwork/thumbnail', { query: game })
  return apiBaseUrl ? new URL(path, `${apiBaseUrl}/`).toString() : path
}

async function request(path: string, init?: RequestInit, baseUrl = apiBaseUrl, timeoutMs = 12000): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(baseUrl ? new URL(path, `${baseUrl}/`).toString() : path, { ...init, signal: controller.signal, cache: 'no-store' })
    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`
      try {
        const error = await response.json()
        detail = error.message || error.error || detail
      } catch { /* A plain-text response is valid for some routes. */ }
      throw new HttpError(detail, response.status)
    }
    return response
  } catch (error) {
    if (controller.signal.aborted) throw new ApiError('timeout')
    if (error instanceof TypeError) throw new ApiError('network')
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function jsonRequest<T>(path: string, body?: unknown, method = 'POST', timeoutMs = 12000): Promise<T> {
  const response = await request(path, body === undefined ? undefined : {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, apiBaseUrl, timeoutMs)
  return response.json() as Promise<T>
}

function query(path: string, params: Record<string, string>): string {
  return `${path}?${new URLSearchParams(params)}`
}

export async function getConfig(baseUrl?: string): Promise<ServerConfig> {
  return (await request('/config', undefined, baseUrl)).json()
}

export type DataStatus = { active_jobs: number; pending_ftp_jobs: number; local_data_bytes: number }
export type CacheStatus = Record<string, { state: string; loaded: number; total: number; games: number }>
export type ServerLog = { id: number; line: string }
export type ArtworkSyncConfig = { enabled: boolean; xbox_ip: string; aurora_root: string }
export async function getServerLogs(after = 0): Promise<ServerLog[]> {
  const data = await (await request(query('/webui/logs', { after: String(after) }))).json() as { logs?: ServerLog[] }
  return Array.isArray(data.logs) ? data.logs : []
}
export async function getArtworkSyncConfig(): Promise<ArtworkSyncConfig> { return (await request('/webui/artwork/config')).json() }
export async function saveArtworkSyncConfig(config: ArtworkSyncConfig): Promise<ArtworkSyncConfig> { return jsonRequest('/webui/artwork/config', config) }
export async function syncAuroraArtwork(ip: string, root: string, titles: Array<{ title_id: string; name: string }>): Promise<number> {
  const data = await jsonRequest<{ queued: number }>('/webui/artwork/sync', { xbox_ip: ip, aurora_root: root, titles })
  return data.queued
}
export async function getDataStatus(): Promise<DataStatus> { return (await request('/data/status')).json() }
export async function clearServerData(): Promise<void> { await request('/data/clear', { method: 'POST' }) }
export async function getCacheStatus(): Promise<CacheStatus> { return (await request('/cache-status')).json() }
export async function refreshCaches(): Promise<void> { await request('/cache-refresh?platform=all', { method: 'POST' }) }
export async function uploadAuroraScripts(ip: string, scriptsDir: string, remotePath: string, serverIp: string, serverPort: string): Promise<void> {
  await jsonRequest('/ftp/upload-scripts', { ip, scripts_dir: scriptsDir, remote_path: remotePath, server_ip: serverIp, server_port: serverPort })
}

export async function getQueue(): Promise<Job[]> {
  const data: unknown = await (await request('/queue')).json()
  return Array.isArray(data) ? data.filter((item): item is Job =>
    typeof item?.game === 'string' && typeof item?.state === 'string' && typeof item?.message === 'string') : []
}

export async function getUnifiedQueue(): Promise<Job[]> {
  const [gameJobs, ftpJobs] = await Promise.all([getQueue(), getFtpJobs()])
  return [
    ...gameJobs.map(job => ({ ...job, kind: 'game' as const })),
    ...ftpJobs.map(job => ({
      game: job.name,
      state: job.state,
      message: [job.detail, job.progress !== undefined ? `${job.progress}%` : '', job.speed, job.error].filter(Boolean).join(' · '),
      kind: 'ftp' as const,
      progress: job.progress,
      removeId: job.id,
    })),
  ]
}

export async function removeGameJob(game: string): Promise<void> {
  await request(query('/queue/remove', { game }), { method: 'POST' })
}

export async function ftpBatch(ip: string, ops: Array<Record<string, unknown>>, timeoutMs = 120000): Promise<Array<{ ok: boolean; data?: unknown; error?: string }>> {
  const data = await jsonRequest<{ results?: Array<{ ok: boolean; data?: unknown; error?: string }> }>('/ftp/batch', { ip, ops }, 'POST', timeoutMs)
  return Array.isArray(data.results) ? data.results : []
}

export async function uploadBrowserFiles(ip: string, remotePath: string, files: File[]): Promise<void> {
  const body = new FormData()
  body.set('ip', ip)
  body.set('remote_path', remotePath)
  body.set('paths', JSON.stringify(files.map(file => (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name)))
  for (const file of files) body.append('files', file, file.name)
  await request('/webui/upload-file', { method: 'POST', body }, apiBaseUrl, 30 * 60 * 1000)
}

export async function downloadBrowserFile(ip: string, remotePath: string, onProgress?: (fraction: number) => void): Promise<Blob> {
  const response = await request(query('/webui/download-file', { ip, path: remotePath }), undefined, apiBaseUrl, 30 * 60 * 1000)
  if (!response.body || !onProgress) return response.blob()
  const total = Number(response.headers.get('Content-Length'))
  const reader = response.body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let loaded = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = new Uint8Array(value)
    chunks.push(chunk); loaded += chunk.byteLength
    if (total > 0) onProgress(Math.min(1, loaded / total))
  }
  return new Blob(chunks, { type: response.headers.get('Content-Type') || 'application/octet-stream' })
}

export async function downloadBrowserArchive(ip: string, paths: string[]): Promise<Blob> {
  return (await request('/webui/archive', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ip, paths }),
  }, apiBaseUrl, 60 * 60 * 1000)).blob()
}

export async function moveXboxGame(ip: string, game: { name: string; sourceDrive: string; directory: string }, targetDrive: string): Promise<void> {
  await jsonRequest('/ftp/move-game', { ip, game_name: game.name, src_drive: game.sourceDrive, directory: game.directory, target_drive: targetDrive })
}

export type AuroraGame = {
  contentId: number; titleId: string; name: string; description: string; publisher: string; developer: string;
  releaseDate: string; directory: string; discNum: number; discsInSet: number; isFavorite: boolean;
  timesPlayed: number; lastPlayed: string | null; sourceDrive: string; gameDataDir: string;
}

export async function discoverAuroraRoot(ip: string): Promise<string> {
  const candidates = ['/Hdd1/Aurora', '/Usb0/Apps/Aurora', '/Hdd1/Apps/Aurora', '/Usb0/Aurora', '/Usb1/Apps/Aurora', '/Usb1/Aurora', '/HddX/Aurora']
  const ops: Array<Record<string, unknown>> = []
  const checkIndex: number[] = []
  for (const root of candidates) {
    ops.push({ op: 'cd', path: '/' }, { op: 'cd', path: `${root}/Data/Databases` })
    checkIndex.push(ops.length)
    ops.push({ op: 'pwd' })
  }
  const results = await ftpBatch(ip, ops)
  for (let index = 0; index < candidates.length; index += 1) {
    const value = results[checkIndex[index]]?.data
    if (typeof value === 'string' && value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === `${candidates[index]}/Data/Databases`.toLowerCase()) return candidates[index]
  }
  throw new Error('Aurora database folder was not found on the common Xbox drives. Enter its root path and try again.')
}

function fromBase64(value: unknown): Uint8Array {
  if (typeof value !== 'string') throw new Error('GODsend returned an invalid Aurora database.')
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function sqlQuery(db: import('sql.js').Database, sql: string): Array<Record<string, unknown>> {
  const statement = db.prepare(sql)
  const rows: Array<Record<string, unknown>> = []
  try { while (statement.step()) rows.push(statement.getAsObject() as Record<string, unknown>) }
  finally { statement.free() }
  return rows
}

export async function loadAuroraLibrary(ip: string, root: string): Promise<AuroraGame[]> {
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const dir = `${base}/Data/Databases`
  const [contentResult, settingsResult] = await ftpBatch(ip, [
    { op: 'download_base64', path: `${dir}/content.db` },
    { op: 'download_base64', path: `${dir}/settings.db` },
  ], 5 * 60 * 1000)
  if (!contentResult?.ok) throw new Error(`Could not read Aurora content.db: ${contentResult?.error || 'FTP error'}`)
  if (!settingsResult?.ok) throw new Error(`Could not read Aurora settings.db: ${settingsResult?.error || 'FTP error'}`)
  const [{ default: initSqlJs }, wasm] = await Promise.all([import('sql.js'), import('sql.js/dist/sql-wasm.wasm?url')])
  const SQL = await initSqlJs({ locateFile: () => wasm.default })
  const contentDb = new SQL.Database(fromBase64(contentResult.data))
  const settingsDb = new SQL.Database(fromBase64(settingsResult.data))
  try {
    const games = sqlQuery(contentDb, `SELECT Id, TitleId, MediaId, TitleName, Description, Publisher, Developer, ReleaseDate, Directory, ScanPathId, DiscNum, DiscsInSet FROM ContentItems ORDER BY TitleName`)
    const scanRows = sqlQuery(settingsDb, `SELECT Id, Path FROM ScanPaths`)
    let hiddenIds = new Set<number>()
    let favoriteIds = new Set<number>()
    let recent = new Map<number, { timesPlayed: number; lastPlayed: string | null }>()
    try { hiddenIds = new Set(sqlQuery(settingsDb, 'SELECT DISTINCT ContentId FROM UserHidden').map(row => Number(row.ContentId))) } catch { /* Optional Aurora table. */ }
    try { favoriteIds = new Set(sqlQuery(settingsDb, 'SELECT DISTINCT ContentId FROM UserFavorites').map(row => Number(row.ContentId))) } catch { /* Optional Aurora table. */ }
    try { recent = new Map(sqlQuery(settingsDb, 'SELECT ContentId, MAX(DateTime) AS LastPlayed, COUNT(*) AS TimesPlayed FROM UserRecentGames GROUP BY ContentId').map(row => {
      const id = Number(row.ContentId); const raw = Number(row.LastPlayed)
      const date = raw ? new Date(raw / 10000 - 11644473600000).toISOString().slice(0, 10) : null
      return [id, { timesPlayed: Number(row.TimesPlayed), lastPlayed: date }]
    })) } catch { /* Optional Aurora table. */ }

    const knownDrives = ['Hdd1', 'Usb0', 'Usb1', 'Usb2', 'HddX']
    const probeOps: Array<Record<string, unknown>> = []
    const probes: Array<{ scanId: number; drive: string; expected: string; resultIndex: number }> = []
    const sampleDirectories = new Map<number, string>()
    for (const row of games) {
      const id = Number(row.ScanPathId) || 0
      const name = String(row.Directory || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
      if (id && name && !sampleDirectories.has(id)) sampleDirectories.set(id, name)
    }
    const scanPaths = new Map(scanRows.map(row => [Number(row.Id), String(row.Path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')]))
    for (const [scanId, scanPath] of scanPaths) {
      const sample = sampleDirectories.get(scanId) || scanPath
      const segments = sample.split('/').filter(Boolean)
      for (const drive of knownDrives) {
        probeOps.push({ op: 'cd', path: '/' }, { op: 'cd', path: drive })
        for (const segment of segments) probeOps.push({ op: 'cd', path: segment })
        const resultIndex = probeOps.length
        probeOps.push({ op: 'pwd' })
        probes.push({ scanId, drive, expected: `/${drive}/${segments.join('/')}`.replace(/\/+$/, ''), resultIndex })
      }
    }
    const driveByScanId = new Map<number, string>()
    if (probeOps.length) {
      const probeResults = await ftpBatch(ip, probeOps, 120000)
      for (const probe of probes) {
        if (driveByScanId.has(probe.scanId)) continue
        const pwd = probeResults[probe.resultIndex]?.data
        if (typeof pwd === 'string' && pwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === probe.expected.toLowerCase()) driveByScanId.set(probe.scanId, probe.drive)
      }
    }
    return games.filter(row => !hiddenIds.has(Number(row.Id))).map(row => {
      const id = Number(row.Id); const titleId = (Number(row.TitleId) >>> 0).toString(16).toUpperCase().padStart(8, '0')
      return {
        contentId: id, titleId, name: String(row.TitleName || titleId), description: String(row.Description || ''),
        publisher: String(row.Publisher || ''), developer: String(row.Developer || ''), releaseDate: String(row.ReleaseDate || ''),
        directory: String(row.Directory || ''), discNum: Number(row.DiscNum || 1), discsInSet: Number(row.DiscsInSet || 1),
        isFavorite: favoriteIds.has(id), timesPlayed: recent.get(id)?.timesPlayed || 0, lastPlayed: recent.get(id)?.lastPlayed || null,
        sourceDrive: driveByScanId.get(Number(row.ScanPathId)) || '', gameDataDir: `${titleId}_${id.toString(16).toUpperCase().padStart(8, '0')}`,
      }
    })
  } finally { contentDb.close(); settingsDb.close() }
}

const artworkSlots: Record<string, { slot: number; prefix: string; group?: 'GL' | 'SS' }> = {
  icon: { slot: 0, prefix: 'GL', group: 'GL' },
  banner: { slot: 1, prefix: 'GL', group: 'GL' },
  cover: { slot: 2, prefix: 'GC' },
  background: { slot: 4, prefix: 'BK' },
  screenshot1: { slot: 5, prefix: 'SS', group: 'SS' },
  screenshot2: { slot: 6, prefix: 'SS', group: 'SS' },
  screenshot3: { slot: 7, prefix: 'SS', group: 'SS' },
  screenshot4: { slot: 8, prefix: 'SS', group: 'SS' },
  screenshot5: { slot: 9, prefix: 'SS', group: 'SS' },
  screenshot6: { slot: 10, prefix: 'SS', group: 'SS' },
  screenshot7: { slot: 11, prefix: 'SS', group: 'SS' },
  screenshot8: { slot: 12, prefix: 'SS', group: 'SS' },
  screenshot9: { slot: 13, prefix: 'SS', group: 'SS' },
  screenshot10: { slot: 14, prefix: 'SS', group: 'SS' },
}
export const artworkTypes = Object.keys(artworkSlots)
const artworkTypeBySlot = new Map(Object.entries(artworkSlots).map(([type, info]) => [info.slot, type]))

export type ArtworkResult = { titleId: string; assetType: string; source: string; official: boolean; rating: number | null; image: string }

function binaryToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(binary)
}

function auroraGameDataPath(root: string, game: AuroraGame): string {
  return `${root.replace(/\\/g, '/').replace(/\/+$/, '')}/Data/GameData/${game.gameDataDir}`
}

async function decodeAuroraAsset(assetBytes: Uint8Array): Promise<Array<{ slot: number; png: string }>> {
  const response = await request('/rxea/decode', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: assetBytes.slice().buffer as ArrayBuffer }, apiBaseUrl, 120000)
  const data = await response.json() as { slots?: Array<{ slot: number; png: string }> }
  return Array.isArray(data.slots) ? data.slots : []
}

// Reads every artwork type Aurora stores for the game with one FTP batch. Missing or unreadable files are skipped.
export async function getAuroraArtworkSet(ip: string, root: string, game: AuroraGame): Promise<Record<string, string>> {
  const dir = auroraGameDataPath(root, game)
  const results = await ftpBatch(ip, ['BK', 'GC', 'GL', 'SS'].map(prefix => ({ op: 'download_base64', path: `${dir}/${prefix}${game.titleId}.asset` })), 120000)
  const found: Record<string, string> = {}
  await Promise.all(results.map(async result => {
    if (!result?.ok || typeof result.data !== 'string') return
    const assetBytes = fromBase64(result.data)
    if (assetBytes.length < 2048) return
    try {
      for (const slot of await decodeAuroraAsset(assetBytes)) {
        const type = artworkTypeBySlot.get(slot.slot)
        if (type && slot.png) found[type] = `data:image/png;base64,${slot.png}`
      }
    } catch { /* One undecodable asset should not hide the others. */ }
  }))
  return found
}

// Load only the cover asset for a visible library row.
export async function getAuroraCover(ip: string, root: string, game: AuroraGame): Promise<string | null> {
  const assetPath = `${auroraGameDataPath(root, game)}/GC${game.titleId}.asset`
  const result = (await ftpBatch(ip, [{ op: 'download_base64', path: assetPath }], 120000))[0]
  if (!result?.ok || typeof result.data !== 'string') return null
  const bytes = fromBase64(result.data)
  if (bytes.length < 2048) return null
  const slots = await decodeAuroraAsset(bytes)
  const cover = slots.find(slot => slot.slot === 2 && slot.png)
  return cover ? `data:image/png;base64,${cover.png}` : null
}

export async function searchArtwork(type: string, titleId: string, queryText: string): Promise<ArtworkResult[]> {
  const path = query('/webui/artwork/search', { type, title_id: titleId, query: queryText })
  const data = await (await request(path, undefined, apiBaseUrl, 60000)).json() as { results?: ArtworkResult[] }
  return Array.isArray(data.results) ? data.results : []
}

export async function uploadAuroraArtwork(ip: string, root: string, game: AuroraGame, type: string, image: Blob): Promise<void> {
  const info = artworkSlots[type]
  if (!info) throw new Error('Unknown Aurora artwork type.')
  if (!game.gameDataDir || !/^[0-9A-F]{8}$/i.test(game.titleId)) throw new Error('Aurora game database information is incomplete.')
  if (image.size > 16 * 1024 * 1024) throw new Error('Choose an image smaller than 16 MB.')
  const imageBytes = new Uint8Array(await image.arrayBuffer())
  const dir = auroraGameDataPath(root, game)
  const assetPath = `${dir}/${info.prefix}${game.titleId}.asset`
  let encodedAsset: Uint8Array
  if (info.group) {
    // Icon and banner share one file, as do the screenshots, so keep the slots that are not being replaced.
    const result = (await ftpBatch(ip, [{ op: 'download_base64', path: assetPath }], 120000))[0]
    const slots: Array<{ slot: number; png: string }> = []
    if (result?.ok && typeof result.data === 'string') {
      for (const slot of await decodeAuroraAsset(fromBase64(result.data))) if (slot.slot !== info.slot) slots.push({ slot: slot.slot, png: slot.png })
    }
    slots.push({ slot: info.slot, png: binaryToBase64(imageBytes) })
    const encoded = await request('/rxea/encode-multi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slots }) }, apiBaseUrl, 120000)
    encodedAsset = new Uint8Array(await encoded.arrayBuffer())
  } else {
    const encoded = await request(`/rxea/encode?slot=${info.slot}`, { method: 'POST', headers: { 'Content-Type': image.type || 'application/octet-stream' }, body: imageBytes.slice().buffer as ArrayBuffer }, apiBaseUrl, 120000)
    encodedAsset = new Uint8Array(await encoded.arrayBuffer())
  }
  const results = await ftpBatch(ip, [
    { op: 'ensure_dir', path: dir },
    { op: 'upload_base64', path: assetPath, data: binaryToBase64(encodedAsset) },
  ], 120000)
  if (!results[1]?.ok) throw new Error(results[1]?.error || 'Could not upload artwork to the Xbox.')
}

export async function browse(platform: string, source: Source): Promise<BrowseResult> {
  const path = query('/browse', { platform: source === 'local' ? 'local' : platform, source })
  const body = await (await request(path)).text()
  const match = /^__IA_LOADING__:(\d+)\/(\d+)/.exec(body)
  if (match) return { games: [], loading: { loaded: Number(match[1]), total: Number(match[2]) } }
  return { games: body.split('|').map(name => name.trim()).filter(Boolean) }
}

export async function getRomSystems(): Promise<Array<{ id: string; name: string }>> {
  const data = await (await request('/webui/rom-systems')).json() as { systems?: Array<{ id: string; name: string }> }
  return Array.isArray(data.systems) ? data.systems.filter(item => typeof item.id === 'string' && typeof item.name === 'string') : []
}

export async function getDrives(ip: string): Promise<string[]> {
  const data = await (await request(query('/ftp/drives', { ip }))).json()
  return Array.isArray(data.drives) ? data.drives.filter((drive: unknown): drive is string => typeof drive === 'string') : []
}

export async function pingXbox(ip: string): Promise<void> {
  await request('/ftp/ping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ip }),
  })
}

export async function testXboxCredentials(ip: string, user: string, password: string): Promise<{ ok: boolean; log: string[] }> {
  return jsonRequest('/ftp/test', { ip, user, password }, 'POST', 30000)
}

export type DiscInfo = { recommendation?: InstallType; notes?: string; title_id?: string; disc_number?: number; disc_count?: number; probed?: boolean }
export async function getDiscInfo(game: string): Promise<DiscInfo | null> {
  try {
    return await (await request(query('/disc-info', { game }))).json()
  } catch {
    return null
  }
}

export async function queueGame(args: {
  game: string; platform: string; source: Source; ip: string; drive: string; installType: InstallType
}): Promise<string> {
  const { game, platform, source, ip, drive, installType } = args
  const registration = await (await request(query('/register', {
    game, ip, drive, platform: source === 'local' ? 'local' : platform,
    mode: 'ftp', install_type: installType,
  }))).json()
  if (registration.error) throw new Error(registration.error)
  const result = await (await request(query('/trigger', {
    game, platform: source === 'local' ? 'local' : platform,
    source, install_type: installType,
  }))).json()
  if (result.error) throw new Error(result.error)
  if (result.status === 'local_unavailable') throw new ApiError('localUnavailable')
  return result.status || 'triggered'
}

export type QueueItem = { id: string; game: string; platform: string; source: Source; ip: string; drive: string; installType: InstallType; held: boolean; error?: string }
export type SchedulerState = { paused: boolean; maxConcurrent: number; wishlist: QueueItem[]; pending: QueueItem[]; skipped?: string[] }
export type QueueEntry = { game: string; platform: string; source: Source; ip: string; drive: string; installType: InstallType }
export type SchedulerAction =
  | { action: 'enqueue' | 'wishlist_add'; item: { game: string; platform: string; source: string; ip: string; drive: string; installType: string } }
  | { action: 'wishlist_send'; ids?: string[] }
  | { action: 'wishlist_update'; id: string; drive?: string; installType?: InstallType }
  | { action: 'move'; id: string; direction: 'up' | 'down' | 'top' | 'bottom' }
  | { action: 'remove' | 'hold' | 'unhold' | 'start' | 'to_wishlist' | 'wishlist_remove'; id: string }
  | { action: 'set_max'; value: number }
  | { action: 'pause' | 'resume' | 'clear_finished' | 'clear_pending' | 'wishlist_clear' }

export async function getSchedulerState(): Promise<SchedulerState> {
  return (await request('/webui/queue/state')).json()
}

export async function schedulerAction(action: SchedulerAction): Promise<SchedulerState> {
  return jsonRequest<SchedulerState>('/webui/queue/action', action, 'POST', 30000)
}

function queueEntryBody(entry: QueueEntry) {
  return { game: entry.game, platform: entry.source === 'local' ? 'local' : entry.platform, source: entry.source, ip: entry.ip, drive: entry.drive, installType: entry.installType }
}

export async function addToWishlist(entry: QueueEntry): Promise<void> {
  await schedulerAction({ action: 'wishlist_add', item: queueEntryBody(entry) })
}

// Adds a game to the waiting queue, which starts it as soon as GODsend has room. A GODsend without the
// scheduler (older or unpatched build) does not have that route, so start the game directly instead.
export async function enqueueGame(entry: QueueEntry): Promise<string> {
  try {
    await schedulerAction({ action: 'enqueue', item: queueEntryBody(entry) })
    return 'queued'
  } catch (error) {
    if (!(error instanceof HttpError) || (error.status !== 404 && error.status !== 405)) throw error
    return queueGame({ game: entry.game, platform: entry.platform, source: entry.source, ip: entry.ip, drive: entry.drive, installType: entry.installType })
  }
}

// XMLHttpRequest instead of fetch: it is the only way a browser reports upload progress.
export function uploadIso(file: File, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<Array<{ name: string; size: number }>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const body = new FormData()
    body.append('files', file, file.name)
    xhr.open('POST', apiBaseUrl ? new URL('/webui/upload-iso', `${apiBaseUrl}/`).toString() : '/webui/upload-iso')
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded / event.total) }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { const data = JSON.parse(xhr.responseText) as { files?: Array<{ name: string; size: number }> }; onProgress(1); resolve(data.files || []) }
        catch { reject(new Error('Invalid ISO upload response.')) }
        return
      }
      let detail = `${xhr.status} ${xhr.statusText}`
      try { const parsed = JSON.parse(xhr.responseText); detail = parsed.message || parsed.error || detail } catch { /* Plain-text error. */ }
      reject(new HttpError(detail, xhr.status))
    }
    xhr.onerror = () => reject(new ApiError('network'))
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'))
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    if (signal?.aborted) { reject(new DOMException('Upload cancelled', 'AbortError')); return }
    xhr.send(body)
  })
}

export async function importIsoFromUrl(url: string): Promise<{ name: string; size: number }> {
  return jsonRequest('/webui/import-iso', { url }, 'POST', 60 * 60 * 1000)
}

export async function getServerPaths(): Promise<{ transfer_dir: string; ready_dir: string }> {
  return (await request('/webui/paths')).json()
}

export async function getFtpJobs(): Promise<FtpJob[]> {
  const data = await (await request('/ftp/jobs')).json()
  return Array.isArray(data?.jobs) ? data.jobs : []
}

export async function listFtp(ip: string, path: string): Promise<{ entries: FtpEntry[]; cwd: string }> {
  const data = await jsonRequest<{ entries?: FtpEntry[]; cwd?: string }>('/ftp/list', { ip, path })
  return { entries: Array.isArray(data.entries) ? data.entries : [], cwd: data.cwd || path }
}

export async function mkdirFtp(ip: string, path: string): Promise<void> { await jsonRequest('/ftp/mkdir', { ip, path }) }
export async function deleteFtp(ip: string, path: string): Promise<void> { await jsonRequest('/ftp/delete', { ip, path }) }
export async function renameFtp(ip: string, from: string, to: string): Promise<void> { await jsonRequest('/ftp/rename', { ip, from, to }) }
export async function copyFtp(ip: string, src: string, dst: string, isDir: boolean): Promise<void> { await jsonRequest('/ftp/copy', { ip, src, dst, is_dir: isDir }) }
export async function uploadFtp(ip: string, localPaths: string[], remotePath: string): Promise<void> { await jsonRequest('/ftp/upload', { ip, local_paths: localPaths, remote_path: remotePath }) }
export async function removeFtpJob(id: number): Promise<void> { await request(query('/ftp/jobs/remove', { id: String(id) }), { method: 'DELETE' }) }

export async function getContent(titleId: string, gameName: string, xboxIp: string, drive: string): Promise<ContentManifest> {
  return (await request(query('/content/discover', { title_id: titleId, game_name: gameName, xbox_ip: xboxIp, drive }))).json()
}
export async function getTitleUpdates(titleId: string): Promise<ContentItem[]> {
  const data = await (await request(query('/content/tu', { title_id: titleId }))).json()
  return Array.isArray(data.title_updates) ? data.title_updates : []
}
export async function queueContent(item: ContentItem, gameName: string, xboxIp: string, drive: string): Promise<void> {
  await jsonRequest('/content/queue', { game_name: gameName, title_id: item.title_id, content_type: item.content_type, display_name: item.display_name, file_name: item.file_name, source: item.source, source_url: item.source_url, xbox_ip: xboxIp, drive })
}
export async function setTitleUpdateActive(item: ContentItem, xboxIp: string, drive: string, setActive: boolean): Promise<void> {
  await jsonRequest('/content/set-active', { title_id: item.title_id, content_type: item.content_type, file_name: item.file_name, xbox_ip: xboxIp, drive, set_active: setActive })
}

function installedContentPath(item: ContentItem, fallbackDrive: string): string {
  const drive = (item.drive || fallbackDrive).replace(/:$/, '')
  if (!item.installed || !/^[A-Za-z0-9]+$/.test(drive) || !/^[0-9A-F]{8}$/i.test(item.title_id) || !/^[0-9A-F]{8}$/i.test(item.content_type) || !item.file_name || /[/\\]/.test(item.file_name) || item.file_name === '.' || item.file_name === '..') throw new Error('Installed content path is invalid.')
  return `/${drive}/Content/0000000000000000/${item.title_id}/${item.content_type}/${item.file_name}`
}

export async function deleteInstalledContent(item: ContentItem, xboxIp: string, fallbackDrive: string): Promise<void> {
  await deleteFtp(xboxIp, installedContentPath(item, fallbackDrive))
}

export async function moveInstalledContent(item: ContentItem, xboxIp: string, fallbackDrive: string, targetDrive: string): Promise<void> {
  const source = installedContentPath(item, fallbackDrive)
  const target = targetDrive.replace(/:$/, '')
  if (!/^[A-Za-z0-9]+$/.test(target) || target.toLowerCase() === source.split('/')[1].toLowerCase()) throw new Error('Choose another Xbox drive.')
  const destination = `/${target}/Content/0000000000000000/${item.title_id}/${item.content_type}`
  await mkdirFtp(xboxIp, destination)
  await renameFtp(xboxIp, source, `${destination}/${item.file_name}`)
}

export async function discoverSaves(ip: string, drive: string, titleId = ''): Promise<SaveProfile[]> {
  const data = await (await request(query('/saves/discover', { ip, drive, title_id: titleId }))).json()
  return Array.isArray(data.profiles) ? data.profiles : []
}
export async function listSaves(ip: string, drive: string, titleId: string, profileId: string): Promise<SaveEntry[]> {
  const data = await (await request(query('/saves/list', { ip, drive, title_id: titleId, profile_id: profileId }))).json()
  return Array.isArray(data.entries) ? data.entries : []
}
export async function backupAllSaves(ip: string, drive: string): Promise<void> { await jsonRequest('/saves/backup-all', { ip, drive }, 'POST', 60 * 60 * 1000) }
export async function downloadSave(ip: string, drive: string, titleId: string, profileId: string, gameName: string): Promise<void> { await jsonRequest('/saves/download', { ip, drive, title_id: titleId, profile_id: profileId, game_name: gameName }, 'POST', 30 * 60 * 1000) }
export async function deleteSave(ip: string, drive: string, titleId: string, profileId: string): Promise<void> { await jsonRequest('/saves/delete', { ip, drive, title_id: titleId, profile_id: profileId }) }
export async function copySave(ip: string, drive: string, titleId: string, srcProfile: string, dstProfile: string, useKeyVault: boolean): Promise<void> {
  await jsonRequest('/saves/copy', { ip, drive, title_id: titleId, src_profile: srcProfile, dst_profile: dstProfile, use_keyvault: useKeyVault })
}

export type IsoInfo = { titleId: string; mediaId: string; discNumber: number; discCount: number; isOriginalXbox: boolean; displayName: string }
export async function probeIso(isoPath: string): Promise<IsoInfo> { return jsonRequest('/tools/probe-iso', { isoPath }, 'POST', 120000) }
export async function convertIso(format: 'god' | 'xex', isoPath: string, outDir: string): Promise<{ displayName: string; outputDir: string }> { return jsonRequest(`/tools/iso2${format}`, { isoPath, outDir }, 'POST', 60 * 60 * 1000) }
