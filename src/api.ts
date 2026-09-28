export type Source = 'local' | 'minerva' | 'ia'
export type InstallType = 'god' | 'content' | 'xex'
export type Job = { game: string; state: string; message: string }
export type ServerConfig = { default_drive?: string; custom_god_path?: string; custom_xex_path?: string }
export type BrowseResult = { games: string[]; loading?: { loaded: number; total: number } }
export type FtpEntry = { name: string; type: 'dir' | 'file'; size?: number }
export type FtpJob = { id: number; name: string; state: string; progress?: number; error?: string }
export type ContentItem = { title_id: string; content_type: string; display_name: string; file_name: string; size?: number; version?: number; source: string; source_url?: string; installed: boolean; active: boolean; drive?: string }
export type ContentManifest = { title_id: string; game_name?: string; dlcs?: ContentItem[]; title_updates?: ContentItem[] }
export type SaveProfile = { profile_id: string; profile_name: string; save_count?: number; last_modified?: string }
export type SaveEntry = { name: string; size: number }
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

async function request(path: string, init?: RequestInit, baseUrl = apiBaseUrl): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)
  try {
    const response = await fetch(baseUrl ? new URL(path, `${baseUrl}/`).toString() : path, { ...init, signal: controller.signal, cache: 'no-store' })
    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`
      try {
        const error = await response.json()
        detail = error.message || error.error || detail
      } catch { /* A plain-text response is valid for some routes. */ }
      throw new Error(detail)
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

async function jsonRequest<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await request(path, body === undefined ? undefined : {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return response.json() as Promise<T>
}

function query(path: string, params: Record<string, string>): string {
  return `${path}?${new URLSearchParams(params)}`
}

export async function getConfig(baseUrl?: string): Promise<ServerConfig> {
  return (await request('/config', undefined, baseUrl)).json()
}

export async function getQueue(): Promise<Job[]> {
  const data: unknown = await (await request('/queue')).json()
  return Array.isArray(data) ? data.filter((item): item is Job =>
    typeof item?.game === 'string' && typeof item?.state === 'string' && typeof item?.message === 'string') : []
}

export async function browse(platform: string, source: Source): Promise<BrowseResult> {
  const path = query('/browse', { platform: source === 'local' ? 'local' : platform, source })
  const body = await (await request(path)).text()
  const match = /^__IA_LOADING__:(\d+)\/(\d+)/.exec(body)
  if (match) return { games: [], loading: { loaded: Number(match[1]), total: Number(match[2]) } }
  return { games: body.split('|').map(name => name.trim()).filter(Boolean) }
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

export async function getDiscInfo(game: string): Promise<{ recommendation?: InstallType; notes?: string } | null> {
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

export async function discoverSaves(ip: string, drive: string, titleId = ''): Promise<SaveProfile[]> {
  const data = await (await request(query('/saves/discover', { ip, drive, title_id: titleId }))).json()
  return Array.isArray(data.profiles) ? data.profiles : []
}
export async function listSaves(ip: string, drive: string, titleId: string, profileId: string): Promise<SaveEntry[]> {
  const data = await (await request(query('/saves/list', { ip, drive, title_id: titleId, profile_id: profileId }))).json()
  return Array.isArray(data.entries) ? data.entries : []
}
export async function backupAllSaves(ip: string, drive: string): Promise<void> { await jsonRequest('/saves/backup-all', { ip, drive }) }
export async function downloadSave(ip: string, drive: string, titleId: string, profileId: string, gameName: string): Promise<void> { await jsonRequest('/saves/download', { ip, drive, title_id: titleId, profile_id: profileId, game_name: gameName }) }
export async function deleteSave(ip: string, drive: string, titleId: string, profileId: string): Promise<void> { await jsonRequest('/saves/delete', { ip, drive, title_id: titleId, profile_id: profileId }) }

export type IsoInfo = { titleId: string; mediaId: string; discNumber: number; discCount: number; isOriginalXbox: boolean; displayName: string }
export async function probeIso(isoPath: string): Promise<IsoInfo> { return jsonRequest('/tools/probe-iso', { isoPath }) }
export async function convertIso(format: 'god' | 'xex', isoPath: string, outDir: string): Promise<{ displayName: string; outputDir: string }> { return jsonRequest(`/tools/iso2${format}`, { isoPath, outDir }) }
