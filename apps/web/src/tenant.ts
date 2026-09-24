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

type ColorKey = keyof typeof branding.colors

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Picks only the known tenant fields out of whatever the edge injected.
 *
 * \`window.__TENANT__\` is attacker-influenced in the sense that it comes from a KV
 * record an admin controls; a malformed value (a string, a number) would
 * otherwise be *spread* into the branding object and produce junk. Unknown keys
 * are dropped, and non-string color values are ignored.
 */
export function normalizeTenant(raw: unknown): TenantConfig {
  if (!isRecord(raw)) return {}

  const config: TenantConfig = {}
  if (typeof raw.spaceId === 'string') config.spaceId = raw.spaceId
  if (typeof raw.name === 'string') config.name = raw.name
  // `null` is meaningful: it means "no logo" (render the name as text).
  if (typeof raw.logo === 'string' || raw.logo === null) config.logo = raw.logo
  if (typeof raw.description === 'string') config.description = raw.description

  if (isRecord(raw.colors)) {
    const colors: Partial<typeof branding.colors> = {}
    for (const key of ['primary', 'primaryHover', 'error', 'selectedBg'] as ColorKey[]) {
      const value = raw.colors[key]
      if (typeof value === 'string') colors[key] = value
    }
    if (Object.keys(colors).length) config.colors = colors
  }

  return config
}

/** Branding merged with tenant overrides. Use this everywhere instead of branding directly. */
export function mergeBranding(
  base: typeof branding,
  overrides: TenantConfig
): typeof branding {
  return {
    ...base,
    ...(overrides.name != null ? { name: overrides.name } : {}),
    ...(overrides.logo !== undefined ? { logo: overrides.logo } : {}),
    ...(overrides.description != null ? { description: overrides.description } : {}),
    colors: { ...base.colors, ...(overrides.colors ?? {}) }
  }
}

const injected = (window as unknown as { __TENANT__?: unknown }).__TENANT__

/** Raw tenant config injected by the edge function, or empty object in standalone mode. */
export const tenant: TenantConfig = normalizeTenant(injected)

/** Branding with tenant overrides applied. */
export const resolvedBranding = mergeBranding(branding, tenant)
