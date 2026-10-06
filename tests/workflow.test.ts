import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { PDFDocument, degrees } from 'pdf-lib'
import { unzipSync, strFromU8 } from 'fflate'
import ExcelJS from 'exceljs'
import { Store } from '../server/store'
import { PrivateStorage } from '../server/storage'
import { createApp } from '../server/app'
import { defaultBates, matchesDocument, type Production } from '../shared/model'
import { validate } from '../server/workflow'
import { cleanupDeletedFiles } from '../server/cleanup'

let root:string,store:Store,storage:PrivateStorage,server:Server,base:string,p:Production
const origin='http://127.0.0.1:4180'
async function call(path:string,body?:unknown,rev?:number){return fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',...(rev?{'If-Match':String(rev)}:{})},body:body===undefined?undefined:JSON.stringify(body)})}
async function mutate(path:string,body:unknown){const r=await call(`/productions/${p.id}/${path}`,body,p.revision);expect(r.status,await r.clone().text()).toBe(200);p=await r.json();return p}
beforeAll(async()=>{
  root=await mkdtemp(join(tmpdir(),'sdf-production-'));store=new Store(undefined,root);await store.init();storage=new PrivateStorage(join(root,'blobs'))
  server=createApp(store,storage,{dev:true,origin}).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));base=`http://127.0.0.1:${(server.address() as any).port}`
})
afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));await store.close();await rm(root,{recursive:true,force:true})})
describe.sequential('Persistent production workflow',()=>{
  it('creates an opaque persistent production and rejects foreign-origin writes',async()=>{
    const rejected=await fetch(base+'/api/productions',{method:'POST',headers:{Origin:'https://attacker.invalid','Content-Type':'application/json'},body:JSON.stringify({name:'No',matter:'No'})});expect(rejected.status).toBe(403)
    const r=await call('/productions',{name:'Test production',matter:'Synthetic matter',description:''});expect(r.status).toBe(201);p=await r.json();expect(p.id).toMatch(/^[a-f0-9-]{36}$/)
    const reopened=new Store(undefined,root);await reopened.init();expect((await reopened.get(p.id)).name).toBe(p.name);await reopened.close()
  })
  it('preserves originals, detects unreadable PDFs, and blocks publication before labeling',async()=>{
    const bytes=Buffer.from('%PDF-1.7\ncorrupt')
    const response=await fetch(`${base}/api/productions/${p.id}/documents`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/pdf','X-File-Name':'bad.pdf','If-Match':String(p.revision)},body:bytes});expect(response.status).toBe(200);p=await response.json();expect(p.documents[0].status).toBe('Unreadable')
    expect((await call(`/productions/${p.id}/publish`,{},p.revision)).status).toBe(400)
    await mutate('actions',{type:'remove',ids:[p.documents[0].id]})
  })
  it('uploads mixed-size rotated source PDFs and reports duplicate names',async()=>{
    for(let i=0;i<2;i++){
      const pdf=await PDFDocument.create();const portrait=pdf.addPage([612,792]);portrait.drawText('Synthetic source '+i,{x:60,y:700});const rotated=pdf.addPage([792,612]);rotated.setRotation(degrees(90));rotated.setCropBox(20,10,750,580)
      const bytes=await pdf.save();const r=await fetch(`${base}/api/productions/${p.id}/documents`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/pdf','X-File-Name':encodeURIComponent('Records #1 & test.pdf'),'If-Match':String(p.revision)},body:Buffer.from(bytes)});expect(r.status).toBe(200);p=await r.json();expect(p.documents.at(-1)?.pageCount).toBe(2)
      expect(Buffer.compare(await storage.get(p.documents.at(-1)!.originalKey),Buffer.from(bytes))).toBe(0)
    }
  })
  it('rejects stale revisions and invalid document reorders',async()=>{
    expect((await call(`/productions/${p.id}/actions`,{type:'reorder',ids:[]},p.revision)).status).toBe(400)
    expect((await call(`/productions/${p.id}/actions`,{type:'tag-create',name:'No'},1)).status).toBe(409)
  })
  it('labels once using inherited engine and validates continuous ranges',async()=>{
    await mutate('bates',{settings:defaultBates,combined:true})
    expect(p.documents.map(d=>[d.firstBates,d.lastBates])).toEqual([['SDF_000001','SDF_000002'],['SDF_000003','SDF_000004']])
    expect(p.documents[0].finalName).not.toBe(p.documents[1].finalName)
    expect((await PDFDocument.load(await storage.get(p.combinedKey!))).getPageCount()).toBe(4)
    const original=await storage.get(p.documents[0].originalKey),output=await storage.get(p.documents[0].processedKey!);expect(Buffer.compare(original,output)).not.toBe(0)
    await mutate('validate',{});expect(p.validation?.checks.some(c=>c.status==='error')).toBe(false);expect(p.validation?.checks.find(c=>c.name==='Duplicate source filenames')?.status).toBe('warning')
  })
  it('persists index metadata and bulk tags with Bates number search',async()=>{
    await mutate('actions',{type:'tag-create',name:'Bank Records'});await mutate('actions',{type:'tag-apply',id:p.tags[0].id,ids:p.documents.map(d=>d.id)})
    await mutate('actions',{type:'document',id:p.documents[0].id,displayName:'Bank statements',description:'A <script> & confidential synthetic example',documentDate:'2024-05-01'})
    expect(matchesDocument(p.documents[0],'SDF_000002',p.tags)).toBe(true);expect(matchesDocument(p.documents[0],'bank records',p.tags)).toBe(true);expect(matchesDocument(p.documents[0],'SDF_000003',p.tags)).toBe(false)
  })
  it('publishes an immutable snapshot and keeps edits private to the workspace',async()=>{
    await mutate('publish',{});const sid=p.publishedSnapshotId;expect(sid).toBeTruthy()
    await mutate('actions',{type:'document',id:p.documents[0].id,displayName:'Revised title',description:'Changed',documentDate:''})
    const published=await (await call(`/published/${p.id}`)).json();expect(published.documents[0].displayName).toBe('Bank statements');expect(p.documents[0].displayName).toBe('Revised title')
    expect((await call(`/productions/${p.id}/files/${p.documents[0].id}?published=true`)).headers.get('content-type')).toContain('application/pdf')
  })
  it('generates offline assets and a true Excel workbook with relative safe paths',async()=>{
    await mutate('exports',{kind:'offline'});const exp=p.exports.at(-1)!;const zip=unzipSync(await storage.get(exp.key!))
    expect(zip['Production/README.txt']).toBeUndefined()
    expect((await PDFDocument.load(zip['Production/Start Here.pdf'])).getPageCount()).toBe(1)
    expect(zip['Production/index.html']).toBeTruthy();expect(zip['Production/assets/source-sans-3-latin.woff2']).toBeTruthy()
    const data=strFromU8(zip['Production/assets/data.js']);expect(data).not.toContain('<script>');expect(data).toContain('%23')
    expect(strFromU8(zip['Production/assets/app.js'])).not.toMatch(/fetch\s*\(/)
    const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(zip['Production/Bates Index.xlsx']) as any);expect(workbook.worksheets[0].getCell('B2').value).toBe('SDF_000001');expect(workbook.worksheets[0].rowCount).toBe(3)
    await mutate('exports',{kind:'index',simple:true});const simple=new ExcelJS.Workbook();await simple.xlsx.load(await storage.get(p.exports.at(-1)!.key!) as any);expect(simple.worksheets[0].columnCount).toBe(3)
    await writeFile(join(root,'verified.zip'),Buffer.from(await storage.get(exp.key!)))
  })
  it('detects gaps, overlaps, missing files and tampered metadata',async()=>{
    const bad=structuredClone(p);bad.documents[0].lastNumber=0;bad.documents[1].firstNumber=0;bad.documents[1].processedKey='00000000-0000-0000-0000-000000000000'
    await validate(bad,storage);expect(bad.validation?.checks.find(c=>c.name==='Bates overlaps')?.status).toBe('error');expect(bad.validation?.checks.find(c=>c.name==='Index / PDF matching')?.status).toBe('error')
    bad.documents[1].firstNumber=90;await validate(bad,storage);expect(bad.validation?.checks.find(c=>c.name==='Bates gaps')?.status).toBe('error')
  })
  it('streams actual Bates progress and completes only after the production commit',async()=>{
    const response=await fetch(`${base}/api/productions/${p.id}/bates`,{method:'POST',headers:{Origin:origin,Accept:'application/x-ndjson','Content-Type':'application/json','If-Match':String(p.revision)},body:JSON.stringify({settings:defaultBates,combined:false})})
    expect(response.headers.get('content-type')).toContain('application/x-ndjson')
    const events=(await response.text()).trim().split('\n').map(line=>JSON.parse(line))
    const progress=events.filter(e=>e.type==='progress').map(e=>e.progress)
    expect(progress.some(e=>e.phase==='Checking PDFs')).toBe(true)
    expect(progress.some(e=>e.phase==='Applying Bates labels'&&e.currentPage>0)).toBe(true)
    expect(progress.at(-1).completedDocuments).toBe(2)
    expect(events.at(-1).type).toBe('complete');p=events.at(-1).production
    expect((await store.get(p.id)).revision).toBe(p.revision)
    const stale=await fetch(`${base}/api/productions/${p.id}/bates`,{method:'POST',headers:{Origin:origin,Accept:'application/x-ndjson','Content-Type':'application/json','If-Match':'1'},body:JSON.stringify({settings:defaultBates})})
    expect((await stale.text())).toContain('"type":"error"')
  })
  it('stores an indexed PDF as a downloadable snapshot export',async()=>{
    await mutate('exports',{kind:'indexed-pdf',includeTags:true})
    const exp=p.exports.at(-1)!;expect(exp.kind).toBe('indexed-pdf')
    const response=await call(`/productions/${p.id}/exports/${exp.id}`)
    expect(response.headers.get('content-type')).toContain('application/pdf')
    const pdf=await PDFDocument.load(await storage.get(exp.key!));expect(pdf.getPageCount()).toBe(5)
  })
  it('unpublishes without invalidating historical exports',async()=>{
    await mutate('actions',{type:'unpublish'});expect((await call(`/published/${p.id}`)).status).toBe(404);expect((await call(`/productions/${p.id}/files/${p.documents[0].id}?published=true`)).status).toBe(404)
    const last=p.exports.at(-1)!;expect((await call(`/productions/${p.id}/exports/${last.id}`)).status).toBe(200)
  })
  it('serializes concurrent mutations and preserves the winning edit',async()=>{
    const rev=p.revision
    const result=await Promise.all([call(`/productions/${p.id}/actions`,{type:'tag-create',name:'Concurrent A'},rev),call(`/productions/${p.id}/actions`,{type:'tag-create',name:'Concurrent B'},rev)])
    expect(result.map(r=>r.status).sort()).toEqual([200,409])
  })
  it('deletes a production atomically, revokes its URLs, and retries failed file cleanup',async()=>{
    p=await store.get(p.id)
    await mutate('publish',{})
    const publishedId=p.publishedSnapshotId!, documentId=p.documents[0].id, exportId=p.exports.find(e=>e.key)!.id
    await store.query('INSERT INTO production_members (production_id,principal_id,role) VALUES ($1,$2,$3)',[p.id,'synthetic-user','owner'])
    const other=await (await call('/productions',{name:'Keep this production',matter:'Other synthetic matter'})).json()
    const remove=(revision:number,name:string)=>fetch(`${base}/api/productions/${p.id}`,{method:'DELETE',headers:{Origin:origin,'Content-Type':'application/json','If-Match':String(revision)},body:JSON.stringify({confirmationName:name})})
    expect((await remove(p.revision-1,p.name)).status).toBe(409)
    expect((await remove(p.revision,'Wrong name')).status).toBe(400)
    expect((await store.get(p.id)).name).toBe(p.name)
    const failure=vi.spyOn(storage,'delete').mockRejectedValueOnce(new Error('Temporary storage failure'))
    expect((await remove(p.revision,p.name)).status).toBe(204)
    failure.mockRestore()
    for(const path of [`/productions/${p.id}`,`/published/${p.id}`,`/productions/${p.id}/files/${documentId}`,`/productions/${p.id}/exports/${exportId}`])expect((await call(path)).status).toBe(404)
    expect((await call('/productions')).status).toBe(200)
    expect((await store.all()).map(record=>record.id)).toEqual([other.id])
    await expect(store.snapshot(publishedId,p.id)).rejects.toMatchObject({status:404})
    expect(await store.query('SELECT * FROM production_members WHERE production_id=$1',[p.id])).toHaveLength(0)
    const pending=await store.query('SELECT key FROM blob_deletions');expect(pending).toHaveLength(1)
    const reopened=new Store(undefined,root);await reopened.init()
    expect(await reopened.query('SELECT key FROM blob_deletions')).toHaveLength(1)
    await cleanupDeletedFiles(reopened,storage)
    expect(await reopened.query('SELECT key FROM blob_deletions')).toHaveLength(0)
    await expect(storage.get(pending[0].key)).rejects.toMatchObject({code:'ENOENT'})
    await reopened.close()
    expect((await remove(p.revision,p.name)).status).toBe(404)
    expect((await store.get(other.id)).name).toBe('Keep this production')
  })

})
describe('Authentication boundary',()=>{
  it('fails closed for all data and file APIs when Entra is unconfigured',async()=>{
    const secure=createApp(store,storage,{dev:false,origin}).listen(0,'127.0.0.1');await new Promise<void>(r=>secure.once('listening',r));const url=`http://127.0.0.1:${(secure.address() as any).port}`
    for(const path of ['/api/productions','/api/published/anything','/api/productions/a/files/b','/api/productions/a/exports/b'])expect((await fetch(url+path)).status).toBe(503)
    await new Promise<void>(r=>secure.close(()=>r()))
  })
})
