import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob'
import { DefaultAzureCredential } from '@azure/identity'
export interface DocumentStorage { put(bytes: Uint8Array): Promise<string>; get(key: string): Promise<Buffer>; delete(key: string): Promise<void> }
export class PrivateStorage implements DocumentStorage {
  private container?: ContainerClient
  constructor(private root = resolve('data/blobs'), accountUrl?: string, container = 'production-private') {
    if (accountUrl) this.container = new BlobServiceClient(accountUrl, new DefaultAzureCredential()).getContainerClient(container)
  }
  private valid(key: string) { if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error('Invalid storage key'); return key }
  async put(bytes: Uint8Array) {
    const key = randomUUID()
    if (this.container) await this.container.getBlockBlobClient(key).uploadData(bytes)
    else { const path = resolve(this.root, key); await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }) }
    return key
  }
  async get(key: string) { this.valid(key); return this.container ? this.container.getBlockBlobClient(key).downloadToBuffer() : readFile(resolve(this.root, key)) }
  async delete(key: string) {
    this.valid(key)
    if (this.container) await this.container.getBlockBlobClient(key).deleteIfExists({ deleteSnapshots: 'include' })
    else {
      // A validated UUID is a single filename inside this configured private root.
      try { await unlink(resolve(this.root, key)) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
  }
}
