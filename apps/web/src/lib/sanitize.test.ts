import { describe, expect, it } from 'vitest'

import { escapeForScript } from './sanitize'

describe('escapeForScript', () => {
  it('escapes < so a value cannot close the script tag', () => {
    expect(escapeForScript('{"a":"</script><img src=x>"}')).toBe(
      '{"a":"\\u003c/script>\\u003cimg src=x>"}'
    )
  })

  it('leaves ordinary JSON untouched', () => {
    expect(escapeForScript('{"name":"bread"}')).toBe('{"name":"bread"}')
  })

  it('escapes U+2028/U+2029 line separators', () => {
    expect(escapeForScript('a\u2028b\u2029c')).toBe('a\\u2028b\\u2029c')
  })
})
