import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
const root=resolve('shared/sdf-pdf')
const manifest=JSON.parse((await readFile(resolve(root,'source-hashes.json'),'utf8')).replace(/^\uFEFF/,''))
let failures=0
for(const [file,hash] of Object.entries(manifest)){
  const local=createHash('sha256').update(await readFile(resolve(root,file))).digest('hex')
  if(local!==hash){console.error(`Modified engine source: ${file}`);failures++}
  if(process.argv[2]){const upstream=createHash('sha256').update(await readFile(resolve(process.argv[2],file))).digest('hex');if(upstream!==hash){console.error(`Upstream has changed: ${file}`);failures++}}
}
if(failures)process.exitCode=1;else console.log(`Verified ${Object.keys(manifest).length} unchanged SDF PDF source/test files.`)
