import { describe, expect, it } from 'vitest'

import { createRequestGuard } from './requestGuard'

describe('createRequestGuard', () => {
  it('treats only the newest token as current', () => {
    const guard = createRequestGuard()
    const a = guard.next()
    expect(guard.isCurrent(a)).toBe(true)

    const b = guard.next()
    expect(guard.isCurrent(a)).toBe(false)
    expect(guard.isCurrent(b)).toBe(true)
  })

  it('does not let an unrelated guard invalidate this one', () => {
    const g1 = createRequestGuard()
    const g2 = createRequestGuard()
    const a = g1.next()
    g2.next()
    expect(g1.isCurrent(a)).toBe(true)
  })
})
