import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const project = path.resolve(here, '..')
const upstream = process.argv[2] && path.resolve(process.argv[2])

if (!upstream) {
  console.error('Uso: npm run integrate -- /caminho/para/GODSend-360')
  process.exit(1)
}

const dist = path.join(project, 'dist')
const handlers = path.join(upstream, 'src/server/interfaces/http')
const router = path.join(handlers, 'router.go')
const assets = path.join(handlers, 'webui')

try {
  await stat(path.join(dist, 'index.html'))
  await stat(router)
  const source = await readFile(router, 'utf8')
  const marker = '\tregisterWebUI(mux)\n'
  const anchor = '\treturn mux\n'
  if (!source.includes(marker) && !source.includes(anchor)) {
    throw new Error('Não foi possível localizar o ponto de integração em router.go. Verifique a versão do GODSend.')
  }

  await rm(assets, { recursive: true, force: true })
  await mkdir(assets, { recursive: true })
  await cp(dist, assets, { recursive: true })
  await cp(path.join(project, 'integration/serve_webui.go'), path.join(handlers, 'serve_webui.go'))
  await cp(path.join(project, 'integration/serve_webui_test.go'), path.join(handlers, 'serve_webui_test.go'))
  if (!source.includes(marker)) await writeFile(router, source.replace(anchor, `${marker}${anchor}`))
  console.log(`Interface incorporada em ${upstream}. Compile o backend Go para servir /ui/.`)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
