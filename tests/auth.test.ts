import {beforeAll,afterAll,test,expect,vi} from 'vitest'
import {generateKeyPair,SignJWT} from 'jose'
import type {Server} from 'node:http'
import {createApp} from '../server/app'

const signing=vi.hoisted(()=>({key:undefined as CryptoKey|undefined}))
vi.mock('jose',async importOriginal=>({...await importOriginal<typeof import('jose')>(),createRemoteJWKSet:()=>async()=>signing.key}))
let server:Server,base:string,privateKey:CryptoKey
const tenant='sdf-tenant',client='sdf-web',origin='https://production.example.com'
beforeAll(async()=>{
  const pair=await generateKeyPair('RS256');privateKey=pair.privateKey;signing.key=pair.publicKey
  const app=createApp({observeUser:async()=>{}} as never,{} as never,{dev:false,tenant,client,origin})
  app.get('/assets/test.js',(_req,res)=>res.send('private app asset'))
  app.get('/{*path}',(_req,res)=>res.send('private app HTML'))
  server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));base=`http://127.0.0.1:${(server.address() as any).port}`
})
afterAll(()=>new Promise<void>(r=>server.close(()=>r())))
async function token(overrides:Record<string,unknown>={}){
  return new SignJWT({tid:tenant,oid:'employee',name:'SDF Employee',...overrides}).setProtectedHeader({alg:'RS256'}).setIssuer(`https://login.microsoftonline.com/${tenant}/v2.0`).setAudience(client).setIssuedAt().setExpirationTime('1h').sign(privateKey)
}
test('anonymous HTML and assets redirect before any app bytes are served',async()=>{
  for(const path of ['/','/p/example','/assets/test.js']){
    const response=await fetch(base+path,{redirect:'manual'});expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/.auth/login/aad?post_login_redirect_uri='+encodeURIComponent(origin+path))
    expect(await response.text()).not.toContain('private app')
  }
})
test('configuration and identity APIs also require authentication',async()=>{
  for(const path of ['/api/config','/api/me'])expect((await fetch(base+path)).status).toBe(401)
})
test('unsigned principal headers and old browser bearer tokens cannot bypass the gate',async()=>{
  const response=await fetch(base+'/api/me',{headers:{'X-MS-CLIENT-PRINCIPAL':Buffer.from(JSON.stringify({auth_typ:'aad',claims:[]})).toString('base64'),Authorization:'Bearer '+await token()}})
  expect(response.status).toBe(401)
})
test('a signed SDF Easy Auth ID token permits identity and HTML access',async()=>{
  const headers={'X-MS-TOKEN-AAD-ID-TOKEN':await token()}
  expect(await (await fetch(base+'/api/me',{headers})).json()).toEqual({id:'employee',name:'SDF Employee'})
  const response=await fetch(base+'/',{headers});expect(await response.text()).toBe('private app HTML');expect(response.headers.get('cache-control')).toBe('no-store')
})
test.each([{tid:'other-tenant'},{oid:''}])('rejects signed tokens with invalid identity %j',async overrides=>{
  expect((await fetch(base+'/api/me',{headers:{'X-MS-TOKEN-AAD-ID-TOKEN':await token(overrides)}})).status).toBe(403)
})
test('rejects wrong audience, expired tokens, and invalid signatures',async()=>{
  const other=await generateKeyPair('RS256')
  const make=()=>new SignJWT({tid:tenant,oid:'employee'}).setProtectedHeader({alg:'RS256'}).setIssuer(`https://login.microsoftonline.com/${tenant}/v2.0`).setAudience(client).setIssuedAt().setExpirationTime('1h')
  for(const value of [await make().setAudience('other-app').sign(privateKey),await make().setExpirationTime(1).sign(privateKey),await make().sign(other.privateKey)])expect((await fetch(base+'/api/me',{headers:{'X-MS-TOKEN-AAD-ID-TOKEN':value}})).status).toBe(401)
})
test('session authentication still rejects mutations from another origin',async()=>{
  expect((await fetch(base+'/api/productions',{method:'POST',headers:{'X-MS-TOKEN-AAD-ID-TOKEN':await token(),Origin:'https://attacker.example'}})).status).toBe(403)
})

test('health remains available without exposing app content',async()=>expect(await (await fetch(base+'/healthz')).json()).toEqual({status:'ok'}))

test('expired sign-in redirects pages to Microsoft while APIs return 401',async()=>{
  const expired=await new SignJWT({tid:tenant,oid:'employee'}).setProtectedHeader({alg:'RS256'}).setIssuer(`https://login.microsoftonline.com/${tenant}/v2.0`).setAudience(client).setIssuedAt(1).setExpirationTime(2).sign(privateKey)
  const headers={'X-MS-TOKEN-AAD-ID-TOKEN':expired}
  const page=await fetch(base+'/p/example',{headers,redirect:'manual'})
  expect(page.status).toBe(302)
  expect(page.headers.get('location')).toBe('/.auth/login/aad?post_login_redirect_uri='+encodeURIComponent(origin+'/p/example'))
  expect((await fetch(base+'/api/me',{headers})).status).toBe(401)
})
