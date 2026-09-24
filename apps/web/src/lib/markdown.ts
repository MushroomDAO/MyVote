import DOMPurify from 'dompurify'
import { marked } from 'marked'

/**
 * Renders a proposal body into HTML for `v-html`.
 *
 * Proposal bodies are untrusted remote Markdown and `marked` passes raw HTML
 * through, so the result goes through DOMPurify before it reaches the template.
 * Two DOMPurify defaults are load-bearing:
 *
 * - `target` is not on the attribute allow-list, so a link opens in the same tab
 *   and cannot reach back through `window.opener` (reverse tabnabbing). Turning it
 *   on with `ADD_ATTR: ['target']` needs `rel="noopener noreferrer"` as well.
 * - `javascript:` URLs become plain anchors.
 *
 * Attribute stripping (`onerror`, `onload`, …) is not asserted here: happy-dom's
 * parser defeats DOMPurify's attribute pass for elements that follow a
 * `<script>`. Verified under jsdom (2026-09-24), which behaves like a browser.
 */
export function renderMarkdown(body: string): string {
  if (!body) return ''

  return DOMPurify.sanitize(marked.parse(body) as string)
}
