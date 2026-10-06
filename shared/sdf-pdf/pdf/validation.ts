import { PDFDocument } from 'pdf-lib'
import type { PdfInput } from '../types/pdf'

export class PdfValidationError extends Error {
  constructor(
    public readonly fileName: string,
    message: string,
  ) {
    super(`${fileName}: ${message}`)
    this.name = 'PdfValidationError'
  }
}

function friendlyPdfError(fileName: string, error: unknown): PdfValidationError {
  const detail = error instanceof Error ? error.message : String(error)
  const lower = detail.toLowerCase()

  if (lower.includes('encrypted') || lower.includes('password')) {
    return new PdfValidationError(
      fileName,
      'This PDF is encrypted or password-protected and cannot be processed.',
    )
  }
  if (lower.includes('invalid') || lower.includes('header')) {
    return new PdfValidationError(fileName, 'This is not a valid PDF file.')
  }
  return new PdfValidationError(
    fileName,
    `The PDF is corrupt or unsupported. ${detail}`,
  )
}

export async function validatePdfFile(file: File): Promise<PdfInput> {
  if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new PdfValidationError(file.name, 'Only PDF files are supported.')
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const document = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      updateMetadata: false,
    })
    const pageCount = document.getPageCount()
    if (pageCount === 0) {
      throw new PdfValidationError(file.name, 'This PDF contains no pages.')
    }

    return {
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      pageCount,
      bytes,
    }
  } catch (error) {
    if (error instanceof PdfValidationError) throw error
    throw friendlyPdfError(file.name, error)
  }
}

export function validateBatesRange(
  startNumber: number,
  digits: number,
  totalPages: number,
): void {
  if (!Number.isSafeInteger(startNumber) || startNumber < 0) {
    throw new Error('Starting number must be a non-negative whole number.')
  }
  if (!Number.isSafeInteger(digits) || digits < 1 || digits > 12) {
    throw new Error('Number of digits must be between 1 and 12.')
  }
  const lastNumber = startNumber + Math.max(0, totalPages - 1)
  if (!Number.isSafeInteger(lastNumber) || String(lastNumber).length > digits) {
    throw new Error(
      `The final Bates number (${lastNumber}) does not fit in ${digits} digits.`,
    )
  }
}
