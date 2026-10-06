import { describe, expect, it } from 'vitest'
import { createBatesSequence, formatBatesNumber, getDocumentPageRange } from './bates'

const base = { prefix: '', startNumber: 1, digits: 6, suffix: '' }

describe('Bates formatting', () => {
  it('starts at 1', () => {
    expect(createBatesSequence(2, base)).toEqual(['000001', '000002'])
  })

  it('starts at an arbitrary number', () => {
    expect(createBatesSequence(2, { ...base, startNumber: 42 })).toEqual(['000042', '000043'])
  })

  it('adds leading zeros', () => {
    expect(formatBatesNumber(7, { prefix: '', digits: 4, suffix: '' })).toBe('0007')
  })

  it('applies a prefix', () => {
    expect(formatBatesNumber(1, { prefix: 'SDF_', digits: 3, suffix: '' })).toBe('SDF_001')
  })

  it('applies a suffix', () => {
    expect(formatBatesNumber(1, { prefix: '', digits: 3, suffix: '-CONF' })).toBe('001-CONF')
  })

  it('continues numbering between documents', () => {
    const files = [{ pageCount: 3 }, { pageCount: 4 }]
    expect(getDocumentPageRange(files, 0)).toEqual({ first: 0, last: 2 })
    expect(getDocumentPageRange(files, 1)).toEqual({ first: 3, last: 6 })
    expect(formatBatesNumber(base.startNumber + 3, base)).toBe('000004')
  })

  it('rejects values wider than the configured digits', () => {
    expect(() => formatBatesNumber(1000, { prefix: '', digits: 3, suffix: '' })).toThrow(/exceeds/)
  })
})
