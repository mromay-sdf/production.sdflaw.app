import { useEffect, useRef, useState } from 'react'

const key = 'sdf-viewer-index-width'
export function useViewerSplit() {
  const root = useRef<HTMLElement>(null)
  const [width, setWidth] = useState(1200)
  const [ratio, setRatio] = useState(() => {
    try { const saved = Number(localStorage.getItem(key)); return saved >= 15 && saved <= 90 ? saved : 28 } catch { return 28 }
  })
  const [collapsed, setCollapsed] = useState(false)
  const [dragging, setDragging] = useState(false)
  const min = Math.min(220, width * .4) / width * 100
  const max = Math.max(width * .5, width - 320) / width * 100
  const actual = Math.min(max, Math.max(min, ratio))
  const update = (value: number) => {
    const next = Math.max(min, Math.min(max, value))
    setRatio(next)
    try { localStorage.setItem(key, String(next)) } catch { /* Layout still works when browser storage is disabled. */ }
  }
  useEffect(() => {
    if (!root.current) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(1, entry.contentRect.width)))
    observer.observe(root.current)
    return () => observer.disconnect()
  }, [])
  return { root, collapsed, setCollapsed, dragging, actual, separator: {
    role: 'separator', tabIndex: 0, 'aria-label': 'Resize document index', 'aria-orientation': 'vertical' as const,
    'aria-valuemin': Math.round(min), 'aria-valuemax': Math.round(max), 'aria-valuenow': Math.round(actual),
    'aria-valuetext': `${Math.round(actual)} percent index width`,
    onDoubleClick: () => update(28),
    onKeyDown: (e: React.KeyboardEvent) => {
      const value = e.key === 'ArrowLeft' ? actual - 2 : e.key === 'ArrowRight' ? actual + 2 : e.key === 'Home' ? min : e.key === 'End' ? max : undefined
      if (value !== undefined) { e.preventDefault(); update(value) }
    },
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => { if(e.button!==0)return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setDragging(true) },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId) || !root.current) return
      const bounds = root.current.getBoundingClientRect()
      update((e.clientX - bounds.left) / bounds.width * 100)
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => { if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId); setDragging(false) },
    onLostPointerCapture: () => setDragging(false),
  } }
}
