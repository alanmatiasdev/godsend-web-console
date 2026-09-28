export type Source = 'local' | 'minerva' | 'ia'
export type InstallType = 'god' | 'content' | 'xex'
export type Job = { game: string; state: string; message: string }
export type ServerConfig = { default_drive?: string; custom_god_path?: string; custom_xex_path?: string }
export type BrowseResult = { games: string[]; loading?: { loaded: number; total: number } }
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
