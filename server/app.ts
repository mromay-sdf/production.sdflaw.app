import express from 'express'
import helmet from 'helmet'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { resolve } from 'node:path'
import { authentication, type AuthConfig } from './auth'
import { Store, HttpError } from './store'
import type { DocumentStorage } from './storage'
import { defaultBates, type Production, type Identity } from '../shared/model'
import { batesSchema, inspect, invalidate, label, validate, hash } from './workflow'
import { excelIndex, offlinePackage } from './exports'
import { cleanupDeletedFiles } from './cleanup'
import { indexedPdf } from './indexed-pdf'

export function createApp(store: Store, storage: DocumentStorage, auth: AuthConfig) {
  const app=express(); app.disable('x-powered-by')
  app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'data:','blob:'],fontSrc:["'self'"],connectSrc:["'self'",'https://login.microsoftonline.com',...(process.env.NODE_ENV!=='production' ? ['ws://127.0.0.1:4180'] : [])],frameSrc:["'self'",'blob:','https://login.microsoftonline.com'],objectSrc:["'none'"],upgradeInsecureRequests:process.env.NODE_ENV==='production' ? [] : null}},crossOriginEmbedderPolicy:false}))
  app.get('/healthz',(_req,res)=>res.json({status:'ok'}))
  // Protect the entire application, including HTML, assets and configuration.
  app.use((_req,res,next)=>{res.set('Cache-Control','no-store');next()})
  app.use(authentication(auth))
  app.get('/api/config',(_req,res)=>res.json({dev:auth.dev,testing:Boolean(auth.testing)}))
  app.use('/api',(req,res,next)=>{
    if(!['GET','HEAD'].includes(req.method) && req.headers.origin!==auth.origin) return res.status(403).json({error:'Request origin is not allowed.'})
    next()
  })
  let activeWork=0
  app.use('/api',(req,res,next)=>{
    const heavy=req.method==='POST'&&/\/(documents|bates|validate|publish|exports)$/.test(req.path)
    if(!heavy)return next()
    if(activeWork>=2)return res.status(429).json({error:'The server is processing other documents. Try again shortly.'})
    activeWork++;let finished=false
    const release=()=>{if(!finished){finished=true;activeWork--}}
    res.on('finish',release);res.on('close',release);next()
  })
  app.use(express.json({limit:'1mb'}))
  app.get('/api/me',(_req,res)=>res.json(res.locals.identity))
  app.get('/api/productions',async(_req,res)=>res.json((await store.all()).map(p=>({...p,documents:p.documents.map(d=>({...d,originalKey:undefined,processedKey:d.processedKey ? 'available' : undefined})),exports:[]}))))
  app.post('/api/productions',async(req,res)=>{
    const body=z.object({name:z.string().trim().min(1).max(160),matter:z.string().trim().min(1).max(160),description:z.string().max(3000).default('')}).strict().parse(req.body)
    const now=new Date().toISOString()
    const p:Production={...body,id:randomUUID(),createdBy:res.locals.identity,createdAt:now,updatedAt:now,revision:1,status:'Draft',documents:[],tags:[],bates:defaultBates,exports:[]}
    await store.create(p); res.status(201).json(p)
  })
  const id = (value: unknown) => z.string().uuid().parse(value)
  const revision = (req: express.Request) => { const n=Number(req.headers['if-match']); if(!Number.isInteger(n)||n<1) throw new HttpError(428,'A current production revision is required.'); return n }
  app.get('/api/productions/:id',async(req,res)=>res.json(await store.get(id(req.params.id))))
  app.delete('/api/productions/:id',async(req,res)=>{
    const body=z.object({confirmationName:z.string().min(1).max(160)}).strict().parse(req.body)
    await store.remove(id(req.params.id),revision(req),body.confirmationName)
    // Deletion has committed. A temporary cleanup failure must not report that
    // the production still exists; the persisted queue will be retried.
    await cleanupDeletedFiles(store,storage).catch(()=>{})
    res.status(204).end()
  })
  app.get('/api/published/:id',async(req,res)=>{
    const p=await store.get(id(req.params.id)); if(!p.publishedSnapshotId) throw new HttpError(404,'This production is not published.')
    const snapshot=await store.snapshot(p.publishedSnapshotId,p.id)
    res.json({...snapshot,exports:[],validation:undefined,documents:snapshot.documents.map(d=>({...d,originalKey:undefined,processedKey:d.processedKey?'available':undefined,sha256:undefined,processedSha256:undefined}))})
  })
  app.post('/api/productions/:id/documents',express.raw({type:'application/pdf',limit:'50mb'}),async(req,res)=>{
    if(!Buffer.isBuffer(req.body)) throw new HttpError(400,'Upload PDF bytes with application/pdf content type.')
    const bytes=req.body as Buffer
    let name: string
    try {name=decodeURIComponent(String(req.headers['x-file-name']??''))} catch {throw new HttpError(400,'Invalid filename.')}
    name=z.string().min(1).max(240).regex(/\.pdf$/i).parse(name)
    if(/[\x00-\x1f/\\]/.test(name)) throw new HttpError(400,'Invalid filename.')
    const result=await inspect(bytes)
    res.json(await store.mutate(id(req.params.id),revision(req),async p=>{
      if(p.documents.length>=500 || p.documents.reduce((n,d)=>n+d.size,0)+bytes.length>256*1024*1024) throw new HttpError(400,'Production limit: 500 files and 256 MB of source PDFs.')
      p.documents.push({id:randomUUID(),originalName:name,displayName:name.replace(/\.pdf$/i,''),originalKey:await storage.put(bytes),sha256:hash(bytes),size:bytes.length,...result,description:'',documentDate:'',tagIds:[],source:{provider:'upload'}})
      invalidate(p,true)
    }))
  })
  const actionSchema=z.discriminatedUnion('type',[
    z.object({type:z.literal('metadata'),name:z.string().trim().min(1).max(160),matter:z.string().trim().min(1).max(160),description:z.string().max(3000)}),
    z.object({type:z.literal('remove'),ids:z.array(z.string().uuid()).min(1)}),
    z.object({type:z.literal('reorder'),ids:z.array(z.string().uuid())}),
    z.object({type:z.literal('document'),id:z.string().uuid(),displayName:z.string().trim().min(1).max(240),description:z.string().max(3000),documentDate:z.union([z.literal(''),z.iso.date()])}),
    z.object({type:z.literal('tag-create'),name:z.string().trim().min(1).max(80)}),
    z.object({type:z.literal('tag-rename'),id:z.string().uuid(),name:z.string().trim().min(1).max(80)}),
    z.object({type:z.literal('tag-delete'),id:z.string().uuid()}),
    z.object({type:z.literal('tag-apply'),id:z.string().uuid(),ids:z.array(z.string().uuid()).min(1),remove:z.boolean().default(false)}),
    z.object({type:z.literal('archive'),archived:z.boolean()}),
    z.object({type:z.literal('unpublish')})
  ])
  app.post('/api/productions/:id/actions',async(req,res)=>{
    const a=actionSchema.parse(req.body)
    res.json(await store.mutate(id(req.params.id),revision(req),async p=>{
      if(a.type==='metadata') {p.name=a.name;p.matter=a.matter;p.description=a.description}
      if(a.type==='remove') p.documents=p.documents.filter(d=>!a.ids.includes(d.id))
      if(a.type==='reorder') {if(a.ids.length!==p.documents.length||new Set(a.ids).size!==p.documents.length||a.ids.some(i=>!p.documents.some(d=>d.id===i))) throw new HttpError(400,'Invalid document order.');p.documents=a.ids.map(i=>p.documents.find(d=>d.id===i)!)}
      if(a.type==='document') {const d=p.documents.find(d=>d.id===a.id);if(!d)throw new HttpError(404,'Document not found.'); Object.assign(d,{displayName:a.displayName,description:a.description,documentDate:a.documentDate})}
      if(a.type==='tag-create'||a.type==='tag-rename') {if(p.tags.some(t=>t.name.toLowerCase()===a.name.toLowerCase()&&(a.type==='tag-create'||t.id!==a.id)))throw new HttpError(400,'A tag with that name already exists.'); if(a.type==='tag-create') p.tags.push({id:randomUUID(),name:a.name}); else {const t=p.tags.find(t=>t.id===a.id);if(!t)throw new HttpError(404,'Tag not found.');t.name=a.name}}
      if(a.type==='tag-delete') {p.tags=p.tags.filter(t=>t.id!==a.id);for(const d of p.documents)d.tagIds=d.tagIds.filter(i=>i!==a.id)}
      if(a.type==='tag-apply') {if(!p.tags.some(t=>t.id===a.id)||a.ids.some(i=>!p.documents.some(d=>d.id===i)))throw new HttpError(400,'Unknown tag or document.');for(const d of p.documents.filter(d=>a.ids.includes(d.id))) d.tagIds=a.remove?d.tagIds.filter(i=>i!==a.id):[...new Set([...d.tagIds,a.id])]}
      if(a.type==='unpublish') p.publishedSnapshotId=undefined
      invalidate(p,a.type==='remove'||a.type==='reorder')
      if(a.type==='archive') {p.status=a.archived?'Archived':'Draft'; if(a.archived)p.publishedSnapshotId=undefined}
    }))
  })
  app.post('/api/productions/:id/bates',async(req,res)=>{
    const body=z.object({settings:batesSchema,combined:z.boolean().default(false)}).parse(req.body)
    const productionId=id(req.params.id),expectedRevision=revision(req)
    if(!req.headers.accept?.includes('application/x-ndjson')) {
      res.json(await store.mutate(productionId,expectedRevision,async p=>label(p,storage,body.settings,body.combined)));return
    }
    res.type('application/x-ndjson').set('X-Accel-Buffering','no');res.flushHeaders()
    const send=(event:unknown)=>{if(!res.destroyed)res.write(JSON.stringify(event)+'\n')}
    const heartbeat=setInterval(()=>send({type:'heartbeat'}),15000)
    let last=0
    try {
      const production=await store.mutate(productionId,expectedRevision,async p=>label(p,storage,body.settings,body.combined,progress=>{
        const now=Date.now();if(progress.phase!=='Applying Bates labels'||now-last>=100||progress.currentPage===progress.totalPages){send({type:'progress',progress});last=now}
      }))
      send({type:'complete',production})
    } catch(error) {send({type:'error',error:error instanceof HttpError?error.message:'Bates processing failed. Your previous saved production is unchanged.'})}
    finally {clearInterval(heartbeat);res.end()}
  })
  app.post('/api/productions/:id/validate',async(req,res)=>res.json(await store.mutate(id(req.params.id),revision(req),async p=>{await validate(p,storage)})))
  app.post('/api/productions/:id/publish',async(req,res)=>{
    res.json(await store.mutate(id(req.params.id),revision(req),async(p,snapshot)=>{
      const v=await validate(p,storage);if(v.checks.some(c=>c.status==='error'))throw new HttpError(400,'Resolve validation errors before publishing.')
      const snapshotId=randomUUID(); await snapshot(snapshotId,{...p,revision:p.revision+1,updatedAt:new Date().toISOString()})
      p.publishedSnapshotId=snapshotId;p.status='Published'
      p.exports.push({id:randomUUID(),at:new Date().toISOString(),by:res.locals.identity,kind:'publish',snapshotId,revision:p.revision+1})
    }))
  })
  app.post('/api/productions/:id/exports',async(req,res)=>{
    const body=z.object({kind:z.enum(['offline','index','indexed-pdf']),simple:z.boolean().default(false),includeTags:z.boolean().default(true)}).parse(req.body)
    res.json(await store.mutate(id(req.params.id),revision(req),async(p,snapshot)=>{
      const v=await validate(p,storage);if(v.checks.some(c=>c.status==='error'))throw new HttpError(400,'Resolve validation errors before exporting.')
      const snapshotId=randomUUID();await snapshot(snapshotId,{...p,revision:p.revision+1,updatedAt:new Date().toISOString()})
      const bytes=body.kind==='offline'?await offlinePackage(p,storage):body.kind==='indexed-pdf'?await indexedPdf(p,storage,body.includeTags):await excelIndex(p,body.simple)
      p.exports.push({id:randomUUID(),at:new Date().toISOString(),by:res.locals.identity,kind:body.kind,key:await storage.put(bytes),snapshotId,revision:p.revision+1})
    }))
  })
  app.get('/api/productions/:id/exports/:exportId',async(req,res)=>{
    const p=await store.get(id(req.params.id));const e=p.exports.find(e=>e.id===id(req.params.exportId));if(!e?.key)throw new HttpError(404,'Export not found.')
    res.type(e.kind==='offline'?'application/zip':e.kind==='indexed-pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').set('Content-Disposition',`attachment; filename="${e.kind==='offline'?'Production.zip':e.kind==='indexed-pdf'?'Indexed Production.pdf':'Bates Index.xlsx'}"`).send(await storage.get(e.key))
  })
  app.get('/api/productions/:id/files/:documentId',async(req,res)=>{
    let p=await store.get(id(req.params.id))
    if(req.query.published==='true') {if(!p.publishedSnapshotId)throw new HttpError(404,'Production is not published.');p=await store.snapshot(p.publishedSnapshotId,p.id)}
    const combined=req.params.documentId==='combined'
    const d=combined?undefined:p.documents.find(d=>d.id===id(req.params.documentId))
    const key=combined?p.combinedKey:req.query.original==='true'&&req.query.published!=='true'?d?.originalKey:d?.processedKey
    if(!key)throw new HttpError(404,'PDF is not available.')
    res.type('application/pdf').set('Content-Disposition',`inline; filename="Document.pdf"; filename*=UTF-8''${encodeURIComponent(d?.finalName??d?.originalName??'Combined.pdf').replace(/'/g,'%27')}`).send(await storage.get(key))
  })
  app.use('/api',(_req,res)=>res.status(404).json({error:'Endpoint not found.'}))
  app.use((error: any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
    const status=error instanceof HttpError?error.status:error instanceof z.ZodError?400:error.status===413?413:500
    const message=error instanceof HttpError?error.message:error instanceof z.ZodError?'Invalid input: '+error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '):status===413?'File exceeds the 50 MB upload limit.':'The operation failed. Your previous saved production is unchanged.'
    // Avoid logging names, bytes, tokens, or database connection strings.
    if(status===500)console.error('Production operation failed', {type:error?.constructor?.name})
    res.status(status).json({error:message})
  })
  return app
}
