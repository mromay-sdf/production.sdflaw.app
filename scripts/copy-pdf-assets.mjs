import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { cp, mkdir } from 'node:fs/promises'
const require=createRequire(import.meta.url)
const root=dirname(require.resolve('pdfjs-dist/package.json'))
for(const name of ['standard_fonts','cmaps','wasm']){const dest=resolve('public/pdfjs',name);await mkdir(dest,{recursive:true});await cp(resolve(root,name),dest,{recursive:true})}
