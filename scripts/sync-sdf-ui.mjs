import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Updates are explicit; normal builds use the reviewed, committed snapshot.
const lock = JSON.parse(await readFile('sdf-ui.lock.json', 'utf8'))
const revision = process.argv[2] || lock.revision
const checkout = await mkdtemp(join(tmpdir(), 'sdf-ui-sync-'))
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
git('clone', '--no-checkout', lock.repository, checkout)
git('-C', checkout, 'checkout', '--detach', revision)
const commit = git('-C', checkout, 'rev-parse', 'HEAD')
await mkdir('vendor/sdf-ui/public', { recursive: true })
await copyFile(join(checkout, 'src/index.css'), 'vendor/sdf-ui/index.css')
for (const file of ['sdflaw-logo-white.png', 'sdflaw-logo-black.png']) {
  const bytes = await readFile(join(checkout, 'public', file))
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`Invalid PNG: ${file}`)
  await writeFile(join('vendor/sdf-ui/public', file), bytes)
}
await writeFile('sdf-ui.lock.json', JSON.stringify({ repository: lock.repository, revision: commit }, null, 2) + '\n')
await import('./build-sdf-ui.mjs')
console.log(`SDF UI synchronized at ${commit}. Review and commit the snapshot and lockfile. Checkout retained at ${checkout}`)
