import type { Hex, TypedDataDomain } from 'viem'

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
