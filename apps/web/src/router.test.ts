import { describe, expect, it, vi } from 'vitest'

// Single-space (tenant) mode is the interesting branch of the router guard.
vi.mock('./tenant', () => ({
  tenant: { spaceId: 'aastar.eth' },
  resolvedBranding: {}
}))

const { router } = await import('./router')
const { SSO_CALLBACK_PATH } = await import('./config')

describe('router single-space guard', () => {
  it('redirects / to the tenant space', async () => {
    await router.push('/')
    expect(router.currentRoute.value.path).toBe('/space/aastar.eth')
  })

  it('redirects /explore to the tenant space', async () => {
    await router.push('/explore')
    expect(router.currentRoute.value.path).toBe('/space/aastar.eth')
  })

  it('never swallows the SSO callback (the code must be spent)', async () => {
    await router.push(SSO_CALLBACK_PATH)
    expect(router.currentRoute.value.path).toBe(SSO_CALLBACK_PATH)
  })

  it('leaves other routes alone', async () => {
    await router.push('/register')
    expect(router.currentRoute.value.path).toBe('/register')
  })
})
