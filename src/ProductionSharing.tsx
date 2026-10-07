import {useState} from 'react'
import type {Production} from '../shared/model'
import {api} from './api'

export default function ProductionSharing({p,onChange}:{p:Production;onChange:(p:Production)=>void}) {
  const [email,setEmail]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
  if(p.access?.role!=='owner')return <p className="muted">Shared with you by {p.createdBy.name}. You can edit this production.</p>
  async function save(body:unknown){setBusy(true);setError('');try{onChange(await api<Production>(`/productions/${p.id}/access`,body,p.revision));setEmail('')}catch(e){setError(e instanceof Error?e.message:'Unable to update access.')}finally{setBusy(false)}}
  return <details className="panel sharing-panel"><summary>Manage access · {p.access.members.length?'Shared':'Private'}</summary><div className="sharing-content">
    <p>You own this production. Only you and the people listed here can open its documents, exports, and published viewer.</p>
    <p className="muted">People you add can edit and download. Only you can manage access or delete the production. Removing access does not recall previously downloaded files.</p>
    <p><strong>{p.createdBy.name}</strong> · Owner</p>
    {p.access.members.map(user=><div className="section-heading" key={user.id}><div><strong>{user.name}</strong><p className="muted">{user.email} · Can edit</p></div><button disabled={busy} onClick={()=>void save({removeId:user.id})} aria-label={`Remove access for ${user.name}`}>Remove access</button></div>)}
    <form className="button-row" onSubmit={e=>{e.preventDefault();void save({email:email.trim()})}}><label>Colleague’s sign-in email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@sdflaw.com" disabled={busy}/></label><button className="primary" disabled={busy}>{busy?'Saving…':'Give access'}</button></form>
    <p className="muted">Your colleague must be assigned to the application in Entra and sign in once before you add their email.</p>
    {error&&<p role="alert" className="danger">{error}</p>}
  </div></details>
}
