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

  it('defaults to zh-CN when no locale is stored', () => {
    expect(getInitialLocale()).toBe('zh-CN')
  })

  it('ignores a junk stored value and defaults to zh-CN', () => {
    localStorage.setItem('locale', 'klingon')
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
