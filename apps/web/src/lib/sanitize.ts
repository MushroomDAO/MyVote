/**
 * Makes a JSON string safe to embed inside an inline <script> element.
 *
 * A tenant value such as a description containing `</script>` would otherwise
 * close the tag early and let the remainder run as markup. Escaping `<` (the
 * only character that can begin a closing tag) is sufficient, and `\\u003c` is a
 * valid JSON string escape so the payload still parses as JSON.
 *
 * U+2028/U+2029 are escaped too: they are legal in JSON but were illegal in JS
 * string literals before ES2019, and this string is consumed by JS.
 */
export function escapeForScript(json: string): string {
  return json
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
