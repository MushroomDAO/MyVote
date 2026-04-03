import { branding } from './branding'

/**
 * Tenant configuration injected by the Cloudflare Pages edge function.
 * In development (no edge function), window.__TENANT__ is undefined
 * and the app falls back to the default branding from branding.ts.
 */
type TenantConfig = {
  /** Snapshot space ID. When set, the app runs in single-space mode:
   *  / and /explore redirect to /space/:spaceId. */
  spaceId?: string
  /** Overrides branding.name */
  name?: string
  /** Overrides branding.logo */
  logo?: string | null
  /** Overrides branding.description */
  description?: string
  /** Partial color overrides — only listed keys are replaced */
  colors?: Partial<typeof branding.colors>
}

const injected = (window as unknown as { __TENANT__?: TenantConfig }).__TENANT__

/** Raw tenant config injected by the edge function, or empty object in standalone mode. */
export const tenant: TenantConfig = injected ?? {}

/** Branding merged with tenant overrides. Use this everywhere instead of branding directly. */
export const resolvedBranding = {
  ...branding,
  ...(tenant.name != null ? { name: tenant.name } : {}),
  ...(tenant.logo !== undefined ? { logo: tenant.logo } : {}),
  ...(tenant.description != null ? { description: tenant.description } : {}),
  colors: { ...branding.colors, ...tenant.colors },
}
