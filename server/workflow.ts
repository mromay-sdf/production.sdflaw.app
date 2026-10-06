import { createHash, randomUUID } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import { z } from 'zod'
import type { Production, ProductionDocument, ValidationCheck, BatesSettings, BatesProgress } from '../shared/model'
import { pages } from '../shared/model'
import { streamBatesToSeparateFiles, mergePdfs, getBatesStandardFont } from '../shared/sdf-pdf/pdf/merge'
import { calculateTextPlacement, normalizeRotation, getVisualDimensions } from '../shared/sdf-pdf/pdf/coordinates'
import { formatBatesNumber } from '../shared/sdf-pdf/pdf/bates'
import { validateBatesRange } from '../shared/sdf-pdf/pdf/validation'
import { createUniqueBatesOutputFilename } from '../shared/sdf-pdf/utils/bates-output'
import type { DocumentStorage } from './storage'
import { HttpError } from './store'
export const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
export const batesSchema = z.object({
  prefix: z.string().max(40).regex(/^[\x20-\x7e]*$/), suffix: z.string().max(20).regex(/^[\x20-\x7e]*$/),
  startNumber: z.number().int().min(0).max(999999999999), digits: z.number().int().min(1).max(12),
  position: z.enum(['top-left','top-center','top-right','bottom-left','bottom-center','bottom-right']),
  fontFamily: z.enum(['Helvetica','Times Roman','Courier']), fontStyle: z.enum(['regular','bold','italic','bold-italic']),
  fontSize: z.number().min(6).max(24), horizontalMargin: z.number().min(0).max(144), verticalMargin: z.number().min(0).max(144)
}).strict()
export function invalidate(p: Production, outputs = false) {
  p.validation = undefined
  if (outputs) {
    p.combinedKey = undefined; p.processedSettings = undefined; p.processedFiles = undefined
    for (const d of p.documents) { delete d.processedKey; delete d.processedSha256; delete d.firstBates; delete d.lastBates; delete d.firstNumber; delete d.lastNumber; delete d.finalName; if (d.status === 'Processed') d.status = 'Ready' }
  }
  p.status = p.publishedSnapshotId ? 'Published' : p.documents.length && p.documents.every(d => d.processedKey) ? 'Ready for Review' : 'Draft'
}
export async function inspect(bytes: Uint8Array): Promise<{pageCount: number; status: ProductionDocument['status']; problem?: string}> {
  try {
    if (!Buffer.from(bytes.subarray(0, 1024)).includes(Buffer.from('%PDF-'))) throw new Error('Invalid PDF header')
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false, throwOnInvalidObject: true })
    if (!pdf.getPageCount()) throw new Error('Empty PDF')
    return { pageCount: pdf.getPageCount(), status: 'Ready' }
  } catch (e) {
    const encrypted = /encrypt|password/i.test(String(e))
    return { pageCount: 0, status: encrypted ? 'Protected' : 'Unreadable', problem: encrypted ? 'Encrypted or password-protected PDF. Provide an unprotected copy.' : 'Unreadable, empty, or unsupported PDF. Check the source file.' }
  }
}
export async function label(p: Production, storage: DocumentStorage, settings: BatesSettings, combined: boolean, onProgress?: (progress: BatesProgress) => void) {
  const progress: BatesProgress = {phase:'Checking PDFs',currentPage:0,totalPages:pages(p),completedDocuments:0,totalDocuments:p.documents.length,fileName:''}
  const report=(change:Partial<BatesProgress>)=>{Object.assign(progress,change);onProgress?.({...progress})}
  if (!p.documents.length) throw new HttpError(400, 'Add PDFs before labeling.')
  if (p.documents.some(d => ['Protected','Unreadable'].includes(d.status))) throw new HttpError(400, 'Remove or replace problematic PDFs before labeling.')
  try { validateBatesRange(settings.startNumber, settings.digits, pages(p)) } catch (error) { throw new HttpError(400, (error as Error).message) }
  if (pages(p) > 10000 || p.documents.reduce((n,d) => n+d.size,0) > 256 * 1024 * 1024) throw new HttpError(400, 'This release supports up to 10,000 pages and 256 MB of source PDFs per production.')
  const inputs = []
  let nextNumber = settings.startNumber
  for (const d of p.documents) {
    report({fileName:d.originalName})
    const bytes = await storage.get(d.originalKey)
    if (hash(bytes) !== d.sha256) throw new HttpError(400, 'A source PDF failed its integrity check.')
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false, throwOnInvalidObject: true })
    const font = await pdf.embedFont(getBatesStandardFont(settings.fontFamily, settings.fontStyle))
    for (const page of pdf.getPages()) {
      const box = page.getCropBox(), rotation = normalizeRotation(page.getRotation().angle)
      const width = font.widthOfTextAtSize(formatBatesNumber(nextNumber++, settings), settings.fontSize)
      const pos = calculateTextPlacement({box, rotation, position: settings.position, textWidth: width, fontSize: settings.fontSize, horizontalMargin: settings.horizontalMargin, verticalMargin: settings.verticalMargin})
      const visual = getVisualDimensions(box, rotation)
      if (pos.visualX + width > visual.width || pos.visualY + settings.fontSize > visual.height || width + 2*settings.horizontalMargin > visual.width) throw new HttpError(400, `${d.originalName}: Bates label does not fit the visible page. Reduce the label width, font size, or margins.`)
    }
    inputs.push({id:d.id,name:d.originalName,size:d.size,pageCount:d.pageCount,bytes})
  }
  const used = new Set<string>(); let offset = settings.startNumber
  const outputs: { id: string; name: string; size: number; pageCount: number; bytes: Uint8Array }[] = []
  await streamBatesToSeparateFiles(inputs, settings, event=>report({...event,phase:'Applying Bates labels'}), async (output, i) => {
    report({phase:'Saving PDFs',fileName:p.documents[i].originalName})
    const d = p.documents[i]
    // Preserve the inherited stamping geometry. Only branding metadata is adapted for server execution.
    const pdf = await PDFDocument.load(output.bytes)
    pdf.setProducer('SDF Production • shared SDF Bates engine'); pdf.setCreator('SDF Production')
    const bytes = await pdf.save()
    d.processedKey = await storage.put(bytes); d.processedSha256 = hash(bytes)
    d.finalName = createUniqueBatesOutputFilename(d.originalName, output.firstBates, output.lastBates, true, used)
    d.firstBates = output.firstBates; d.lastBates = output.lastBates
    d.firstNumber = offset; d.lastNumber = offset + output.pageCount - 1; offset += output.pageCount
    d.status = 'Processed'
    report({completedDocuments:i+1})
    if (combined) outputs.push({id:d.id,name:d.finalName,size:bytes.length,pageCount:d.pageCount,bytes})
  })
  p.processedFiles = p.documents.map(d => ({ documentId: d.id, key: d.processedKey!, sha256: d.processedSha256! }))
  if(combined)report({phase:'Combining PDFs',fileName:''})
  p.combinedKey = combined ? await storage.put(await mergePdfs(outputs)) : undefined
  p.bates = settings; p.processedSettings = settings; invalidate(p)
  report({phase:'Saving production',fileName:''})
}
export async function validate(p: Production, storage: DocumentStorage) {
  const checks: ValidationCheck[] = []
  const add = (name: string, bad: number, detail: string, warning = false) => checks.push({name,status:bad ? warning ? 'warning' : 'error' : 'success',detail})
  add('Document count', !p.documents.length ? 1 : 0, `${p.documents.length} documents; ${pages(p)} pages`)
  const duplicates = (names: string[]) => names.length - new Set(names.map(s => s.toLowerCase())).size
  const sourceDuplicates = duplicates(p.documents.map(d=>d.originalName))
  add('Duplicate source filenames', sourceDuplicates, `${sourceDuplicates} duplicate source filenames (output names are made unique)`, true)
  const collisions = duplicates(p.documents.filter(d=>d.finalName).map(d=>d.finalName!))
  add('Output filename collisions', collisions, `${collisions} filename collisions`)
  add('Protected PDFs', p.documents.filter(d=>d.status==='Protected').length, `${p.documents.filter(d=>d.status==='Protected').length} protected PDFs`)
  add('Unreadable PDFs', p.documents.filter(d=>d.status==='Unreadable').length, `${p.documents.filter(d=>d.status==='Unreadable').length} unreadable PDFs`)
  let missing=0, unreadable=0, mismatch=0, gaps=0, overlaps=0, badRanges=0
  let expected=p.processedSettings?.startNumber
  for (const d of p.documents) {
    if (d.firstNumber === undefined || d.lastNumber === undefined || !p.processedSettings) badRanges++
    else {
      if (expected !== undefined && d.firstNumber>expected) gaps++
      if (expected !== undefined && d.firstNumber<expected) overlaps++
      expected=d.lastNumber+1
      if (d.lastNumber-d.firstNumber+1!==d.pageCount || d.firstBates!==formatBatesNumber(d.firstNumber,p.processedSettings) || d.lastBates!==formatBatesNumber(d.lastNumber,p.processedSettings)) badRanges++
    }
    if (!d.processedKey) { missing++; continue }
    let bytes: Buffer
    try { bytes=await storage.get(d.processedKey) } catch { missing++; continue }
    if(hash(bytes)!==d.processedSha256) mismatch++
    try { const pdf=await PDFDocument.load(bytes,{ignoreEncryption:false,throwOnInvalidObject:true}); if(pdf.getPageCount()!==d.pageCount) mismatch++ } catch { unreadable++ }
  }
  add('Bates gaps',gaps,`${gaps} Bates gaps`); add('Bates overlaps',overlaps,`${overlaps} Bates overlaps`)
  add('Index ranges',badRanges,`${badRanges} missing or inconsistent Bates ranges`)
  add('Index / PDF matching',missing,`${p.documents.length} index rows; ${p.documents.length-missing} matching processed PDFs; ${missing} missing PDFs`)
  const orphanFiles=(p.processedFiles??[]).filter(f=>!p.documents.some(d=>d.id===f.documentId&&d.processedKey===f.key))
  const unmatchedRows=p.documents.filter(d=>!p.processedFiles?.some(f=>f.documentId===d.id&&f.key===d.processedKey&&f.sha256===d.processedSha256))
  add('PDF / index manifest',orphanFiles.length+unmatchedRows.length,`${orphanFiles.length} PDFs without index rows; ${unmatchedRows.length} index rows without matching manifest entries`)
  const references = p.documents.filter(d=>d.processedKey).map(d=>d.processedKey!)
  add('Unique PDF references',duplicates(references),`${duplicates(references)} duplicate PDF references; snapshot PDFs derive from index rows`)
  add('Processed PDF integrity',mismatch+unreadable,`${mismatch} integrity/page-count failures; ${unreadable} unreadable processed PDFs`)
  p.validation={id:randomUUID(),at:new Date().toISOString(),revision:p.revision+1,checks}
  return p.validation
}
