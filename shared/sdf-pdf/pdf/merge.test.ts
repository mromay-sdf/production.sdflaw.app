import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, rgb } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import type { BatesSettings, PdfInput } from '../types/pdf'
import {
  applyBatesToSeparateFiles,
  getBatesStandardFont,
  getTableOfContentsPageCount,
  mergeAndApplyBates,
  mergePdfs,
} from './merge'

const settings: BatesSettings = {
  prefix: 'SDF_', startNumber: 1, digits: 6, suffix: '',
  position: 'bottom-right', fontFamily: 'Helvetica', fontStyle: 'regular', fontSize: 8, horizontalMargin: 36, verticalMargin: 36,
}

async function makeInput(name: string, sizes: Array<[number, number]>): Promise<PdfInput> {
  const document = await PDFDocument.create()
  sizes.forEach(([width, height], index) => {
    const page = document.addPage([width, height])
    page.drawRectangle({ x: index + 1, y: index + 1, width: 5, height: 5, color: rgb(0, 0, 0) })
  })
  const bytes = await document.save()
  return { id: name, name, size: bytes.length, pageCount: sizes.length, bytes }
}

describe('PDF merge and Bates processing', () => {
  it('maps every selected family and style to the matching embedded PDF Base14 font', async () => {
    const { StandardFonts } = await import('pdf-lib')
    expect([
      getBatesStandardFont('Helvetica', 'regular'),
      getBatesStandardFont('Helvetica', 'bold'),
      getBatesStandardFont('Helvetica', 'italic'),
      getBatesStandardFont('Helvetica', 'bold-italic'),
      getBatesStandardFont('Times Roman', 'regular'),
      getBatesStandardFont('Times Roman', 'bold'),
      getBatesStandardFont('Times Roman', 'italic'),
      getBatesStandardFont('Times Roman', 'bold-italic'),
      getBatesStandardFont('Courier', 'regular'),
      getBatesStandardFont('Courier', 'bold'),
      getBatesStandardFont('Courier', 'italic'),
      getBatesStandardFont('Courier', 'bold-italic'),
    ]).toEqual([
      StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique,
      StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic,
      StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique,
    ])
  })

  it('merges two PDFs and preserves page order', async () => {
    const first = await makeInput('first.pdf', [[300, 500], [310, 510]])
    const second = await makeInput('second.pdf', [[700, 400]])
    const result = await mergeAndApplyBates([first, second], settings)
    const merged = await PDFDocument.load(result)
    expect(merged.getPageCount()).toBe(3)
    expect(merged.getPages().map((page) => [page.getWidth(), page.getHeight()])).toEqual([
      [300, 500], [310, 510], [700, 400],
    ])
  })

  it('handles mixed portrait and landscape pages', async () => {
    const input = await makeInput('mixed.pdf', [[612, 792], [792, 612]])
    const result = await mergeAndApplyBates([input], settings)
    const merged = await PDFDocument.load(result)
    expect(merged.getPages().map((page) => [page.getWidth(), page.getHeight()])).toEqual([
      [612, 792], [792, 612],
    ])
  })

  it('reports continuous Bates progress across documents', async () => {
    const first = await makeInput('first.pdf', [[300, 500], [300, 500]])
    const second = await makeInput('second.pdf', [[300, 500]])
    const values: string[] = []
    await mergeAndApplyBates([first, second], { ...settings, startNumber: 98 }, (progress) => {
      values.push(progress.batesValue)
    })
    expect(values).toEqual(['SDF_000098', 'SDF_000099', 'SDF_000100'])
  })

  it('merges PDFs without applying Bates labels', async () => {
    const first = await makeInput('first.pdf', [[300, 500]])
    const second = await makeInput('second.pdf', [[700, 400]])
    const values: string[] = []
    const result = await mergePdfs([first, second], (progress) => values.push(progress.batesValue))
    const merged = await PDFDocument.load(result)
    expect(merged.getPages().map((page) => [page.getWidth(), page.getHeight()])).toEqual([
      [300, 500], [700, 400],
    ])
    expect(values).toEqual(['', ''])
  })

  it('keeps files separate while Bates numbering continues across them', async () => {
    const first = await makeInput('first.pdf', [[300, 500], [300, 500]])
    const second = await makeInput('second.pdf', [[700, 400]])
    const values: string[] = []
    const results = await applyBatesToSeparateFiles(
      [first, second],
      { ...settings, startNumber: 98 },
      (progress) => values.push(progress.batesValue),
    )

    expect(results.map(({ fileName, pageCount, firstBates, lastBates }) => ({
      fileName, pageCount, firstBates, lastBates,
    }))).toEqual([
      { fileName: 'first_Bates.pdf', pageCount: 2, firstBates: 'SDF_000098', lastBates: 'SDF_000099' },
      { fileName: 'second_Bates.pdf', pageCount: 1, firstBates: 'SDF_000100', lastBates: 'SDF_000100' },
    ])
    expect(values).toEqual(['SDF_000098', 'SDF_000099', 'SDF_000100'])
    expect((await PDFDocument.load(results[0].bytes)).getPageCount()).toBe(2)
    expect((await PDFDocument.load(results[1].bytes)).getPageCount()).toBe(1)
  })

  it('adds a leading table of contents page to a merged PDF', async () => {
    const first = await makeInput('Pleadings.pdf', [[300, 500], [300, 500]])
    const second = await makeInput('Exhibits.pdf', [[700, 400]])
    const progress: Array<{ page: number; file: string }> = []
    const result = await mergePdfs(
      [first, second],
      (value) => progress.push({ page: value.currentPage, file: value.fileName }),
      { includeTableOfContents: true },
    )
    const merged = await PDFDocument.load(result)

    expect(merged.getPageCount()).toBe(4)
    expect([merged.getPage(0).getWidth(), merged.getPage(0).getHeight()]).toEqual([612, 792])
    expect(progress[0]).toEqual({ page: 1, file: 'Table of Contents' })
    expect(progress.at(-1)).toEqual({ page: 4, file: 'Exhibits.pdf' })
  })

  it('adds linked TOC entries and document bookmarks targeting each start page', async () => {
    const first = await makeInput('Pleadings.pdf', [[300, 500], [300, 500]])
    const second = await makeInput('Exhibits.pdf', [[700, 400]])
    const result = await mergePdfs([first, second], undefined, { includeTableOfContents: true })
    const merged = await PDFDocument.load(result)
    const annotations = merged.getPage(0).node.Annots()

    expect(annotations?.size()).toBe(2)
    const targetRefs = Array.from({ length: annotations?.size() ?? 0 }, (_, index) => {
      const annotation = merged.context.lookup(annotations!.get(index), PDFDict)
      expect(annotation.get(PDFName.of('Subtype'))).toEqual(PDFName.of('Link'))
      const destination = annotation.lookup(PDFName.of('Dest'), PDFArray)
      expect(destination.get(1)).toEqual(PDFName.of('Fit'))
      return destination.get(0).toString()
    })

    expect(targetRefs).toEqual([
      merged.getPage(1).ref.toString(),
      merged.getPage(3).ref.toString(),
    ])

    expect(merged.catalog.get(PDFName.of('PageMode'))).toEqual(PDFName.of('UseOutlines'))
    const outlines = merged.catalog.lookup(PDFName.of('Outlines'), PDFDict)
    expect(outlines.lookup(PDFName.of('Count'), PDFNumber).asNumber()).toBe(3)
    const tocBookmark = outlines.lookup(PDFName.of('First'), PDFDict)
    const firstBookmark = tocBookmark.lookup(PDFName.of('Next'), PDFDict)
    const secondBookmark = firstBookmark.lookup(PDFName.of('Next'), PDFDict)
    expect(tocBookmark.lookup(PDFName.of('Title'), PDFHexString).decodeText()).toBe('Table of Contents')
    expect(firstBookmark.lookup(PDFName.of('Title'), PDFHexString).decodeText()).toBe('Pleadings.pdf')
    expect(secondBookmark.lookup(PDFName.of('Title'), PDFHexString).decodeText()).toBe('Exhibits.pdf')
    expect(firstBookmark.get(PDFName.of('Prev'))).toEqual(outlines.get(PDFName.of('First')))
    expect(tocBookmark.lookup(PDFName.of('Dest'), PDFArray).get(0).toString()).toBe(
      merged.getPage(0).ref.toString(),
    )
    expect(firstBookmark.lookup(PDFName.of('Dest'), PDFArray).get(0).toString()).toBe(
      merged.getPage(1).ref.toString(),
    )
    expect(secondBookmark.lookup(PDFName.of('Dest'), PDFArray).get(0).toString()).toBe(
      merged.getPage(3).ref.toString(),
    )
  })

  it('includes TOC pages in the Bates sequence and supports multi-page contents', async () => {
    const inputs = await Promise.all(
      Array.from({ length: 25 }, (_, index) => makeInput(`Document ${index + 1}.pdf`, [[300, 500]])),
    )
    const values: string[] = []
    const result = await mergeAndApplyBates(
      inputs,
      settings,
      (progress) => values.push(progress.batesValue),
      { includeTableOfContents: true },
    )

    expect(getTableOfContentsPageCount(inputs)).toBe(2)
    expect((await PDFDocument.load(result)).getPageCount()).toBe(27)
    expect(values[0]).toBe('SDF_000001')
    expect(values[1]).toBe('SDF_000002')
    expect(values.at(-1)).toBe('SDF_000027')

    const merged = await PDFDocument.load(result)
    expect(merged.getPage(0).node.Annots()?.size()).toBe(24)
    expect(merged.getPage(1).node.Annots()?.size()).toBe(1)
    const finalAnnotation = merged.context.lookup(merged.getPage(1).node.Annots()!.get(0), PDFDict)
    const finalDestination = finalAnnotation.lookup(PDFName.of('Dest'), PDFArray)
    expect(finalDestination.get(0).toString()).toBe(merged.getPage(26).ref.toString())

    const outlines = merged.catalog.lookup(PDFName.of('Outlines'), PDFDict)
    expect(outlines.lookup(PDFName.of('Count'), PDFNumber).asNumber()).toBe(26)
    const tocBookmark = outlines.lookup(PDFName.of('First'), PDFDict)
    expect(tocBookmark.lookup(PDFName.of('Title'), PDFHexString).decodeText()).toBe('Table of Contents')
    expect(tocBookmark.lookup(PDFName.of('Dest'), PDFArray).get(0).toString()).toBe(
      merged.getPage(0).ref.toString(),
    )
    const finalBookmark = outlines.lookup(PDFName.of('Last'), PDFDict)
    expect(finalBookmark.lookup(PDFName.of('Title'), PDFHexString).decodeText()).toBe('Document 25.pdf')
    expect(finalBookmark.lookup(PDFName.of('Dest'), PDFArray).get(0).toString()).toBe(
      merged.getPage(26).ref.toString(),
    )
  })
})
