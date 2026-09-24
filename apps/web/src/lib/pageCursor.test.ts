import { describe, expect, it } from 'vitest'

import { takePage } from './pageCursor'

const range = (n: number) => Array.from({ length: n }, (_, i) => i)

describe('takePage', () => {
  it('returns everything and no more when short of a full page', () => {
    expect(takePage(range(3), 5)).toEqual({ page: [0, 1, 2], hasMore: false })
  })

  it('reports no next page on an exact multiple (the lookahead is the point)', () => {
    expect(takePage(range(5), 5)).toEqual({ page: [0, 1, 2, 3, 4], hasMore: false })
  })

  it('trims the lookahead row and reports more when one extra came back', () => {
    expect(takePage(range(6), 5)).toEqual({ page: [0, 1, 2, 3, 4], hasMore: true })
  })

  it('handles an empty page', () => {
    expect(takePage([], 5)).toEqual({ page: [], hasMore: false })
  })

  it('copies rather than aliasing the input', () => {
    const input = range(5)
    const { page } = takePage(input, 5)
    expect(page).not.toBe(input)
  })
})
