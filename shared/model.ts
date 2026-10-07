import type { BatesSettings } from './sdf-pdf/types/pdf'
export type { BatesSettings }
export interface Identity { id: string; name: string; email?: string }
export interface ProductionAccess { role: 'owner' | 'editor'; members: Identity[] }
export interface Tag { id: string; name: string }
export interface ProductionDocument {
  id: string; originalName: string; finalName?: string; displayName: string;
  originalKey: string; processedKey?: string; sha256: string; processedSha256?: string;
  size: number; pageCount: number; firstBates?: string; lastBates?: string;
  firstNumber?: number; lastNumber?: number; description: string; documentDate: string;
  tagIds: string[]; status: 'Ready' | 'Processed' | 'Protected' | 'Unreadable'; problem?: string;
  source: { provider: 'upload' | 'imanage'; externalId?: string; matterId?: string }
}
export interface ValidationCheck { name: string; status: 'success' | 'warning' | 'error'; detail: string }
export interface ValidationResult { id: string; at: string; revision: number; checks: ValidationCheck[] }
export interface ProductionExport { id: string; at: string; by: Identity; kind: 'publish' | 'offline' | 'index' | 'indexed-pdf'; key?: string; snapshotId: string; revision: number }
export interface BatesProgress { phase: 'Checking PDFs' | 'Applying Bates labels' | 'Saving PDFs' | 'Combining PDFs' | 'Saving production'; currentPage: number; totalPages: number; completedDocuments: number; totalDocuments: number; fileName: string; batesValue?: string }
export interface Production {
  access?: ProductionAccess;
  id: string; name: string; matter: string; description: string; createdBy: Identity;
  createdAt: string; updatedAt: string; revision: number;
  status: 'Draft' | 'Ready for Review' | 'Published' | 'Archived';
  documents: ProductionDocument[]; tags: Tag[]; bates: BatesSettings;
  validation?: ValidationResult; exports: ProductionExport[];
  publishedSnapshotId?: string; combinedKey?: string; processedSettings?: BatesSettings;
  processedFiles?: { documentId: string; key: string; sha256: string }[];
  externalMatterId?: string;
}
export const defaultBates: BatesSettings = { prefix: 'SDF_', suffix: '', startNumber: 1, digits: 6, position: 'bottom-right', fontFamily: 'Helvetica', fontStyle: 'regular', fontSize: 8, horizontalMargin: 36, verticalMargin: 36 }
export const pages = (p: Production) => p.documents.reduce((n, d) => n + d.pageCount, 0)
export const batesRange = (p: Production) => p.documents.length && p.documents.every(d => d.firstBates && d.lastBates) ? `${p.documents[0].firstBates} – ${p.documents.at(-1)!.lastBates}` : 'Not labeled'
export function matchesDocument(d: ProductionDocument, q: string, tags: Tag[]) {
  const query = q.trim().toLowerCase()
  if (!query) return true
  if ([d.displayName, d.originalName, d.finalName, d.description, d.firstBates, d.lastBates, ...tags.filter(t => d.tagIds.includes(t.id)).map(t => t.name)].filter(Boolean).join(' ').toLowerCase().includes(query)) return true
  if (d.firstNumber === undefined || d.lastNumber === undefined || !d.firstBates) return false
  const numeric = String(d.firstNumber)
  // Match a full Bates label, including the prefix/suffix and zero padding.
  const digitRun = d.firstBates.match(/^(.*?)(\d+)(\D*)$/)
  if (!digitRun || Number(digitRun[2]) !== Number(numeric)) return false
  const [, prefix, digits, suffix] = digitRun
  if (!query.startsWith(prefix.toLowerCase()) || !query.endsWith(suffix.toLowerCase())) return false
  const value = query.slice(prefix.length, suffix ? -suffix.length : undefined)
  return /^\d+$/.test(value) && value.length === digits.length && Number(value) >= d.firstNumber && Number(value) <= d.lastNumber
}
