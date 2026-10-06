import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import type { Production } from '../shared/model'

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
    await this.query('CREATE TABLE IF NOT EXISTS blob_deletions (key TEXT PRIMARY KEY)')
  }
  async all(): Promise<Production[]> { return (await this.query('SELECT payload FROM productions')).map(r => JSON.parse(r.payload)).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)) }
  async get(id: string): Promise<Production> { const rows = await this.query('SELECT payload FROM productions WHERE id=$1', [id]); if (!rows[0]) throw new HttpError(404, 'Production not found.'); return JSON.parse(rows[0].payload) }
  async create(p: Production) { await this.query('INSERT INTO productions (id,revision,payload) VALUES ($1,$2,$3)', [p.id, p.revision, JSON.stringify(p)]) }
  async snapshot(id: string, productionId: string): Promise<Production> { const rows = await this.query('SELECT payload FROM snapshots WHERE id=$1 AND production_id=$2', [id, productionId]); if (!rows[0]) throw new HttpError(404, 'Snapshot not found.'); return JSON.parse(rows[0].payload) }
  async mutate(id: string, revision: number, change: (p: Production, snapshot: (id: string, data: Production) => Promise<void>) => Promise<void>): Promise<Production> {
    const perform = async () => {
      const client = this.pool ? await this.pool.connect() : undefined
      const conn: Connection = client ? { query: async (s,v) => (await client.query(s,v)).rows } : this.local
      try {
        await conn.query(this.pool ? 'BEGIN' : 'BEGIN IMMEDIATE')
        const rows = await conn.query(`SELECT payload FROM productions WHERE id=$1${this.pool ? ' FOR UPDATE' : ''}`, [id])
        if (!rows[0]) throw new HttpError(404, 'Production not found.')
        const p: Production = JSON.parse(rows[0].payload)
        if (p.revision !== revision) throw new HttpError(409, 'This production changed in another session. Reload it before saving.')
        await change(p, async (snapshotId, data) => { await conn.query('INSERT INTO snapshots (id,production_id,payload) VALUES ($1,$2,$3)', [snapshotId, id, JSON.stringify(data)]) })
        p.revision++; p.updatedAt = new Date().toISOString()
        await conn.query('UPDATE productions SET revision=$1,payload=$2 WHERE id=$3', [p.revision, JSON.stringify(p), id])
        await conn.query('COMMIT'); return p
      } catch (error) { await conn.query('ROLLBACK'); throw error } finally { client?.release() }
    }
    if (this.pool) return perform()
    // SQLite has a single connection: serialize async transactions, including their PDF work.
    const result = this.queue.then(perform); this.queue = result.catch(() => {}); return result
  }
  async remove(id: string, revision: number, confirmationName: string): Promise<void> {
    const perform = async () => {
      const client = this.pool ? await this.pool.connect() : undefined
      const conn: Connection = client ? { query: async (s,v) => (await client.query(s,v)).rows } : this.local
      try {
        await conn.query(this.pool ? 'BEGIN' : 'BEGIN IMMEDIATE')
        const rows = await conn.query(`SELECT payload FROM productions WHERE id=$1${this.pool ? ' FOR UPDATE' : ''}`, [id])
        if (!rows[0]) throw new HttpError(404, 'Production not found.')
        const p: Production = JSON.parse(rows[0].payload)
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
