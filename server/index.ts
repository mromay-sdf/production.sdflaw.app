import { resolve } from 'node:path'
import express from 'express'
import { createApp } from './app'
import { Store } from './store'
import { PrivateStorage } from './storage'
import { cleanupDeletedFiles } from './cleanup'
import { runtime } from './runtime'
const {production,dev,testing,origin,dataDir}=runtime(process.env)
const port=Number(process.env.PORT||4180)
const store=new Store(process.env.DATABASE_URL,dataDir);await store.init()
const storage=new PrivateStorage(resolve(dataDir,'blobs'),process.env.AZURE_STORAGE_ACCOUNT_URL,process.env.AZURE_STORAGE_CONTAINER)
let cleaning=false
const cleanup=async()=>{if(cleaning)return;cleaning=true;try{await cleanupDeletedFiles(store,storage)}catch{console.error('Deferred file cleanup unavailable')}finally{cleaning=false}}
void cleanup()
const cleanupTimer=setInterval(()=>void cleanup(),60000);cleanupTimer.unref()
const app=createApp(store,storage,{dev,testing,origin,tenant:process.env.ENTRA_TENANT_ID,client:process.env.ENTRA_CLIENT_ID})
if(production||process.env.LOCAL_PREVIEW==='true') {app.use(express.static(resolve('dist')));app.get('/{*path}',(_req,res)=>res.sendFile(resolve('dist/index.html')))}
else {const {createServer}=await import('vite');const vite=await createServer({server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares)}
const server=app.listen(port,dev?'127.0.0.1':'0.0.0.0',()=>console.log(`SDF Production listening at ${origin}${dev?' (local development identity)':''}`))
server.requestTimeout=300000
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{clearInterval(cleanupTimer);server.close(()=>{void store.close().then(()=>process.exit(0))})})
