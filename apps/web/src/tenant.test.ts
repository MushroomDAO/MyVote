import { describe, expect, it } from 'vitest'

import { branding } from './branding'
import { mergeBranding, normalizeTenant } from './tenant'

describe('normalizeTenant', () => {
  it('returns an empty config for non-objects', () => {
    for (const bad of [undefined, null, 'bread', 42, [], true]) {
      expect(normalizeTenant(bad)).toEqual({})
    }
  })

  it('keeps known string fields and drops everything else', () => {
    expect(
      normalizeTenant({ spaceId: 'aastar.eth', name: 'AAStar', evil: 'x', description: 5 })
    ).toEqual({ spaceId: 'aastar.eth', name: 'AAStar' })
  })

  it('keeps logo: null but ignores non-string colors', () => {
    expect(
      normalizeTenant({ logo: null, colors: { primary: '#fff', error: 2, bogus: 'x' } })
    ).toEqual({ logo: null, colors: { primary: '#fff' } })
  })

  it('omits colors entirely when none are valid', () => {
    expect(normalizeTenant({ colors: { primary: 1 } })).toEqual({})
  })
})

describe('mergeBranding', () => {
  it('falls back to the defaults', () => {
    const merged = mergeBranding(branding, {})
    expect(merged.name).toBe(branding.name)
    expect(merged.logo).toBe(branding.logo)
    expect(merged.colors).toEqual(branding.colors)
  })

  it('overrides name/description and merges colors partially', () => {
    const merged = mergeBranding(branding, {
      name: 'AAStar Governance',
      description: 'Vote on AAStar proposals',
      colors: { primary: '#123456' }
    })

    expect(merged.name).toBe('AAStar Governance')
    expect(merged.description).toBe('Vote on AAStar proposals')
    expect(merged.colors.primary).toBe('#123456')
    // Unlisted colors keep their defaults.
    expect(merged.colors.primaryHover).toBe(branding.colors.primaryHover)
    expect(merged.colors.error).toBe(branding.colors.error)
  })

  it('lets an explicit logo: null clear a configured logo', () => {
    const merged = mergeBranding({ ...branding, logo: '/x.svg' }, { logo: null })
    expect(merged.logo).toBeNull()
  })

  it('does not mutate the base branding', () => {
    const before = branding.colors.primary
    mergeBranding(branding, { colors: { primary: '#000000' } })
    expect(branding.colors.primary).toBe(before)
  })
})
