import type { BatesPosition, PageBox, PageRotation } from '../types/pdf'

export interface PlacementInput {
  box: PageBox
  rotation: PageRotation
  position: BatesPosition
  textWidth: number
  fontSize: number
  horizontalMargin: number
  verticalMargin: number
}

export interface TextPlacement {
  x: number
  y: number
  rotation: PageRotation
  visualX: number
  visualY: number
}

export function normalizeRotation(angle: number): PageRotation {
  const normalized = ((angle % 360) + 360) % 360
  if (normalized !== 0 && normalized !== 90 && normalized !== 180 && normalized !== 270) {
    throw new Error(`Unsupported page rotation: ${angle}°.`)
  }
  return normalized
}

export function getVisualDimensions(
  box: Pick<PageBox, 'width' | 'height'>,
  rotation: PageRotation,
): { width: number; height: number } {
  return rotation === 90 || rotation === 270
    ? { width: box.height, height: box.width }
    : { width: box.width, height: box.height }
}

export function visualPointToPagePoint(
  visualX: number,
  visualY: number,
  box: PageBox,
  rotation: PageRotation,
): { x: number; y: number } {
  switch (rotation) {
    case 0:
      return { x: box.x + visualX, y: box.y + visualY }
    case 90:
      return { x: box.x + box.width - visualY, y: box.y + visualX }
    case 180:
      return {
        x: box.x + box.width - visualX,
        y: box.y + box.height - visualY,
      }
    case 270:
      return { x: box.x + visualY, y: box.y + box.height - visualX }
  }
}

export function calculateTextPlacement(input: PlacementInput): TextPlacement {
  const visual = getVisualDimensions(input.box, input.rotation)
  const horizontal = input.position.split('-')[1]
  const vertical = input.position.split('-')[0]

  const visualX =
    horizontal === 'left'
      ? input.horizontalMargin
      : horizontal === 'center'
        ? (visual.width - input.textWidth) / 2
        : visual.width - input.horizontalMargin - input.textWidth

  // pdf-lib places text from its baseline. Using one font-size below the top
  // keeps the full Helvetica cap height inside the requested visual margin.
  const visualY =
    vertical === 'top'
      ? visual.height - input.verticalMargin - input.fontSize
      : input.verticalMargin

  const point = visualPointToPagePoint(
    Math.max(0, visualX),
    Math.max(0, visualY),
    input.box,
    input.rotation,
  )

  return {
    ...point,
    rotation: input.rotation,
    visualX: Math.max(0, visualX),
    visualY: Math.max(0, visualY),
  }
}
