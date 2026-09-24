/**
 * Offset-pagination lookahead.
 *
 * The Hub and the SX indexer paginate with first/skip and return no flag for
 * whether a next page exists. Inferring it from items.length === size is wrong
 * for an exact multiple: the UI still shows a Load more button and the next
 * request comes back empty. Fetching size + 1 and trimming here makes the flag
 * exact, at the cost of one extra row per page.
 */
export function takePage<T>(
  items: readonly T[],
  size: number
): { page: T[]; hasMore: boolean } {
  if (items.length <= size) return { page: [...items], hasMore: false }
  return { page: items.slice(0, size), hasMore: true }
}
