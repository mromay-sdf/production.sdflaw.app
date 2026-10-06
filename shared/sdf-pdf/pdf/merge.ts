import {
  degrees,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  rgb,
  StandardFonts,
} from 'pdf-lib'
import type { BatesFontFamily, BatesFontStyle, BatesSettings, PdfInput, ProcessProgress } from '../types/pdf'
import { formatBatesNumber } from './bates'
import { calculateTextPlacement, normalizeRotation } from './coordinates'
import { getTableOfContentsPageCount, TOC_ENTRIES_PER_PAGE } from './toc'
import { validateBatesRange } from './validation'

export { getTableOfContentsPageCount } from './toc'

export interface SeparateBatesOutput {
  fileName: string
  bytes: Uint8Array
  pageCount: number
  firstBates: string
  lastBates: string
}

export interface MergedPdfOptions {
  includeTableOfContents?: boolean
}

const TOC_PAGE_SIZE: [number, number] = [612, 792]
const TOC_LINK_RECT = { x: 50, width: 508, height: 18 }

export function getBatesStandardFont(family: BatesFontFamily, style: BatesFontStyle): StandardFonts {
  const fonts: Record<BatesFontFamily, Record<BatesFontStyle, StandardFonts>> = {
    Helvetica: {
      regular: StandardFonts.Helvetica,
      bold: StandardFonts.HelveticaBold,
      italic: StandardFonts.HelveticaOblique,
      'bold-italic': StandardFonts.HelveticaBoldOblique,
    },
    'Times Roman': {
      regular: StandardFonts.TimesRoman,
      bold: StandardFonts.TimesRomanBold,
      italic: StandardFonts.TimesRomanItalic,
      'bold-italic': StandardFonts.TimesRomanBoldItalic,
    },
    Courier: {
      regular: StandardFonts.Courier,
      bold: StandardFonts.CourierBold,
      italic: StandardFonts.CourierOblique,
      'bold-italic': StandardFonts.CourierBoldOblique,
    },
  }
  return fonts[family][style]
}

function safeHelveticaText(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, '?')
}

function truncateText(value: string, maxWidth: number, font: Awaited<ReturnType<PDFDocument['embedFont']>>, size: number): string {
  const safeValue = safeHelveticaText(value)
  if (font.widthOfTextAtSize(safeValue, size) <= maxWidth) return safeValue
  let shortened = safeValue
  while (shortened.length > 1 && font.widthOfTextAtSize(`${shortened}...`, size) > maxWidth) {
    shortened = shortened.slice(0, -1)
  }
  return `${shortened}...`
}

async function addTableOfContents(output: PDFDocument, files: readonly PdfInput[]) {
  const regularFont = await output.embedFont(StandardFonts.Helvetica)
  const boldFont = await output.embedFont(StandardFonts.HelveticaBold)
  const tocPageCount = getTableOfContentsPageCount(files)
  let sourcePageOffset = 0

  for (let tocPageIndex = 0; tocPageIndex < tocPageCount; tocPageIndex += 1) {
    const page = output.addPage(TOC_PAGE_SIZE)
    page.drawText('TABLE OF CONTENTS', {
      x: 54, y: 724, size: 20, font: boldFont, color: rgb(0.05, 0.17, 0.31),
    })
    page.drawText('Document', { x: 54, y: 690, size: 9, font: boldFont, color: rgb(0.28, 0.35, 0.43) })
    page.drawText('Page', { x: 520, y: 690, size: 9, font: boldFont, color: rgb(0.28, 0.35, 0.43) })
    page.drawLine({ start: { x: 54, y: 682 }, end: { x: 558, y: 682 }, thickness: 0.75, color: rgb(0.72, 0.76, 0.81) })

    const startIndex = tocPageIndex * TOC_ENTRIES_PER_PAGE
    const pageFiles = files.slice(startIndex, startIndex + TOC_ENTRIES_PER_PAGE)
    pageFiles.forEach((file, entryIndex) => {
      const absoluteIndex = startIndex + entryIndex
      sourcePageOffset = files.slice(0, absoluteIndex).reduce((sum, item) => sum + item.pageCount, 0)
      const startingPage = tocPageCount + sourcePageOffset + 1
      const y = 656 - entryIndex * 24
      const name = truncateText(file.name, 430, regularFont, 10)
      page.drawText(name, { x: 54, y, size: 10, font: regularFont, color: rgb(0.09, 0.13, 0.18) })
      page.drawText(String(startingPage), { x: 526, y, size: 10, font: regularFont, color: rgb(0.09, 0.13, 0.18) })
      if (entryIndex < pageFiles.length - 1) {
        page.drawLine({ start: { x: 54, y: y - 8 }, end: { x: 558, y: y - 8 }, thickness: 0.35, color: rgb(0.88, 0.9, 0.92) })
      }
    })

  }
}

