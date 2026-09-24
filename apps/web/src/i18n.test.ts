import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { applyDocumentLocale, getInitialLocale, i18n, setLocale } from './i18n'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.lang = ''
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getInitialLocale', () => {
  it('prefers a stored locale', () => {
    localStorage.setItem('locale', 'en')
    expect(getInitialLocale()).toBe('en')
  })

  it('falls back to the browser language', () => {
    vi.stubGlobal('navigator', { language: 'en-GB' })
    expect(getInitialLocale()).toBe('en')
  })

  it('normalizes any zh variant to zh-CN', () => {
    vi.stubGlobal('navigator', { language: 'zh-Hant-TW' })
    expect(getInitialLocale()).toBe('zh-CN')
  })

  it('defaults to zh-CN for an unsupported language', () => {
    vi.stubGlobal('navigator', { language: 'fr-FR' })
    expect(getInitialLocale()).toBe('zh-CN')
  })

  it('ignores a junk stored value', () => {
    localStorage.setItem('locale', 'klingon')
    vi.stubGlobal('navigator', { language: 'zh-CN' })
    expect(getInitialLocale()).toBe('zh-CN')
  })
})

describe('setLocale', () => {
  it('applies, persists and syncs the document language', () => {
    setLocale('en')
    expect(i18n.global.locale.value).toBe('en')
    expect(localStorage.getItem('locale')).toBe('en')
    expect(document.documentElement.lang).toBe('en')

    setLocale('zh-CN')
    expect(i18n.global.locale.value).toBe('zh-CN')
    expect(localStorage.getItem('locale')).toBe('zh-CN')
    expect(document.documentElement.lang).toBe('zh-CN')
  })
})

describe('applyDocumentLocale', () => {
  it('writes the locale onto the html element', () => {
    applyDocumentLocale('en')
    expect(document.documentElement.lang).toBe('en')
  })
})
