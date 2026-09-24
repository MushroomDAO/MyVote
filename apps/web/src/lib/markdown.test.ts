import { describe, expect, it } from 'vitest'

import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('renders Markdown into HTML', () => {
    const html = renderMarkdown('# Title' + String.fromCharCode(10, 10) + 'Some **bold** text.')
    expect(html).toContain('<h1')
    expect(html).toContain('<strong>bold</strong>')
  })

  it('removes script elements from raw HTML', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).not.toContain('<script')
  })

  it('rewrites javascript: URLs to plain anchors', () => {
    const html = renderMarkdown('[x](javascript:alert(1))')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('<a')
  })

  it('drops target so a link cannot reach back through window.opener', () => {
    const html = renderMarkdown('<a href="https://example.com" target="_blank">x</a>')
    expect(html).toContain('href="https://example.com"')
    expect(html).not.toContain('target')
  })

  it('returns an empty string for an empty body', () => {
    expect(renderMarkdown('')).toBe('')
  })
})