function addTableOfContentsLinks(output: PDFDocument, files: readonly PdfInput[]) {
  const tocPageCount = getTableOfContentsPageCount(files)

  files.forEach((_, absoluteIndex) => {
    const tocPageIndex = Math.floor(absoluteIndex / TOC_ENTRIES_PER_PAGE)
    const entryIndex = absoluteIndex % TOC_ENTRIES_PER_PAGE
    const sourcePageOffset = files
      .slice(0, absoluteIndex)
      .reduce((sum, item) => sum + item.pageCount, 0)
    const targetPageIndex = tocPageCount + sourcePageOffset
    const y = 656 - entryIndex * 24
    const tocPage = output.getPage(tocPageIndex)
    const targetPage = output.getPage(targetPageIndex)

    // pdf-lib does not expose a high-level internal-link API. Registering a
    // standard Link annotation keeps the visible TOC vector-based while making
    // the full row navigate to the source document's first output page.
    const link = output.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [TOC_LINK_RECT.x, y - 4, TOC_LINK_RECT.x + TOC_LINK_RECT.width, y - 4 + TOC_LINK_RECT.height],
      Border: [0, 0, 0],
      Dest: [targetPage.ref, 'Fit'],
      F: 4,
    })
    tocPage.node.addAnnot(output.context.register(link))
  })
}

function addDocumentBookmarks(output: PDFDocument, files: readonly PdfInput[]) {
  if (files.length === 0) return

  const tocPageCount = getTableOfContentsPageCount(files)
  const outlines = output.context.obj({ Type: 'Outlines' })
  const outlinesRef = output.context.register(outlines)
  const bookmarks = [
    { title: 'Table of Contents', targetPageIndex: 0 },
    ...files.map((file, index) => ({
      title: file.name,
      targetPageIndex: tocPageCount + files
        .slice(0, index)
        .reduce((sum, item) => sum + item.pageCount, 0),
    })),
  ]
  const items = bookmarks.map(({ title, targetPageIndex }) => {
    const targetPage = output.getPage(targetPageIndex)
    const item = output.context.obj({
      Title: PDFHexString.fromText(title),
      Parent: outlinesRef,
      Dest: [targetPage.ref, 'Fit'],
    })
    return { item, ref: output.context.register(item) }
  })

  items.forEach(({ item }, index) => {
    const previous = items[index - 1]
    const next = items[index + 1]
    if (previous) item.set(PDFName.of('Prev'), previous.ref)
    if (next) item.set(PDFName.of('Next'), next.ref)
  })

  outlines.set(PDFName.of('First'), items[0].ref)
  outlines.set(PDFName.of('Last'), items.at(-1)!.ref)
  outlines.set(PDFName.of('Count'), PDFNumber.of(items.length))
  output.catalog.set(PDFName.of('Outlines'), outlinesRef)
  output.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'))
}

function addTableOfContentsNavigation(output: PDFDocument, files: readonly PdfInput[]) {
  addTableOfContentsLinks(output, files)
  addDocumentBookmarks(output, files)
}

