import {beforeAll,afterAll,test,expect,vi} from 'vitest'
import {generateKeyPair,SignJWT} from 'jose'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type {Server} from 'node:http'
import {PDFDocument} from 'pdf-lib'
import {Store} from '../server/store'
import {PrivateStorage} from '../server/storage'
import {createApp} from '../server/app'
import {defaultBates,type Production} from '../shared/model'
const signing=vi.hoisted(()=>({key:undefined as CryptoKey|undefined}))
vi.mock('jose',async original=>({...await original<typeof import('jose')>(),createRemoteJWKSet:()=>async()=>signing.key}))
let root:string,store:Store,server:Server,base:string,privateKey:CryptoKey
const origin='https://production.example.com',tenant='sdf',client='production'
const tokens:Record<string,string>={}
beforeAll(async()=>{
  const pair=await generateKeyPair('RS256');privateKey=pair.privateKey;signing.key=pair.publicKey
  for(const user of ['owner','colleague','stranger'])tokens[user]=await new SignJWT({tid:tenant,oid:user,name:user,preferred_username:`${user}@sdflaw.com`}).setProtectedHeader({alg:'RS256'}).setIssuer(`https://login.microsoftonline.com/${tenant}/v2.0`).setAudience(client).setIssuedAt().setExpirationTime('1h').sign(privateKey)
  root=await mkdtemp(join(tmpdir(),'sdf-access-'));store=new Store(undefined,root);await store.init()
  server=createApp(store,new PrivateStorage(join(root,'blobs')),{dev:false,tenant,client,origin}).listen(0,'127.0.0.1')
  await new Promise<void>(r=>server.once('listening',r));base=`http://127.0.0.1:${(server.address() as any).port}/api`
})
afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));await store.close();await rm(root,{recursive:true,force:true})})
function call(user:string,path:string,body?:unknown,revision?:number,method?:string){return fetch(base+path,{method:method??(body===undefined?'GET':'POST'),headers:{'X-MS-TOKEN-AAD-ID-TOKEN':tokens[user],Origin:origin,'Content-Type':'application/json',...(revision?{'If-Match':String(revision)}:{})},body:body===undefined?undefined:JSON.stringify(body)})}
test('private ownership, explicit sharing, published bytes, exports, revocation and transactional enforcement',async()=>{
  for(const user of Object.keys(tokens))expect((await call(user,'/me')).status).toBe(200)
  const created=await call('owner','/productions',{name:'Private case',matter:'Synthetic'});expect(created.status).toBe(201)
  let p:Production=await created.json();const path=`/productions/${p.id}`
  expect(p.createdBy.id).toBe('owner');expect(p.access).toEqual({role:'owner',members:[]})
  async function save(user:string,endpoint:string,body:unknown){const response=await call(user,path+'/'+endpoint,body,p.revision);expect(response.status,await response.clone().text()).toBe(200);p=await response.json()}
  expect(await (await call('colleague','/productions')).json()).toEqual([])
  for(const endpoint of [path,`/published/${p.id}`,path+'/files/combined',path+'/exports/00000000-0000-4000-8000-000000000000'])expect((await call('colleague',endpoint)).status).toBe(404)
  for(const endpoint of ['actions','bates','validate','publish','exports','documents','access'])expect((await call('colleague',path+'/'+endpoint,{},p.revision)).status).toBe(404)
  expect((await call('stranger',path,{confirmationName:p.name},p.revision,'DELETE')).status).toBe(404)
  expect((await call('owner',path+'/access',{email:'unknown@sdflaw.com'},p.revision)).status).toBe(400)
  expect((await call('owner',path+'/access',{email:'colleague@sdflaw.com',id:'stranger'},p.revision)).status).toBe(400)
  await save('owner','access',{email:'COLLEAGUE@sdflaw.com'})
  expect(p.access?.members[0].id).toBe('colleague')
  expect((await (await call('colleague','/productions')).json()).map((p:Production)=>p.id)).toEqual([p.id])
  await save('colleague','actions',{type:'metadata',name:p.name,matter:p.matter,description:'Shared edit'})
  expect(p.access?.role).toBe('editor');expect(p.description).toBe('Shared edit')
  expect((await call('colleague',path+'/access',{email:'stranger@sdflaw.com'},p.revision)).status).toBe(403)
  expect((await call('colleague',path,{confirmationName:p.name},p.revision,'DELETE')).status).toBe(403)
  const pdf=await PDFDocument.create();pdf.addPage().drawText('Synthetic private record')
  const upload=await fetch(base+path+'/documents',{method:'POST',headers:{'X-MS-TOKEN-AAD-ID-TOKEN':tokens.colleague,Origin:origin,'Content-Type':'application/pdf','X-File-Name':'sample.pdf','If-Match':String(p.revision)},body:Buffer.from(await pdf.save())});expect(upload.status).toBe(200);p=await upload.json()
  await save('colleague','bates',{settings:defaultBates,combined:true});await save('colleague','publish',{});await save('colleague','exports',{kind:'index'})
  const protectedPaths=[path,`/published/${p.id}`,path+`/files/${p.documents[0].id}?original=true`,path+`/files/${p.documents[0].id}?published=true`,path+'/files/combined',path+`/exports/${p.exports.at(-1)!.id}`]
  for(const endpoint of protectedPaths){expect((await call('colleague',endpoint)).status).toBe(200);expect((await call('stranger',endpoint)).status).toBe(404)}
  const reopened=new Store(undefined,root);await reopened.init();expect((await reopened.access(await reopened.get(p.id),'colleague')).role).toBe('editor');await reopened.close()
  const priorRevision=p.revision
  await save('owner','access',{removeId:'colleague'})
  for(const endpoint of protectedPaths)expect((await call('colleague',endpoint)).status).toBe(404)
  expect(await (await call('colleague','/productions')).json()).toEqual([])
  // Even if an HTTP precheck happened before revocation, the transaction denies the write.
  const change=vi.fn(async()=>{})
  await expect(store.mutate(p.id,priorRevision,change,{principal:'colleague'})).rejects.toMatchObject({status:404});expect(change).not.toHaveBeenCalled()
  expect((await call('owner',path)).status).toBe(200)
  expect((await call('owner',path,{confirmationName:p.name},p.revision,'DELETE')).status).toBe(204)
})
