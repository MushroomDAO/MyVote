import { getAddress } from 'viem'

import type { TypedDataField, TypedDataPayload } from '../auth/kms'

/**
 * Snapshot vote signing + submission, without snapshot.js.
 *
 * snapshot.js's `Client712` is hard-wired to ethers v5 (it calls
 * `signer._signTypedData`), so it cannot sign through our KMS adapter. This
 * module rebuilds the same EIP-712 envelope by hand and POSTs it to the hub.
 *
 * The type definitions below are copied verbatim from
 * `@snapshot-labs/snapshot.js/src/sign/types.ts`. They MUST stay byte-identical:
 * the hub hashes the incoming `types` and rejects anything whose hash is not on
 * its `hashedTypes.json` allowlist. A single renamed field or reordered entry
 * changes the hash and the vote is refused.
 */

export type ProposalType =
  | 'single-choice'
  | 'approval'
  | 'quadratic'
  | 'ranked-choice'
  | 'weighted'
  | 'basic'

/** Snapshot's EIP-712 domain. No chainId, no verifyingContract. */
export const SNAPSHOT_DOMAIN = {
  name: 'snapshot',
  version: '0.1.4'
} as const

/** single-choice / basic — `choice` is a 1-based index. */
const voteTypes: Record<string, readonly TypedDataField[]> = {
  Vote: [
    { name: 'from', type: 'string' },
    { name: 'space', type: 'string' },
    { name: 'timestamp', type: 'uint64' },
    { name: 'proposal', type: 'string' },
    { name: 'choice', type: 'uint32' },
    { name: 'reason', type: 'string' },
    { name: 'app', type: 'string' },
    { name: 'metadata', type: 'string' }
  ]
}

/** approval / ranked-choice — `choice` is an array of 1-based indices. */
const voteArrayTypes: Record<string, readonly TypedDataField[]> = {
  Vote: [
    { name: 'from', type: 'string' },
    { name: 'space', type: 'string' },
    { name: 'timestamp', type: 'uint64' },
    { name: 'proposal', type: 'string' },
    { name: 'choice', type: 'uint32[]' },
    { name: 'reason', type: 'string' },
    { name: 'app', type: 'string' },
    { name: 'metadata', type: 'string' }
  ]
}

/** quadratic / weighted / shutter — `choice` is a JSON string. */
const voteStringTypes: Record<string, readonly TypedDataField[]> = {
  Vote: [
    { name: 'from', type: 'string' },
    { name: 'space', type: 'string' },
    { name: 'timestamp', type: 'uint64' },
    { name: 'proposal', type: 'string' },
    { name: 'choice', type: 'string' },
    { name: 'reason', type: 'string' },
    { name: 'app', type: 'string' },
    { name: 'metadata', type: 'string' }
  ]
}

export type VoteChoice = number | number[] | string | Record<string, number>

export type VoteInput = {
  /** Signer address (the AirAccount address). Checksummed before signing. */
  from: string
  space: string
  proposal: string
  type: ProposalType
  choice: VoteChoice
  reason?: string
  app?: string
  metadata?: string
  privacy?: string
  /** Unix seconds. Defaults to now. */
  timestamp?: number
}

/** The `{ address, sig, data }` body the hub expects. */
export type VoteEnvelope = {
  address: string
  sig: string
  data: {
    domain: typeof SNAPSHOT_DOMAIN
    types: Record<string, readonly TypedDataField[]>
    message: Record<string, unknown>
  }
}

/**
 * Builds the exact EIP-712 payload snapshot.js would have signed.
 *
 * Mirrors `Client712.vote()` + `Client712.sign()`:
 * - picks the type variant from the proposal type,
 * - JSON-encodes `choice` for quadratic/weighted,
 * - defaults `reason`/`app` to `''` and `metadata` to `'{}'`,
 * - drops `type` and `privacy` (they are not part of the signed struct),
 * - checksums `from`, and stamps a timestamp.
 */
export function buildVoteTypedData(input: VoteInput): TypedDataPayload {
  const isShutter = input.privacy === 'shutter'

  let types = voteTypes
  let choice: VoteChoice = input.choice

  if (['approval', 'ranked-choice'].includes(input.type)) {
    types = voteArrayTypes
  }
  if (!isShutter && ['quadratic', 'weighted'].includes(input.type)) {
    types = voteStringTypes
    choice = JSON.stringify(input.choice)
  }
  if (isShutter) {
    types = voteStringTypes
  }

  return {
    domain: { ...SNAPSHOT_DOMAIN },
    types,
    primaryType: 'Vote',
    message: {
      from: getAddress(input.from),
      space: input.space,
      timestamp: input.timestamp ?? Math.floor(Date.now() / 1000),
      proposal: input.proposal,
      choice,
      reason: input.reason ?? '',
      app: input.app ?? '',
      metadata: input.metadata ?? '{}'
    }
  }
}

/**
 * Hub URL -> message-ingestion URL.
 *
 * Snapshot's public hubs put message ingestion on a separate `seq.*` host, and
 * snapshot.js rewrites the hub URL to it before POSTing. We reproduce that map;
 * any other (self-hosted) hub falls back to the classic `POST /api/msg` route.
 */
const HUB_TO_SEQUENCER: Record<string, string> = {
  'https://hub.snapshot.org': 'https://seq.snapshot.org',
  'https://testnet.hub.snapshot.org': 'https://testnet.seq.snapshot.org',
  'http://localhost:3000': 'http://localhost:3001'
}

export function resolveVoteSubmitUrl(hubUrl: string): string {
  const hub = hubUrl.replace(/\/+$/, '')
  return HUB_TO_SEQUENCER[hub] ?? `${hub}/api/msg`
}

/** POSTs a signed envelope to the hub. Resolves with the hub receipt. */
export async function submitVoteEnvelope(
  hubUrl: string,
  envelope: VoteEnvelope,
  fetchImpl: typeof fetch = fetch
): Promise<unknown> {
  const response = await fetchImpl(resolveVoteSubmitUrl(hubUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(envelope)
  })

  const text = await response.text()
  let payload: unknown = text
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    // Hub returned non-JSON; keep the raw text for the error message.
  }

  if (!response.ok) {
    const detail =
      typeof payload === 'object' && payload !== null
        ? ((payload as Record<string, unknown>).error_description ??
          (payload as Record<string, unknown>).error ??
          text)
        : text
    throw new Error(`Snapshot hub 拒绝了投票 (${response.status}): ${String(detail).slice(0, 300)}`)
  }

  return payload
}

/**
 * Full vote write path: build the payload, sign it through the injected signer
 * (wallet or AirAccount/KMS), and submit it.
 */
export async function castVote(params: {
  hubUrl: string
  vote: VoteInput
  signTypedData: (payload: TypedDataPayload) => Promise<string>
  fetchImpl?: typeof fetch
}): Promise<unknown> {
  const typedData = buildVoteTypedData(params.vote)
  const sig = await params.signTypedData(typedData)

  const envelope: VoteEnvelope = {
    address: getAddress(params.vote.from),
    sig,
    // The hub re-derives the digest from exactly these three fields.
    data: {
      domain: typedData.domain as typeof SNAPSHOT_DOMAIN,
      types: typedData.types,
      message: typedData.message
    }
  }

  return submitVoteEnvelope(params.hubUrl, envelope, params.fetchImpl)
}
