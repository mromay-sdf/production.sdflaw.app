import type { PdfInput } from '../types/pdf'

export const TOC_ENTRIES_PER_PAGE = 24

export function getTableOfContentsPageCount(files: readonly PdfInput[]): number {
  return files.length === 0 ? 0 : Math.ceil(files.length / TOC_ENTRIES_PER_PAGE)
}
