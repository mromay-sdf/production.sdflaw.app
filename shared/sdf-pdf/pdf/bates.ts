import type { BatesSettings, PdfInput } from '../types/pdf'

export function formatBatesNumber(
  value: number,
  settings: Pick<BatesSettings, 'prefix' | 'digits' | 'suffix'>,
): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Bates numbers must be non-negative whole numbers.')
  }

  const numericPart = String(value)
  if (numericPart.length > settings.digits) {
    throw new Error(
      `Bates number ${value} exceeds the configured ${settings.digits}-digit width.`,
    )
  }

  return `${settings.prefix}${numericPart.padStart(settings.digits, '0')}${settings.suffix}`
}

export function createBatesSequence(
  pageCount: number,
  settings: Pick<BatesSettings, 'prefix' | 'startNumber' | 'digits' | 'suffix'>,
): string[] {
  return Array.from({ length: pageCount }, (_, index) =>
    formatBatesNumber(settings.startNumber + index, settings),
  )
}

export function getDocumentPageRange(
  files: readonly Pick<PdfInput, 'pageCount'>[],
  fileIndex: number,
): { first: number; last: number } {
  const first = files
    .slice(0, fileIndex)
    .reduce((total, file) => total + file.pageCount, 0)
  return { first, last: first + files[fileIndex].pageCount - 1 }
}
