import {spawn} from 'node:child_process'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve,join} from 'node:path'
import assert from 'node:assert/strict'

const directory=resolve(process.argv[2]??'release-check')
const data=await mkdtemp(join(tmpdir(),'sdf-release-'))
const port='4182',origin=`http://127.0.0.1:${port}`
const child=spawn(process.execPath,['dist-server/index.js'],{cwd:directory,env:{...process.env,NODE_ENV:'production',DEV_AUTH:'false',AZURE_TEST_MODE:'true',DATABASE_URL:'',AZURE_STORAGE_ACCOUNT_URL:'',APP_ORIGIN:'https://release-check.invalid',ENTRA_TENANT_ID:'test-tenant',ENTRA_CLIENT_ID:'test-client',DATA_DIR:data,PORT:port},stdio:['ignore','pipe','pipe']})
let output='',exited=false
child.stdout.on('data',chunk=>{output+=chunk});child.stderr.on('data',chunk=>{output+=chunk})
child.on('exit',()=>{exited=true})
const finished=new Promise(resolve=>child.once('close',resolve))
try {
  const deadline=Date.now()+30000
  let ready=false
  while(Date.now()<deadline){
    if(exited)throw new Error('Packaged server exited before becoming healthy:\n'+output)
    try{const response=await fetch(origin+'/healthz',{signal:AbortSignal.timeout(1000)});ready=response.ok&&(await response.json()).status==='ok'}catch{}
    if(ready)break
    await new Promise(resolve=>setTimeout(resolve,200))
  }
  assert(ready,'Packaged server did not start within 30 seconds.\n'+output)
  assert.equal((await fetch(origin+'/',{redirect:'manual'})).status,302,'Packaged HTML must require Entra sign-in')
  assert.equal((await fetch(origin+'/api/productions')).status,401,'Packaged API must require Entra sign-in')
  console.log('Unpacked release boots successfully with private Entra-gated APIs.')
} finally {
  if(!exited)child.kill('SIGTERM')
  const timer=setTimeout(()=>child.kill('SIGKILL'),3000)
  await finished;clearTimeout(timer)
  await rm(data,{recursive:true,force:true})
}
