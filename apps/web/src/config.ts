function getEnv(name: string): string | undefined {
  return (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[name]
}

export const GRAPHQL_ENDPOINT =
  getEnv('VITE_SNAPSHOT_GRAPHQL_ENDPOINT') ?? 'https://hub.snapshot.org/graphql'

export const SNAPSHOT_HUB_URL = getEnv('VITE_SNAPSHOT_HUB_URL') ?? 'https://hub.snapshot.org'

export const SNAPSHOT_APP_NAME = getEnv('VITE_SNAPSHOT_APP_NAME') ?? 'myvote'
