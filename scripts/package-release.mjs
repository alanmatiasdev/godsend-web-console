import { cp, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'))
const output = path.resolve(process.argv[2] || path.join(project, 'release'))
const name = `godsend-web-console-v${version}`
const staging = await mkdtemp(path.join(tmpdir(), 'godsend-release-'))

try {
  await stat(path.join(project, 'dist/index.html'))
  await mkdir(output, { recursive: true })
  const root = path.join(staging, name)
  await mkdir(root)
  for (const entry of ['README.md', 'dist', 'integration', 'aurora-scripts', 'scripts/integrate.mjs']) {
    const destination = path.join(root, entry)
    await mkdir(path.dirname(destination), { recursive: true })
    await cp(path.join(project, entry), destination, { recursive: true })
  }
  await new Promise((resolve, reject) => {
    const command = spawn('tar', ['czf', path.join(output, `${name}.tar.gz`), '-C', staging, name], { stdio: 'inherit' })
    command.on('error', reject)
    command.on('exit', code => code === 0 ? resolve() : reject(new Error(`tar exited with ${code}`)))
  })
  console.log(`Created ${path.join(output, `${name}.tar.gz`)}`)
} finally {
  await rm(staging, { recursive: true, force: true })
}
