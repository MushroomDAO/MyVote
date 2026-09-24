export type AuthProviderId = 'wallet' | 'airaccount' | 'email'

export type AuthUser = {
  address?: string
  displayName?: string
}

export type SignTypedDataParams = {
  address: string
  typedData: unknown
}

/** Optional inputs a provider may need to start a session (e.g. email). */
export type AuthConnectParams = {
  email?: string
}

export interface AuthProvider {
  id: AuthProviderId
  name: string
  /**
   * Starts a session. Providers that need no input ignore `params`; email
   * sign-in reads `params.email` or falls back to a stored session.
   */
  connect(params?: AuthConnectParams): Promise<AuthUser>
  disconnect(): Promise<void>
  getUser(): AuthUser | null
  signMessage(address: string, message: string): Promise<string>
  signTypedData(params: SignTypedDataParams): Promise<string>
}
