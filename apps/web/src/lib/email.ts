/**
 * Minimal email shape check, shared by sign-in and community registration.
 *
 * Deliberately not RFC 5322: the goal is to catch typos and reject whitespace,
 * not to prove deliverability. Confirming an address is a server job (send a
 * mail), which is out of scope for the interim flows that use this.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim())
}
