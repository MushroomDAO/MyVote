type GraphQLResponse<TData> = {
  data?: TData
  errors?: Array<{ message: string }>
}

export async function graphqlRequest<TData>(
  endpoint: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<TData> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables })
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GraphQL HTTP ${res.status}: ${text}`)
  }

  const json = (await res.json()) as GraphQLResponse<TData>

  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join('; '))
  }

  if (!json.data) throw new Error('Missing GraphQL data')
  return json.data
}
