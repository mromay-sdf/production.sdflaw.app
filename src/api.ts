import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-browser'
let client: PublicClientApplication | undefined
let scope=''
export interface Config { dev:boolean; testing?:boolean; tenant?:string; client?:string; scope?:string }
export async function initAuth():Promise<Config> {
  const config:Config=await (await fetch('/api/config')).json()
  if(!config.dev&&config.client&&config.tenant&&config.scope) {
    scope=config.scope
    client=new PublicClientApplication({auth:{clientId:config.client,authority:`https://login.microsoftonline.com/${config.tenant}`,redirectUri:location.origin},cache:{cacheLocation:'sessionStorage'}})
    await client.initialize();const result=await client.handleRedirectPromise();if(result?.account)client.setActiveAccount(result.account)
    if(!client.getActiveAccount())client.setActiveAccount(client.getAllAccounts()[0]??null)
  }
  return config
}
export const signedIn=()=>Boolean(client?.getActiveAccount())
export async function login(){await client?.loginRedirect({scopes:[scope]})}
export async function logout(){await client?.logoutRedirect({postLogoutRedirectUri:location.origin})}
async function headers(extra?:HeadersInit) {
  const h=new Headers(extra)
  if(client) {
    try {const token=await client.acquireTokenSilent({scopes:[scope],account:client.getActiveAccount()!});h.set('Authorization',`Bearer ${token.accessToken}`)}
    catch(e){if(e instanceof InteractionRequiredAuthError)await client.acquireTokenRedirect({scopes:[scope]});throw new Error('Sign in again to continue.')}
  }
  return h
}
export async function request(path:string, options:RequestInit={}) {
  const response=await fetch('/api'+path,{...options,headers:await headers(options.headers)})
  if(!response.ok){const body=await response.json().catch(()=>({error:'Request failed.'}));throw new Error(body.error)}
  return response
}
export async function api<T>(path:string, body?:unknown, revision?:number):Promise<T> {
  return (await request(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json',...(revision?{'If-Match':String(revision)}:{})},body:JSON.stringify(body)})).json()
}
export async function fileBlob(path:string){return (await request(path)).blob()}
export function saveBlob(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}
