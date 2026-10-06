import ExcelJS from 'exceljs'
import { zipSync, strToU8 } from 'fflate'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Production } from '../shared/model'
import type { DocumentStorage } from './storage'
import { startHerePdf } from './start-here-pdf'
export async function excelIndex(p: Production, simple = false) {
  const workbook = new ExcelJS.Workbook(); workbook.creator='SDF Production'
  const sheet=workbook.addWorksheet('Bates Index', { views:[{state:'frozen',ySplit:1}] })
  sheet.columns=[{header:'Document Name',key:'name',width:65},{header:'Starting Bates Number',key:'first',width:25},{header:'Ending Bates Number',key:'last',width:25},...(!simple ? [{header:'Page Count',key:'pages',width:14},{header:'Description',key:'description',width:50},{header:'Document Date',key:'date',width:18},{header:'Tags',key:'tags',width:40}] : [])]
  for (const d of p.documents) sheet.addRow({name:d.displayName,first:d.firstBates??'',last:d.lastBates??'',pages:d.pageCount,description:d.description,date:d.documentDate,tags:p.tags.filter(t=>d.tagIds.includes(t.id)).map(t=>t.name).join('; ')})
  sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}}; sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF0F1923'}}
  sheet.autoFilter={from:'A1',to:simple ? 'C1' : 'G1'}
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
export async function offlinePackage(p: Production, storage: DocumentStorage) {
  const files: Record<string,Uint8Array>={}
  for (const d of p.documents) files[`Production/PDFs/${d.finalName}`]=await storage.get(d.processedKey!)
  files['Production/Bates Index.xlsx']=await excelIndex(p)
  for(const file of ['index.html','app.js','app.css']) files[`Production/${file==='index.html' ? file : 'assets/'+file}`]=await readFile(resolve('offline',file))
  for(const file of ['sdf-tokens.css','sdf-base.css','source-sans-3-latin.woff2','sdflaw-logo-white.png']) files[`Production/assets/${file}`]=await readFile(resolve('public/sdf-ui',file))
  const data={name:p.name,matter:p.matter,at:new Date().toISOString(),tags:p.tags,documents:p.documents.map(({id,displayName,description,documentDate,tagIds,firstBates,lastBates,firstNumber,lastNumber,pageCount,finalName})=>({id,displayName,description,documentDate,tagIds,firstBates,lastBates,firstNumber,lastNumber,pageCount,path:`PDFs/${encodeURIComponent(finalName!)}`}))}
  // A plain script loads on file:// without fetch, module imports, or CORS permission.
  files['Production/assets/data.js']=strToU8(`window.PRODUCTION=${JSON.stringify(data).replace(/</g,'\\u003c')};`)
  files['Production/Start Here.pdf']=await startHerePdf(p)
  return Buffer.from(zipSync(files,{level:1}))
}
