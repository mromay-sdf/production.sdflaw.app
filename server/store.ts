import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import type { Production, Identity, ProductionAccess } from '../shared/model'

export class HttpError extends Error { constructor(public status: number, message: string) { super(message) } }
type Row = Record<string, any>
interface Connection { query(sql: string, values?: unknown[]): Promise<Row[]> }
export class Store {
  private pool?: pg.Pool
  private sqlite?: DatabaseSync
  private queue: Promise<unknown> = Promise.resolve()
  constructor(url?: string, localDir = 'data') {
    if (url) this.pool = new pg.Pool({ connectionString: url, max: 10 })
    else { mkdirSync(localDir, { recursive: true }); this.sqlite = new DatabaseSync(resolve(localDir, 'production.sqlite')); this.sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;') }
  }
  private local: Connection = { query: async (sql, values = []) => {
    const stmt = this.sqlite!.prepare(sql.replace(/\$\d+/g, '?'))
    return stmt.all(...values as any[]) as Row[]
  } }
  async query(sql: string, values: unknown[] = []) {
    if (this.pool) return (await this.pool.query(sql, values)).rows
    const result = this.queue.then(() => this.local.query(sql, values))
    this.queue = result.catch(() => {}); return result
  }
  async init() {
    await this.query('CREATE TABLE IF NOT EXISTS productions (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL)')
    await this.query('CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, production_id TEXT NOT NULL REFERENCES productions(id), payload TEXT NOT NULL)')
    await this.query('CREATE TABLE IF NOT EXISTS production_members (production_id TEXT NOT NULL REFERENCES productions(id), principal_id TEXT NOT NULL, role TEXT NOT NULL, PRIMARY KEY(production_id, principal_id))')
    await this.query('CREATE TABLE IF NOT EXISTS app_users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT)')
    await this.query('CREATE TABLE IF NOT EXISTS blob_deletions (key TEXT PRIMARY KEY)')
  }
  async all(): Promise<Production[]> { return (await this.query('SELECT payload FROM productions')).map(r => JSON.parse(r.payload)).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)) }
  async get(id: string): Promise<Production> { const rows = await this.query('SELECT payload FROM productions WHERE id=$1', [id]); if (!rows[0]) throw new HttpError(404, 'Production not found.'); return JSON.parse(rows[0].payload) }
  async create(p: Production) { await this.query('INSERT INTO productions (id,revision,payload) VALUES ($1,$2,$3)', [p.id, p.revision, JSON.stringify(p)]) }
  async observeUser(user: Identity) {
    await this.query('INSERT INTO app_users (id,name,email) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET name=excluded.name,email=excluded.email', [user.id,user.name,user.email ?? null])
  }
  private async requireAccess(conn: Connection, p: Production, principal: string, ownerOnly=false): Promise<'owner'|'editor'> {
    if(p.createdBy.id===principal)return 'owner'
    const rows=await conn.query('SELECT role FROM production_members WHERE production_id=$1 AND principal_id=$2',[p.id,principal])
    if(rows[0]?.role!=='editor')throw new HttpError(404,'Production not found or access was removed.')
    if(ownerOnly)throw new HttpError(403,'Only the production owner can manage access or delete this production.')
    return 'editor'
  }
  async access(p: Production, principal: string, ownerOnly=false): Promise<ProductionAccess> {
    const role=await this.requireAccess({query:(s,v)=>this.query(s,v)},p,principal,ownerOnly)
    const members=role==='owner' ? (await this.query('SELECT u.id,u.name,u.email FROM production_members m JOIN app_users u ON u.id=m.principal_id WHERE m.production_id=$1',[p.id])).map(r=>({id:r.id,name:r.name,...(r.email?{email:r.email}:{})})) : []
    return {role,members}
  }
  async allFor(principal: string): Promise<Production[]> {
    const memberships=new Set((await this.query('SELECT production_id FROM production_members WHERE principal_id=$1 AND role=$2',[principal,'editor'])).map(r=>r.production_id))
    return (await this.all()).filter(p=>p.createdBy.id===principal||memberships.has(p.id))
  }
  async changeAccess(id: string, revision: number, principal: string, body: {email?:string; removeId?:string}) {
    return this.mutate(id,revision,async(p,_snapshot,conn)=>{
      if(body.removeId) {
        if(body.removeId===p.createdBy.id)throw new HttpError(400,'The owner cannot be removed.')
        await conn.query('DELETE FROM production_members WHERE production_id=$1 AND principal_id=$2',[id,body.removeId])
      } else {
        const matches=await conn.query('SELECT id FROM app_users WHERE email=$1',[body.email!.toLowerCase()])
        if(matches.length!==1)throw new HttpError(400,'Ask this user to sign in to Production once, then enter the email for that account. No access was granted.')
        if(matches[0].id===p.createdBy.id)throw new HttpError(400,'You already own this production.')
        await conn.query('INSERT INTO production_members (production_id,principal_id,role) VALUES ($1,$2,$3) ON CONFLICT (production_id,principal_id) DO UPDATE SET role=excluded.role',[id,matches[0].id,'editor'])
      }
    },{principal,ownerOnly:true})
  }
  async snapshot(id: string, productionId: string): Promise<Production> { const rows = await this.query('SELECT payload FROM snapshots WHERE id=$1 AND production_id=$2', [id, productionId]); if (!rows[0]) throw new HttpError(404, 'Snapshot not found.'); return JSON.parse(rows[0].payload) }
  async mutate(id: string, revision: number, change: (p: Production, snapshot: (id: string, data: Production) => Promise<void>, conn: Connection) => Promise<void>, access?: {principal:string;ownerOnly?:boolean}): Promise<Production> {
    const perform = async () => {
      const client = this.pool ? await this.pool.connect() : undefined
      const conn: Connection = client ? { query: async (s,v) => (await client.query(s,v)).rows } : this.local
      try {
        await conn.query(this.pool ? 'BEGIN' : 'BEGIN IMMEDIATE')
        const rows = await conn.query(`SELECT payload FROM productions WHERE id=$1${this.pool ? ' FOR UPDATE' : ''}`, [id])
        if (!rows[0]) throw new HttpError(404, 'Production not found.')
        const p: Production = JSON.parse(rows[0].payload)
        if(access)await this.requireAccess(conn,p,access.principal,access.ownerOnly)
        if (p.revision !== revision) throw new HttpError(409, 'This production changed in another session. Reload it before saving.')
        await change(p, async (snapshotId, data) => { await conn.query('INSERT INTO snapshots (id,production_id,payload) VALUES ($1,$2,$3)', [snapshotId, id, JSON.stringify(data)]) }, conn)
        p.revision++; p.updatedAt = new Date().toISOString()
        await conn.query('UPDATE productions SET revision=$1,payload=$2 WHERE id=$3', [p.revision, JSON.stringify(p), id])
        await conn.query('COMMIT'); return p
      } catch (error) { await conn.query('ROLLBACK'); throw error } finally { client?.release() }
    }
    if (this.pool) return perform()
    // SQLite has a single connection: serialize async transactions, including their PDF work.
    const result = this.queue.then(perform); this.queue = result.catch(() => {}); return result
  }
  async remove(id: string, revision: number, confirmationName: string, principal?: string): Promise<void> {
    const perform = async () => {
      const client = this.pool ? await this.pool.connect() : undefined
      const conn: Connection = client ? { query: async (s,v) => (await client.query(s,v)).rows } : this.local
      try {
        await conn.query(this.pool ? 'BEGIN' : 'BEGIN IMMEDIATE')
        const rows = await conn.query(`SELECT payload FROM productions WHERE id=$1${this.pool ? ' FOR UPDATE' : ''}`, [id])
        if (!rows[0]) throw new HttpError(404, 'Production not found.')
        const p: Production = JSON.parse(rows[0].payload)
        if(principal)await this.requireAccess(conn,p,principal,true)
        if (p.revision !== revision) throw new HttpError(409, 'This production changed in another session. Reload it before deleting.')
        if (p.name !== confirmationName) throw new HttpError(400, 'Enter the production name exactly to confirm deletion.')
        const snapshots = await conn.query('SELECT payload FROM snapshots WHERE production_id=$1', [id])
        const keys = new Set<string>()
        for (const record of [p, ...snapshots.map(row => JSON.parse(row.payload) as Production)]) {
          for (const d of record.documents) { keys.add(d.originalKey); if(d.processedKey)keys.add(d.processedKey) }
          for (const f of record.processedFiles ?? []) keys.add(f.key)
          for (const e of record.exports) if(e.key)keys.add(e.key)
          if(record.combinedKey)keys.add(record.combinedKey)
        }
        // Commit revocation and a durable cleanup queue together. Failed storage
        // deletions can be retried even after the production record is gone.
        for (const key of keys) await conn.query('INSERT INTO blob_deletions (key) VALUES ($1) ON CONFLICT (key) DO NOTHING', [key])
        await conn.query('DELETE FROM production_members WHERE production_id=$1', [id])
        await conn.query('DELETE FROM snapshots WHERE production_id=$1', [id])
        await conn.query('DELETE FROM productions WHERE id=$1', [id])
        await conn.query('COMMIT')
      } catch (error) { await conn.query('ROLLBACK'); throw error } finally { client?.release() }
    }
    if (this.pool) return perform()
    const result = this.queue.then(perform); this.queue = result.catch(() => {}); return result
  }
  async close() { await this.pool?.end(); this.sqlite?.close() }
}
