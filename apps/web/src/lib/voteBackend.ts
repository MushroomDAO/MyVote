import type { TypedDataPayload } from '../auth/kms'
import { SNAPSHOT_HUB_URL } from '../config'
import { castVote as castOffchainVote, type VoteInput } from './snapshotVote'

/**
 * Vote write-path abstraction.
 *
 * The app currently writes votes to the classic Snapshot **off-chain** hub
 * (`lib/snapshotVote.ts`). Snapshot X (on-chain, EVM/OP) is a planned *optional*
 * backend — see `docs/snapshot-version-decision.md`. This interface is the seam
 * that keeps pages backend-agnostic: a page supplies a vote + a signer, the
 * backend owns every protocol detail (encoding, endpoint, submission).
 *
 * Adding a backend means implementing this interface and returning it from
 * `activeVoteBackend` — pages do not change.
 */
export type VoteBackendId = 'snapshot-offchain' | 'snapshot-x'

export type CastVoteParams = {
  /** The vote to cast. `from` is the signer/account address. */
  vote: VoteInput
  /** Signs the EIP-712 payload the backend built (wallet or AirAccount/KMS). */
  signTypedData: (payload: TypedDataPayload) => Promise<string>
  /** Injected for tests. */
  fetchImpl?: typeof fetch
}

export interface VoteBackend {
  readonly id: VoteBackendId
  /** Human-readable label, for diagnostics. */
  readonly name: string
  castVote(params: CastVoteParams): Promise<unknown>
}

/**
 * Classic off-chain backend: builds the EIP-712 vote envelope and POSTs it to the
 * hub's sequencer. All behaviour lives in `snapshotVote.ts`; this only binds a hub
 * URL to the interface.
 */
export function createSnapshotOffchainBackend(hubUrl: string): VoteBackend {
  const hub = hubUrl.replace(/\/+$/, '')
  return {
    id: 'snapshot-offchain',
    name: 'Snapshot off-chain hub',
    castVote({ vote, signTypedData, fetchImpl }) {
      return castOffchainVote({ hubUrl: hub, vote, signTypedData, fetchImpl })
    }
  }
}

/** The backend the app uses, selected from config. Swap here to change protocol. */
export const activeVoteBackend: VoteBackend = createSnapshotOffchainBackend(SNAPSHOT_HUB_URL)
