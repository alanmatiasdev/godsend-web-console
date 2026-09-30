import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const project = path.resolve(here, '..')
const upstream = process.argv[2] && path.resolve(process.argv[2])

if (!upstream) {
  console.error('Usage: npm run integrate -- /path/to/GODSend-360')
  process.exit(1)
}

const dist = path.join(project, 'dist')
const handlers = path.join(upstream, 'src/server/interfaces/http')
const router = path.join(handlers, 'router.go')
const middleware = path.join(handlers, 'middleware.go')
const assets = path.join(handlers, 'webui')
const appSourcePath = path.join(upstream, 'src/server/app/app.go')

try {
  await stat(path.join(dist, 'index.html'))
  await stat(router)
  await stat(middleware)
  await stat(appSourcePath)
  const source = await readFile(router, 'utf8')
  const middlewareSource = await readFile(middleware, 'utf8')
  const appSource = await readFile(appSourcePath, 'utf8')
  const marker = '\tregisterWebUI(mux)\n'
  const routes = [
    '\tmux.HandleFunc("/webui/logs", d.wrap(d.handleWebUILogs))\n',
    '\tmux.HandleFunc("/webui/artwork/sync", d.wrap(d.handleWebUIArtworkSync))\n',
    '\tmux.HandleFunc("/webui/artwork/config", d.wrap(d.handleWebUIArtworkConfig))\n',
    '\tmux.HandleFunc("/webui/artwork/thumbnail", d.wrap(d.handleWebUIThumbnail))\n',
    '\tmux.HandleFunc("/webui/upload-file", d.wrap(d.handleWebUIUpload))\n',
    '\tmux.HandleFunc("/webui/download-file", d.wrap(d.handleWebUIDownload))\n',
    '\tmux.HandleFunc("/webui/archive", d.wrap(d.handleWebUIArchive))\n',
    '\tmux.HandleFunc("/webui/rom-systems", d.wrap(d.handleWebUIRomSystems))\n',
    '\tmux.HandleFunc("/webui/paths", d.wrap(d.handleWebUIPaths))\n',
    '\tmux.HandleFunc("/webui/artwork/search", d.wrap(d.handleWebUIArtworkSearch))\n',
    '\tmux.HandleFunc("/webui/unity-archive/title", d.wrap(d.handleWebUIUnityArchive))\n',
    '\tmux.HandleFunc("/webui/unity-archive/cover", d.wrap(d.handleWebUIUnityArchive))\n',
    '\tmux.HandleFunc("/webui/unity-archive/icon", d.wrap(d.handleWebUIUnityArchive))\n',
    '\tmux.HandleFunc("/webui/upload-iso", d.wrap(d.handleWebUIUploadISO))\n',
    '\tmux.HandleFunc("/webui/import-iso", d.wrap(d.handleWebUIImportISO))\n',
    '\tmux.HandleFunc("/webui/queue/state", d.wrap(d.handleWebUIQueueState))\n',
    '\tmux.HandleFunc("/webui/queue/action", d.wrap(d.handleWebUIQueueAction))\n',
  ]
  const anchor = '\treturn mux\n'
  const corsMarker = '\t\twebCORS(w, r)\n'
  const corsAnchor = '\treturn func(w stdhttp.ResponseWriter, r *stdhttp.Request) {\n'
  if (!source.includes(marker) && !source.includes(anchor)) {
    throw new Error('Could not find the integration point in router.go. Check the GODsend version.')
  }
  if (!middlewareSource.includes(corsMarker) && !middlewareSource.includes(corsAnchor)) {
    throw new Error('Could not find the middleware integration point. Check the GODsend version.')
  }

  await rm(assets, { recursive: true, force: true })
  await mkdir(assets, { recursive: true })
  await cp(dist, assets, { recursive: true })
  await cp(path.join(project, 'integration/serve_webui.go'), path.join(handlers, 'serve_webui.go'))
  await cp(path.join(project, 'integration/serve_webui_test.go'), path.join(handlers, 'serve_webui_test.go'))
  await cp(path.join(project, 'integration/app_webui_events.go'), path.join(upstream, 'src/server/app/webui_events.go'))
  for (const file of ['webui_upload.go', 'webui_download.go', 'webui_archive.go', 'webui_archive_test.go', 'webui_roms.go', 'webui_paths.go', 'webui_logs.go', 'webui_artwork.go', 'webui_artwork_sync.go', 'webui_thumbnail.go', 'webui_artwork_test.go', 'webui_unity_archive.go', 'webui_unity_archive_test.go', 'webui_iso_upload.go', 'webui_remote_import.go', 'webui_queue.go', 'webui_queue_test.go']) {
    await cp(path.join(project, 'integration', file), path.join(handlers, file))
  }
  await cp(path.join(project, 'aurora-scripts/ArchiveFallback'), path.join(upstream, 'aurora-scripts-archive-fallback'), { recursive: true, force: true })
  let updatedRouter = source
  for (const route of routes) {
    if (updatedRouter.includes(route)) continue
    const insertionPoint = updatedRouter.includes(marker) ? marker : anchor
    updatedRouter = updatedRouter.replace(insertionPoint, `${route}${insertionPoint}`)
  }
  if (!updatedRouter.includes(marker)) updatedRouter = updatedRouter.replace(anchor, `${marker}${anchor}`)
  if (updatedRouter !== source) await writeFile(router, updatedRouter)
  const hookMarker = '\td.installWebUIHooks()\n'
  if (!updatedRouter.includes(hookMarker)) {
    const hooked = updatedRouter.replace('\tregisterWebUI(mux)\n', `${hookMarker}\tregisterWebUI(mux)\n`)
    if (hooked === updatedRouter) throw new Error('Could not install Web UI hooks in router.go.')
    await writeFile(router, hooked)
  }
  let updatedApp = appSource
  const oldLog = '\tfmt.Printf("[%s] "+format+"\\n", append([]interface{}{time.Now().Format("15:04:05")}, args...)...)'
  const newLog = '\tline := fmt.Sprintf("[%s] "+format, append([]interface{}{time.Now().Format("15:04:05")}, args...)...)\n\tfmt.Println(line)\n\tAppendWebUILog(line)'
  if (!updatedApp.includes(newLog)) updatedApp = updatedApp.replace(oldLog, newLog)
  if (!updatedApp.includes(newLog)) throw new Error('Could not add the Web UI log buffer to app.go.')
  const ftpEvent = '\tfmt.Printf("GODSEND_FTP_COMPLETE:%s\\n", data)'
  const ftpHook = `${ftpEvent}\n\tNotifyWebUIFTPComplete(gameName, titleID, xboxIP)`
  if (!updatedApp.includes(ftpHook)) updatedApp = updatedApp.replace(ftpEvent, ftpHook)
  if (!updatedApp.includes(ftpHook)) throw new Error('Could not add the Web UI FTP completion hook to app.go.')
  if (updatedApp !== appSource) await writeFile(appSourcePath, updatedApp)
  if (!middlewareSource.includes(corsMarker)) {
    const preflight = `${corsMarker}\t\tif r.Method == stdhttp.MethodOptions {\n\t\t\tw.WriteHeader(stdhttp.StatusNoContent)\n\t\t\treturn\n\t\t}\n`
    await writeFile(middleware, middlewareSource.replace(corsAnchor, `${corsAnchor}${preflight}`))
  }
  console.log(`Web UI integrated into ${upstream}. Build the Go backend to serve /ui/.`)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
