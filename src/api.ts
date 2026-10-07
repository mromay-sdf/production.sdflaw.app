export interface Config { dev:boolean; testing?:boolean }
export async function initAuth():Promise<Config> {
  return (await request('/config')).json()
}
function login(){location.assign('/.auth/login/aad?post_login_redirect_uri='+encodeURIComponent(location.href))}
export async function logout(){location.assign('/.auth/logout?post_logout_redirect_uri='+encodeURIComponent(location.origin+'/.auth/login/aad'))}
export async function request(path:string, options:RequestInit={}) {
  const response=await fetch('/api'+path,{...options,credentials:'same-origin',redirect:'manual'})
  if(response.status===401||response.status===302||response.type==='opaqueredirect'){login();throw new Error('Your session has expired. Signing in again…')}
  if(!response.ok){const body=await response.json().catch(()=>({error:'Request failed.'}));throw new Error(body.error)}
  return response
}
export async function api<T>(path:string, body?:unknown, revision?:number):Promise<T> {
  return (await request(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json',...(revision?{'If-Match':String(revision)}:{})},body:JSON.stringify(body)})).json()
}
export async function fileBlob(path:string){return (await request(path)).blob()}
export function saveBlob(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}
