import { describe, expect, it } from 'vitest'
import { calculateTextPlacement, getVisualDimensions, visualPointToPagePoint } from './coordinates'

const box = { x: 10, y: 20, width: 600, height: 800 }

describe('Bates coordinates', () => {
  it('calculates all six visual positions', () => {
    const positions = [
      'top-left', 'top-center', 'top-right',
      'bottom-left', 'bottom-center', 'bottom-right',
    ] as const
    const placements = positions.map((position) =>
      calculateTextPlacement({
        box,
        rotation: 0,
        position,
        textWidth: 60,
        fontSize: 10,
        horizontalMargin: 20,
        verticalMargin: 25,
      }),
    )
    expect(placements.map(({ visualX, visualY }) => [visualX, visualY])).toEqual([
      [20, 765], [270, 765], [520, 765], [20, 25], [270, 25], [520, 25],
    ])
  })

  it('uses landscape visual dimensions for 90-degree rotated pages', () => {
    expect(getVisualDimensions(box, 90)).toEqual({ width: 800, height: 600 })
  })

  it('maps rotated visual coordinates back to page coordinates', () => {
    expect(visualPointToPagePoint(20, 25, box, 90)).toEqual({ x: 585, y: 40 })
    expect(visualPointToPagePoint(20, 25, box, 180)).toEqual({ x: 590, y: 795 })
    expect(visualPointToPagePoint(20, 25, box, 270)).toEqual({ x: 35, y: 800 })
  })

  it('keeps bottom-right placement in the visual corner on a rotated page', () => {
    const placement = calculateTextPlacement({
      box,
      rotation: 90,
      position: 'bottom-right',
      textWidth: 80,
      fontSize: 10,
      horizontalMargin: 20,
      verticalMargin: 25,
    })
    expect(placement.visualX).toBe(700)
    expect(placement.visualY).toBe(25)
    expect(placement.rotation).toBe(90)
  })
})