async function loadPdf(file: PdfInput): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(file.bytes, {
      ignoreEncryption: false,
      updateMetadata: false,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`${file.name}: PDF processing failed. ${detail}`)
  }
}

function withPdfMemoryError(error: unknown): never {
  if (error instanceof RangeError || error instanceof WebAssembly.RuntimeError) {
    throw new Error(
      'The browser ran out of memory while processing these files. Try fewer or smaller PDFs.',
    )
  }
  throw error
}

function setOutputMetadata(document: PDFDocument) {
  document.setProducer('SDF PDF Tools (local browser processing)')
  document.setCreator('SDF PDF Tools')
}

export async function mergePdfs(
  files: readonly PdfInput[],
  onProgress?: (progress: ProcessProgress) => void,
  options: MergedPdfOptions = {},
): Promise<Uint8Array> {
  if (files.length === 0) throw new Error('Add at least one PDF before processing.')
  const tocPageCount = options.includeTableOfContents ? getTableOfContentsPageCount(files) : 0
  const totalPages = files.reduce((total, file) => total + file.pageCount, tocPageCount)

  try {
    const output = await PDFDocument.create()
    let processedPages = 0
    if (options.includeTableOfContents) {
      await addTableOfContents(output, files)
      processedPages = tocPageCount
      onProgress?.({
        currentPage: processedPages,
        totalPages,
        fileName: 'Table of Contents',
        batesValue: '',
      })
    }
    for (const file of files) {
      const source = await loadPdf(file)
      const copiedPages = await output.copyPages(source, source.getPageIndices())
      for (const copiedPage of copiedPages) {
        output.addPage(copiedPage)
        processedPages += 1
        onProgress?.({
          currentPage: processedPages,
          totalPages,
          fileName: file.name,
          batesValue: '',
        })
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
    }
    if (options.includeTableOfContents) addTableOfContentsNavigation(output, files)
    setOutputMetadata(output)
    return await output.save()
  } catch (error) {
    return withPdfMemoryError(error)
  }
}

export async function mergeAndApplyBates(
  files: readonly PdfInput[],
  settings: BatesSettings,
  onProgress?: (progress: ProcessProgress) => void,
  options: MergedPdfOptions = {},
): Promise<Uint8Array> {
  if (files.length === 0) throw new Error('Add at least one PDF before processing.')

  const tocPageCount = options.includeTableOfContents ? getTableOfContentsPageCount(files) : 0
  const totalPages = files.reduce((total, file) => total + file.pageCount, tocPageCount)
  validateBatesRange(settings.startNumber, settings.digits, totalPages)

  try {
    const output = await PDFDocument.create()
    const font = await output.embedFont(getBatesStandardFont(settings.fontFamily, settings.fontStyle))
    let processedPages = 0

    if (options.includeTableOfContents) {
      await addTableOfContents(output, files)
      for (const tocPage of output.getPages()) {
        const batesValue = formatBatesNumber(settings.startNumber + processedPages, settings)
        const cropBox = tocPage.getCropBox()
        const textWidth = font.widthOfTextAtSize(batesValue, settings.fontSize)
        const placement = calculateTextPlacement({
          box: cropBox,
          rotation: 0,
          position: settings.position,
          textWidth,
          fontSize: settings.fontSize,
          horizontalMargin: settings.horizontalMargin,
          verticalMargin: settings.verticalMargin,
        })
        tocPage.drawText(batesValue, {
          x: placement.x, y: placement.y, size: settings.fontSize, font,
          color: rgb(0.08, 0.08, 0.08), rotate: degrees(placement.rotation),
        })
        processedPages += 1
        onProgress?.({
          currentPage: processedPages,
          totalPages,
          fileName: 'Table of Contents',
          batesValue,
        })
      }
    }

    for (const file of files) {
      const source = await loadPdf(file)

      const copiedPages = await output.copyPages(source, source.getPageIndices())
      for (const copiedPage of copiedPages) {
        output.addPage(copiedPage)
        const batesValue = formatBatesNumber(
          settings.startNumber + processedPages,
          settings,
        )
        const cropBox = copiedPage.getCropBox()
        const rotation = normalizeRotation(copiedPage.getRotation().angle)
        const textWidth = font.widthOfTextAtSize(batesValue, settings.fontSize)
        const placement = calculateTextPlacement({
          box: cropBox,
          rotation,
          position: settings.position,
          textWidth,
          fontSize: settings.fontSize,
          horizontalMargin: settings.horizontalMargin,
          verticalMargin: settings.verticalMargin,
        })

        copiedPage.drawText(batesValue, {
          x: placement.x,
          y: placement.y,
          size: settings.fontSize,
          font,
          color: rgb(0.08, 0.08, 0.08),
          rotate: degrees(placement.rotation),
        })

        processedPages += 1
        onProgress?.({
          currentPage: processedPages,
          totalPages,
          fileName: file.name,
          batesValue,
        })
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
    }

    if (options.includeTableOfContents) addTableOfContentsNavigation(output, files)

    setOutputMetadata(output)
    return await output.save()
  } catch (error) {
    return withPdfMemoryError(error)
  }
}

export async function streamBatesToSeparateFiles(
  files: readonly PdfInput[],
  settings: BatesSettings,
  onProgress?: (progress: ProcessProgress) => void,
  onOutput?: (output: SeparateBatesOutput, fileIndex: number) => void | Promise<void>,
): Promise<void> {
  if (files.length === 0) throw new Error('Add at least one PDF before processing.')
  const totalPages = files.reduce((total, file) => total + file.pageCount, 0)
  validateBatesRange(settings.startNumber, settings.digits, totalPages)

  try {
    let processedPages = 0
    let fileIndex = 0
    for (const file of files) {
      const source = await loadPdf(file)
      const output = await PDFDocument.create()
      const font = await output.embedFont(getBatesStandardFont(settings.fontFamily, settings.fontStyle))
      const copiedPages = await output.copyPages(source, source.getPageIndices())
      const firstNumber = settings.startNumber + processedPages

      for (const copiedPage of copiedPages) {
        output.addPage(copiedPage)
        const batesValue = formatBatesNumber(settings.startNumber + processedPages, settings)
        const cropBox = copiedPage.getCropBox()
        const rotation = normalizeRotation(copiedPage.getRotation().angle)
        const textWidth = font.widthOfTextAtSize(batesValue, settings.fontSize)
        const placement = calculateTextPlacement({
          box: cropBox,
          rotation,
          position: settings.position,
          textWidth,
          fontSize: settings.fontSize,
          horizontalMargin: settings.horizontalMargin,
          verticalMargin: settings.verticalMargin,
        })
        copiedPage.drawText(batesValue, {
          x: placement.x,
          y: placement.y,
          size: settings.fontSize,
          font,
          color: rgb(0.08, 0.08, 0.08),
          rotate: degrees(placement.rotation),
        })
        processedPages += 1
        onProgress?.({
          currentPage: processedPages,
          totalPages,
          fileName: file.name,
          batesValue,
        })
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }

      setOutputMetadata(output)
      const baseName = file.name.replace(/\.pdf$/i, '') || 'Document'
      await onOutput?.({
        fileName: `${baseName}_Bates.pdf`,
        bytes: await output.save(),
        pageCount: copiedPages.length,
        firstBates: formatBatesNumber(firstNumber, settings),
        lastBates: formatBatesNumber(firstNumber + copiedPages.length - 1, settings),
      }, fileIndex)
      fileIndex += 1
    }
  } catch (error) {
    return withPdfMemoryError(error)
  }
}

export async function applyBatesToSeparateFiles(
  files: readonly PdfInput[],
  settings: BatesSettings,
  onProgress?: (progress: ProcessProgress) => void,
): Promise<SeparateBatesOutput[]> {
  const results: SeparateBatesOutput[] = []
  await streamBatesToSeparateFiles(files, settings, onProgress, (output) => {
    results.push(output)
  })
  return results
}
