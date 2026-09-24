/**
 * Error codes for messages that must reach the user in their own locale.
 *
 * The write/auth modules are plain TS with no i18n access, so they attach a
 * stable code; the UI resolves it to a translated string via
 * {@link resolveErrorMessage}. `message` stays as a readable fallback (logs,
 * unknown codes, tests).
 */
export type ErrorCode = 'voteClockSkew' | 'voteRejected'

/** i18n key for each code. Keep in sync with apps/web/src/i18n.ts. */
const ERROR_KEYS: Record<ErrorCode, string> = {
  voteClockSkew: 'errVoteClockSkew',
  voteRejected: 'errVoteRejected'
}

export type ErrorParams = Record<string, string | number>

export class AppError extends Error {
  readonly code: ErrorCode
  readonly params: ErrorParams

  constructor(code: ErrorCode, message: string, params: ErrorParams = {}) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.params = params
  }
}

export type TranslateFn = (key: string, params?: ErrorParams) => string

/**
 * Resolves a thrown value to a user-facing string.
 *
 * Coded errors are translated; anything else falls back to the error's own
 * message (or its string form). A missing translation also falls back, so an
 * untranslated code degrades to the readable message instead of a bare key.
 */
export function resolveErrorMessage(error: unknown, t: TranslateFn): string {
  if (error instanceof AppError) {
    const key = ERROR_KEYS[error.code]
    if (key) {
      const translated = t(key, error.params)
      if (translated && translated !== key) return translated
    }
  }
  return error instanceof Error ? error.message : String(error)
}
