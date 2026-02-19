export type AuthProviderId = 'wallet' | 'airaccount'

export type AuthUser = {
  address?: string
  displayName?: string
}

export type SignTypedDataParams = {
  address: string
  typedData: unknown
}

export interface AuthProvider {
  id: AuthProviderId
  name: string
  connect(): Promise<AuthUser>
  disconnect(): Promise<void>
  getUser(): AuthUser | null
  signMessage(address: string, message: string): Promise<string>
  signTypedData(params: SignTypedDataParams): Promise<string>
}
