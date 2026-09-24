import { describe, expect, it, vi } from 'vitest'

// The bootstrap runs at import time, so createApp is stubbed with a chainable
// mock and the shell/router/i18n modules are replaced with markers.
const m = vi.hoisted(() => {
  const app = { use: vi.fn(), mount: vi.fn() }
  app.use.mockReturnValue(app)
  return { app }
})

vi.mock('vue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue')>()
  return { ...actual, createApp: () => m.app }
})
vi.mock('./App.vue', () => ({ default: { name: 'AppStub' } }))
vi.mock('./router', () => ({ router: { __router: true } }))
vi.mock('./i18n', () => ({
  i18n: { __i18n: true },
  getInitialLocale: () => 'en',
  applyDocumentLocale: (locale: string) => {
    document.documentElement.lang = locale
  }
}))
vi.mock('./tenant', () => ({
  resolvedBranding: {
    name: 'TestBrand',
    colors: {
      primary: '#111111',
      primaryHover: '#222222',
      error: '#333333',
      selectedBg: '#444444'
    }
  }
}))

describe('main bootstrap', () => {
  it('applies branding to the document root and mounts #app', async () => {
    await import('./main')

    const root = document.documentElement
    expect(root.style.getPropertyValue('--mv-primary')).toBe('#111111')
    expect(root.style.getPropertyValue('--mv-primary-hover')).toBe('#222222')
    expect(root.style.getPropertyValue('--mv-error')).toBe('#333333')
    expect(root.style.getPropertyValue('--mv-selected-bg')).toBe('#444444')
    expect(document.title).toBe('TestBrand')
    expect(document.documentElement.lang).toBe('en')

    expect(m.app.use).toHaveBeenCalledTimes(2)
    expect(m.app.mount).toHaveBeenCalledWith('#app')
  })
})
