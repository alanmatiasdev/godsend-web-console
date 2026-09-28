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

try {
  await stat(path.join(dist, 'index.html'))
  await stat(router)
  await stat(middleware)
  const source = await readFile(router, 'utf8')
  const middlewareSource = await readFile(middleware, 'utf8')
  const marker = '\tregisterWebUI(mux)\n'
  const routes = [
    '\tmux.HandleFunc("/webui/upload-file", d.wrap(d.handleWebUIUpload))\n',
    '\tmux.HandleFunc("/webui/artwork/search", d.wrap(d.handleWebUIArtworkSearch))\n',
    '\tmux.HandleFunc("/webui/upload-iso", d.wrap(d.handleWebUIUploadISO))\n',
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
  for (const file of ['webui_upload.go', 'webui_artwork.go', 'webui_artwork_test.go', 'webui_iso_upload.go', 'webui_queue.go', 'webui_queue_test.go']) {
    await cp(path.join(project, 'integration', file), path.join(handlers, file))
  }
  let updatedRouter = source
  for (const route of routes) {
    if (updatedRouter.includes(route)) continue
    const insertionPoint = updatedRouter.includes(marker) ? marker : anchor
    updatedRouter = updatedRouter.replace(insertionPoint, `${route}${insertionPoint}`)
  }
  if (!updatedRouter.includes(marker)) updatedRouter = updatedRouter.replace(anchor, `${marker}${anchor}`)
  if (updatedRouter !== source) await writeFile(router, updatedRouter)
  if (!middlewareSource.includes(corsMarker)) {
    const preflight = `${corsMarker}\t\tif r.Method == stdhttp.MethodOptions {\n\t\t\tw.WriteHeader(stdhttp.StatusNoContent)\n\t\t\treturn\n\t\t}\n`
    await writeFile(middleware, middlewareSource.replace(corsAnchor, `${corsAnchor}${preflight}`))
  }
  console.log(`Web UI integrated into ${upstream}. Build the Go backend to serve /ui/.`)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
