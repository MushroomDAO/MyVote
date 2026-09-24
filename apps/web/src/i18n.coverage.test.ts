import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { messages } from './i18n'

/**
 * Every static `t('key')` / `$t('key')` must exist in both catalogs.
 *
 * A missing key silently renders as the key itself, which is easy to ship and
 * hard to notice. Dynamic keys (error codes resolved through `errorKey`) are
 * not literals here, so they are intentionally out of scope.
 */
// Vitest may run from the package dir or the repo root; accept both.
const SRC =
  [join(process.cwd(), 'src'), join(process.cwd(), 'apps/web/src')].find((dir) =>
    existsSync(dir)
  ) ?? join(process.cwd(), 'src')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (['.vue', '.ts'].includes(extname(full)) && !full.endsWith('.test.ts')) out.push(full)
  }
  return out
}

// `t(` / `$t(` not preceded by an identifier char or dot, so `get('x')` and
// `formatTs('x')` are not mistaken for translations.
const KEY_RE = /(?<![A-Za-z0-9_$.])\$?t\(\s*['"]([A-Za-z0-9_.]+)['"]/g

function usedKeys(): Map<string, string> {
  const used = new Map<string, string>()
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(KEY_RE)) {
      used.set(match[1]!, file.replace(SRC, ''))
    }
  }
  return used
}

describe('i18n coverage', () => {
  const used = usedKeys()
  const locales = Object.keys(messages) as (keyof typeof messages)[]

  it('actually finds translation keys to check', () => {
    expect(used.size).toBeGreaterThan(20)
  })

  for (const locale of locales) {
    it(`defines every used key in ${String(locale)}`, () => {
      const missing = [...used.keys()].filter((key) => !(key in messages[locale]))
      expect(
        missing,
        `missing in ${String(locale)} (first used in): ` +
          missing.map((k) => `${k} ${used.get(k)}`).join(', ')
      ).toEqual([])
    })
  }

  it('keeps both catalogs the same size', () => {
    const [a, b] = locales.map((l) => Object.keys(messages[l]).length)
    expect(a).toBe(b)
  })
})
