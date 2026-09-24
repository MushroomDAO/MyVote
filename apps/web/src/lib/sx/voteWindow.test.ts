import { describe, expect, it } from 'vitest'

import { msUntilWindowChange, SX_WINDOW_MAX_DELAY_MS } from './voteWindow'

describe('msUntilWindowChange', () => {
  it('aims at the start while the window has not opened', () => {
    expect(msUntilWindowChange(1000, 2000, 400)).toBe(600 * 1000 + 1000)
  })

  it('aims at maxEnd while voting is open', () => {
    expect(msUntilWindowChange(1000, 2000, 1500)).toBe(500 * 1000 + 1000)
  })

  it('returns null once the window has closed', () => {
    expect(msUntilWindowChange(1000, 2000, 2500)).toBeNull()
  })

  it('caps a far-away boundary so it is re-checked later', () => {
    // Two hours out: the raw delay exceeds the cap.
    expect(msUntilWindowChange(1000 + 7200, 1000 + 100000, 1000)).toBe(SX_WINDOW_MAX_DELAY_MS)
  })
})
