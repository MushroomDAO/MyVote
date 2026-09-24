import { keccak256, type Hex, type TypedDataDomain } from 'viem'

/**
 * KMS signing adapter — the seam between MyVote and AAStar's remote signer.
 *
 * ## Why signing is remote (MV-0 finding)
 *
 * An AirAccount is a smart-contract account. Its ERC-1271 `isValidSignature`
 * implementation is a **raw-digest ECDSA check** (`ecrecover(digest, sig) ==
 * owner`), *not* a passkey/WebAuthn verifier. A passkey assertion therefore
 * cannot satisfy it: WebAuthn signs `sha256(authenticatorData || sha256(clientDataJSON))`,
 * never the bare EIP-712 digest, so the recovered address never equals `owner`.
 *
 * Consequence: the EIP-712 digest a Snapshot vote requires must be signed by the
 * account's **owner key**, which lives in the KMS. The browser never holds it.
 * Every signature in the AirAccount path is a remote call.
 *
 * ## Status: E-5 not yet delivered
 *
 * The KMS HTTP endpoints do not exist yet. {@link createPlaceholderKmsSigner}
 * implements this interface and throws {@link KmsNotConfiguredError} from every
 * method. All call sites (AirAccount bridge -> Snapshot vote submission) are
 * already wired through this interface, so landing E-5 means swapping the
 * implementation passed to `createAirAccountBridge({ kms })` — no call-site
 * changes.
 */

/** EIP-712 field descriptor, e.g. `{ name: 'choice', type: 'uint32' }`. */
export type TypedDataField = {
  name: string
  type: string
}

/**
 * A complete EIP-712 payload, ready to hash and sign.
 *
 * `types` omits `EIP712Domain` (matching ethers/viem convention — the domain is
 * derived from `domain`). `primaryType` names the struct in `types` to sign,
 * e.g. `'Vote'`.
 */
export type TypedDataPayload = {
  domain: TypedDataDomain
  types: Record<string, readonly TypedDataField[]>
  primaryType: string
  message: Record<string, unknown>
}

/** Common context every KMS request carries. */
export type KmsSignContext = {
  /** The AirAccount (smart account) address the signature is attributed to. */
  aaAddress: string
  /** cos72 SSO JWT (audience `myvote`) proving the caller owns `aaAddress`. */
  token: string
}

export type KmsSignTypedDataRequest = KmsSignContext & {
  typedData: TypedDataPayload
}

export type KmsSignMessageRequest = KmsSignContext & {
  /** UTF-8 string to sign as an EIP-191 personal_sign message. */
  message: string
}

/**
 * The contract E-5 must satisfy.
 *
 * Both methods return a 65-byte `0x`-prefixed ECDSA signature (r || s || v)
 * produced by the AirAccount's **owner key** over the raw digest — i.e. what
 * `ecrecover(digest, sig) == owner` accepts, so the account's ERC-1271 validates it.
 *
 * Implementations MUST reject a request whose `aaAddress` does not match the
 * account bound to `token`.
 */
export interface KmsSigner {
  /**
   * Sign an EIP-712 digest: `keccak256(0x1901 || domainSeparator || hashStruct(message))`.
   * Used for Snapshot votes.
   */
  signTypedData(request: KmsSignTypedDataRequest): Promise<Hex>

  /**
   * Sign an EIP-191 digest: `keccak256("\x19Ethereum Signed Message:\n" || len || message)`.
   */
  signMessage(request: KmsSignMessageRequest): Promise<Hex>
}

/**
 * Thrown by every method of the placeholder signer. Callers can catch this
 * specific type to render "signing not available yet" rather than a generic failure.
 */
export class KmsNotConfiguredError extends Error {
  constructor(message = 'E-5 pending') {
    super(message)
    this.name = 'KmsNotConfiguredError'
  }
}

/**
 * Stand-in until E-5 ships. Throws {@link KmsNotConfiguredError} from every method.
 */
export function createPlaceholderKmsSigner(): KmsSigner {
  return {
    async signTypedData() {
      throw new KmsNotConfiguredError('E-5 pending: KMS signTypedData endpoint not configured')
    },
    async signMessage() {
      throw new KmsNotConfiguredError('E-5 pending: KMS signMessage endpoint not configured')
    }
  }
}
/** BIP-44 path the KMS defaults to; kept explicit so callers know what is signed. */
export const KMS_HD_PATH = "m/44'/60'/0'/0/0"

/** The KMS answers with a 65-byte R||S||V signature. */
const KMS_SIGNATURE_RE = /^0x[0-9a-fA-F]{130}$/

export type HttpKmsOptions = {
  /** KMS base URL, e.g. `https://kms.aastar.io` (no trailing slash). */
  endpoint: string
  /**
   * Server-side credential sent as `x-api-key`. A browser caller leaves this
   * unset and passes the per-user SSO token instead: the token identifies the
   * signing account, while an API key identifies the deployment.
   */
  apiKey?: string
  /** BIP-44 path; defaults to {@link KMS_HD_PATH}. */
  hdPath?: string
  /**
   * Which KMS key signs. Defaults to the `keyId` claim of the caller's SSO
   * token (the agent credential `/kms/create-agent-key` mints alongside it).
   */
  resolveKeyId?: (request: KmsSignTypedDataRequest | KmsSignMessageRequest) => string | null | undefined
  fetchImpl?: typeof fetch
}

