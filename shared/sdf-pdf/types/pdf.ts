export type BatesPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

export type BatesFontFamily = 'Helvetica' | 'Times Roman' | 'Courier'
export type BatesFontStyle = 'regular' | 'bold' | 'italic' | 'bold-italic'

export interface BatesSettings {
  prefix: string
  startNumber: number
  digits: number
  suffix: string
  position: BatesPosition
  fontFamily: BatesFontFamily
  fontStyle: BatesFontStyle
  fontSize: number
  horizontalMargin: number
  verticalMargin: number
}

export interface PdfInput {
  id: string
  name: string
  size: number
  pageCount: number
  bytes: Uint8Array
}

export interface ProcessProgress {
  currentPage: number
  totalPages: number
  fileName: string
  batesValue: string
}

export interface PageBox {
  x: number
  y: number
  width: number
  height: number
}

export type PageRotation = 0 | 90 | 180 | 270
