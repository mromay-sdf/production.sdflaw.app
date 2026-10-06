import type { Store } from './store'
import type { DocumentStorage } from './storage'

export async function cleanupDeletedFiles(store: Store, storage: DocumentStorage) {
  const pending = await store.query('SELECT key FROM blob_deletions LIMIT 100')
  for (const row of pending) {
    try {
      await storage.delete(row.key)
      await store.query('DELETE FROM blob_deletions WHERE key=$1', [row.key])
    } catch { /* Keep the durable queue entry for the next retry. */ }
  }
}