/**
 * The KMS wants EIP-712 structs as `[{ name, fields }]` and the message as
 * `[{ name, value }]`, while viem/ethers payloads use maps. `EIP712Domain` is
 * dropped: the domain travels in its own field and the KMS builds it from there.
 */
export function toKmsTypedData(typedData: TypedDataPayload): {
  types: { name: string; fields: TypedDataField[] }[]
  message: { name: string; value: unknown }[]
} {
  const types = Object.entries(typedData.types)
    .filter(([name]) => name !== 'EIP712Domain')
    .map(([name, fields]) => ({ name, fields: [...fields] }))
  const message = Object.entries(typedData.message).map(([name, value]) => ({ name, value }))
  return { types, message }
}

/**
 * Reads the `keyId` claim out of a JWT without verifying it. Authorization is
 * the KMS's job; this helper picks which key to name in the request body.
 */
export function keyIdFromToken(token: string): string | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const json = JSON.parse(atob(padded)) as Record<string, unknown>
    const keyId = json.keyId ?? json.key_id
    return typeof keyId === 'string' && keyId ? keyId : null
  } catch {
    return null
  }
}

/** EIP-191 digest: keccak256("\x19Ethereum Signed Message:\n" + byteLength + message). */
export function eip191Digest(message: string): Hex {
  const body = new TextEncoder().encode(message)
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${body.length}`)
  const combined = new Uint8Array(prefix.length + body.length)
  combined.set(prefix, 0)
  combined.set(body, prefix.length)
  return keccak256(combined)
}

function kmsErrorDetail(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    const detail = record.message ?? record.error ?? record.Message
    if (typeof detail === 'string' && detail) return detail
  }
  return fallback
}

/**
 * Real E-5 signer: signs through the aastar TEE KMS over HTTP.
 *
 * `signTypedData` uses `/kms/SignTypedData`, which accepts an agent JWT or an
 * API key. `signMessage` uses `/kms/SignHash` with the EIP-191 digest — that
 * endpoint is WebAuthn-gated, so a caller without a bound passkey gets the
 * KMS's own auth error rather than a silent mis-signature.
 */
export function createHttpKmsSigner(options: HttpKmsOptions): KmsSigner {
  const endpoint = options.endpoint.replace(/\/+$/, '')
  if (!endpoint) throw new KmsNotConfiguredError('KMS endpoint is empty')
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const resolveKeyId = options.resolveKeyId ?? ((request) => keyIdFromToken(request.token))

  async function callKms(action: string, body: unknown, token: string): Promise<unknown> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-amz-target': `TrentService.${action}`
    }
    if (token) headers.authorization = `Bearer ${token}`
    if (options.apiKey) headers['x-api-key'] = options.apiKey

    let response: Response
    try {
      response = await fetchImpl(`${endpoint}/kms/${action}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      })
    } catch (e) {
      throw new Error(`KMS ${action} request failed: ${e instanceof Error ? e.message : String(e)}`)
    }

    const text = await response.text()
    let payload: unknown = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      // Non-JSON error page; the raw text is the best detail we have.
    }
    if (!response.ok) {
      const detail = kmsErrorDetail(payload, text || response.statusText)
      throw new Error(`KMS ${action} failed (${response.status}): ${detail.slice(0, 300)}`)
    }
    return payload
  }

  return {
    async signTypedData(request) {
      const keyId = resolveKeyId(request)
      if (!keyId) throw new Error('KMS keyId is unavailable for this session')
      const { types, message } = toKmsTypedData(request.typedData)
      const payload = await callKms(
        'SignTypedData',
        {
          keyId,
          hdPath: options.hdPath ?? KMS_HD_PATH,
          domain: request.typedData.domain,
          primaryType: request.typedData.primaryType,
          types,
          message
        },
        request.token
      )
      const signature = (payload as { signature?: unknown } | null)?.signature
      if (typeof signature !== 'string' || !KMS_SIGNATURE_RE.test(signature)) {
        throw new Error('KMS returned no 65-byte signature')
      }
      return signature as Hex
    },

    async signMessage(request) {
      const keyId = resolveKeyId(request)
      const payload = await callKms(
        'SignHash',
        {
          ...(keyId ? { KeyId: keyId } : {}),
          Address: request.aaAddress,
          Hash: eip191Digest(request.message)
        },
        request.token
      )
      const signature = (payload as { Signature?: unknown } | null)?.Signature
      if (typeof signature !== 'string' || !KMS_SIGNATURE_RE.test(signature)) {
        throw new Error('KMS returned no 65-byte signature')
      }
      return signature as Hex
    }
  }
}
