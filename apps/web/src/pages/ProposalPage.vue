<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import { GRAPHQL_ENDPOINT, SNAPSHOT_APP_NAME, SX_API_ENDPOINT } from '../config'
import { useAuth } from '../auth/useAuth'
import { EmailSigningUnsupportedError } from '../auth/emailProvider'
import { KmsNotConfiguredError } from '../auth/kms'
import { AppError, errorKey, resolveErrorMessage, type ErrorCode } from '../lib/errors'
import {
  fetchProposal,
  fetchVoterVote,
  type Proposal,
  type ProposalType,
  type VoterVote
} from '../lib/graphql'
import { renderMarkdown } from '../lib/markdown'
import { createRequestGuard } from '../lib/requestGuard'
import { type VoteChoice } from '../lib/snapshotVote'
import { createEthersCompatSigner, sxTxUrl } from '../lib/sx/backend'
import {
  buildSxVoteRequest,
  fetchSxProposal,
  fetchSxVoterVote,
  type SxProposal,
  type SxVote
} from '../lib/sx/api'
import { sxVoteBlock, type SxVoteBlock } from '../lib/sx/eligibility'
import { msUntilWindowChange } from '../lib/sx/voteWindow'
import { createSxBackendFromEip1193, type Eip1193Provider } from '../lib/sx/provider'
import { activeVoteBackend } from '../lib/voteBackend'
import { protocolForSpaceId } from '../lib/voteRouting'

const { t, locale } = useI18n()
const route = useRoute()
const auth = useAuth()

const proposalId = computed(() => String(route.params.id ?? ''))
const guard = createRequestGuard()
/** Its own guard: the voter lookup must not invalidate the proposal load. */
const voteGuard = createRequestGuard()

/**
 * SX proposals are only unique within their space, so the space rides in the
 * query string (`?space=0x…`) instead of as a second path segment.
 */
const sxSpaceId = computed(() => {
  const value = route.query.space
  return typeof value === 'string' && protocolForSpaceId(value) === 'snapshot-x' ? value : null
})
const isSx = computed(() => sxSpaceId.value !== null)
/** The connected account's indexed vote, when it already voted on this proposal. */
const existingSxVote = ref<SxVote | null>(null)
/** Set right after this session's on-chain vote, before the indexer catches up. */
const sxVoted = ref(false)
/** Clock the SX window checks against; the boundary timer updates it. */
const windowNow = ref(Math.floor(Date.now() / 1000))
/** The account's current off-chain vote, so the ballot can show/prefill it. */
const existingOffchainVote = ref<VoterVote | null>(null)
/** Local pre-flight reason an SX vote cannot go through right now. */
const sxBlockReason = computed<SxVoteBlock | null>(() => {
  const sx = sxProposal.value
  if (!sx) return null
  return sxVoteBlock(
    {
      state: sx.state,
      start: sx.start,
      maxEnd: sx.maxEnd,
      hasAuthenticator: (sx.space?.authenticators.length ?? 0) > 0
    },
    windowNow.value
  )
})

const SX_BLOCK_CODES: Record<SxVoteBlock, ErrorCode> = {
  closed: 'sxVoteClosed',
  'not-started': 'sxVoteNotStarted',
  'no-authenticator': 'sxNoAuthenticator'
}

let windowTimer: ReturnType<typeof setTimeout> | null = null

function clearWindowTimer() {
  if (windowTimer) {
    clearTimeout(windowTimer)
    windowTimer = null
  }
}

/** Arms one timer for the next open/close boundary, then re-arms from there. */
function armWindowTimer() {
  clearWindowTimer()
  const sx = sxProposal.value
  if (!sx) return
  const delay = msUntilWindowChange(sx.start, sx.maxEnd, windowNow.value)
  if (delay === null) return
  windowTimer = setTimeout(() => {
    windowNow.value = Math.floor(Date.now() / 1000)
    armWindowTimer()
  }, delay)
}

/** Localized reason shown with the disabled submit button when blocked. */
const sxBlockText = computed(() => {
  const block = sxBlockReason.value
  if (!block) return null
  const key = errorKey(SX_BLOCK_CODES[block])
  return key ? t(key) : null
})

/**
 * Off-chain Hub proposals are votable only while `active`. Kept conservative:
 * only the known non-votable states disable the button, so an unexpected value
 * never blocks a legitimate vote.
 */
const offchainClosed = computed(() =>
  proposal.value ? ['closed', 'pending'].includes(proposal.value.state.toLowerCase()) : false
)
/** Explorer link for the indexed on-chain vote, when there is one. */
const sxVoteLink = computed(() => sxTxUrl(sxProposal.value?.network, existingSxVote.value?.tx))
/** The label of the option the indexed on-chain vote picked, when it maps. */
const existingSxChoice = computed(() => {
  const vote = existingSxVote.value
  const choices = proposal.value?.choices
  if (!vote || !choices) return null
  const index = Number(vote.choice)
  if (!Number.isInteger(index) || index < 1 || index > choices.length) return null
  return choices[index - 1] ?? null
})

/** Whether the current proposal can be voted on right now. */
const canVote = computed(() =>
  isSx.value
    ? !sxBlockReason.value && !sxVoted.value && !existingSxVote.value
    : !offchainClosed.value
)
/** Raw indexed SX proposal — carries the authenticator/strategies a vote needs. */
const sxProposal = ref<SxProposal | null>(null)

const proposal = ref<Proposal | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const selectedChoice = ref<number | null>(null)
const reason = ref('')
const submittingVote = ref(false)
const voteError = ref<string | null>(null)
const voteReceipt = ref<unknown | null>(null)

const dtf = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
)

function formatTs(seconds: number) {
  return dtf.value.format(new Date(seconds * 1000))
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

const renderedBody = computed(() => {
  const body = proposal.value?.body
  if (!body) return ''
  return renderMarkdown(body)
})

const voteResults = computed(() => {
  const p = proposal.value
  if (!p || !p.scores?.length) return []
  return p.choices.map((choice, i) => {
    const score = p.scores[i] ?? 0
    const pct = p.scores_total > 0 ? (score / p.scores_total) * 100 : 0
    return { choice, score, pct }
  })
})

const PROPOSAL_TYPES: ProposalType[] = [
  'single-choice',
  'approval',
  'quadratic',
  'ranked-choice',
  'weighted',
  'basic'
]

/** SX reports a free-form type string; keep only ones we can render. */
function toProposalType(type: string): ProposalType {
  return (PROPOSAL_TYPES as string[]).includes(type) ? (type as ProposalType) : 'basic'
}

/** Adapts an indexed SX proposal to the shape the template renders. */
function sxToProposal(sx: SxProposal): Proposal {
  return {
    id: sx.id,
    title: sx.title ?? sx.id,
    body: sx.body ?? '',
    choices: sx.choices,
    type: toProposalType(sx.type),
    start: sx.start,
    end: sx.end,
    snapshot: sx.snapshot === null ? '' : String(sx.snapshot),
    state: sx.state,
    author: '',
    created: sx.start,
    votes: sx.voteCount,
    scores: sx.scores,
    scores_total: sx.scoresTotal,
    space: {
      id: sx.space?.id ?? sxSpaceId.value ?? '',
      name: sx.space?.name ?? sx.space?.id ?? ''
    }
  }
}

/**
 * SX vote: build the sx.js Vote from indexed data and submit it through Mana
 * (gasless). The wallet's EIP-1193 provider feeds the read-side adapter; the
 * signature itself still goes through the active auth provider.
 */
async function castSxVote(address: string, choice: number) {
  const sx = sxProposal.value
  if (!sx) throw new Error('SX proposal not loaded')
  if (!sx.network) throw new Error(t('sxUnknownNetwork'))

  // Pre-flight: don't make the user sign (and Mana reject) a vote that cannot be
  // accepted. Voting power itself is only knowable on-chain.
  const block = sxVoteBlock(
    {
      state: sx.state,
      start: sx.start,
      maxEnd: sx.maxEnd,
      hasAuthenticator: (sx.space?.authenticators.length ?? 0) > 0
    },
    Math.floor(Date.now() / 1000)
  )
  if (block) throw new AppError(SX_BLOCK_CODES[block], 'SX vote blocked: ' + block)

  const eip1193 = (window as unknown as { ethereum?: Eip1193Provider }).ethereum
  if (!eip1193) throw new Error(t('noWallet'))

  const signer = createEthersCompatSigner(address, (typedData) =>
    auth.provider.value.signTypedData({ address, typedData })
  )
  const backend = createSxBackendFromEip1193({ network: sx.network, eip1193 })

  return backend.castVote(
    buildSxVoteRequest({
      spaceId: sx.space?.id ?? sxSpaceId.value ?? '',
      authenticators: sx.space?.authenticators ?? [],
      strategies: sx.space?.strategies ?? sx.strategies,
      proposalId: sx.proposalId,
      choice
    }),
    signer
  )
}

/** Reads the proposal for the current route. Touches no UI state itself. */
async function fetchProposalData(signal: AbortSignal) {
  if (sxSpaceId.value) {
    const sx = await fetchSxProposal(SX_API_ENDPOINT, `${sxSpaceId.value}/${proposalId.value}`, {
      signal
    })
    return { sx, proposal: sx ? sxToProposal(sx) : null }
  }
  const data = await fetchProposal(GRAPHQL_ENDPOINT, { proposalId: proposalId.value, signal })
  return { sx: null, proposal: data.proposal }
}

/**
 * Re-reads the off-chain proposal after a vote so the new tally shows up.
 * Best-effort and off-chain only: the SX indexer lags the on-chain vote, so a
 * refresh there would re-show the old numbers.
 */
async function refreshOffchainProposal() {
  if (!proposalId.value || sxSpaceId.value) return
  const token = guard.next()
  try {
    const data = await fetchProposal(GRAPHQL_ENDPOINT, {
      proposalId: proposalId.value,
      signal: guard.signal
    })
    if (!guard.isCurrent(token) || !data.proposal) return
    proposal.value = data.proposal
  } catch {
    // Keep the proposal already rendered; the vote itself succeeded.
  }
}

/**
 * Looks up the connected account's vote on this SX proposal. The indexer matches
 * the voter address byte-for-byte, and an on-chain vote cannot be repeated, so a
 * hit disables submit. Best-effort: an unknown state keeps the button enabled.
 */
async function loadExistingSxVote() {
  existingSxVote.value = null
  const sx = sxProposal.value
  const address = auth.user.value?.address
  if (!sx || !address || !sxSpaceId.value) return
  const token = voteGuard.next()
  try {
    const vote = await fetchSxVoterVote(
      SX_API_ENDPOINT,
      { spaceId: sxSpaceId.value, proposalId: sx.proposalId, voter: address },
      { signal: voteGuard.signal }
    )
    if (!voteGuard.isCurrent(token)) return
    existingSxVote.value = vote
  } catch {
    // Keep the button enabled; the on-chain authenticator is the real gate.
  }
}

/**
 * Reads the account's current off-chain vote so the ballot can show and prefill
 * it. Off-chain votes are replaceable, so this never disables submit.
 */
async function loadExistingOffchainVote() {
  existingOffchainVote.value = null
  const address = auth.user.value?.address
  if (isSx.value || !address || !proposalId.value) return
  const token = voteGuard.next()
  try {
    const vote = await fetchVoterVote(GRAPHQL_ENDPOINT, {
      proposalId: proposalId.value,
      voter: address,
      signal: voteGuard.signal
    })
    if (!voteGuard.isCurrent(token)) return
    existingOffchainVote.value = vote
    // Prefill a plain 1-based index, and only before the user has picked.
    if (vote && typeof vote.choice === 'number' && selectedChoice.value === null) {
      selectedChoice.value = vote.choice
    }
  } catch {
    // Best-effort; an unknown vote state just leaves the ballot empty.
  }
}

async function loadProposal() {
  if (!proposalId.value) return
  loading.value = true
  error.value = null
  voteError.value = null
  voteReceipt.value = null
  selectedChoice.value = null
  reason.value = ''
  sxVoted.value = false
  existingOffchainVote.value = null
  clearWindowTimer()
  windowNow.value = Math.floor(Date.now() / 1000)
  const token = guard.next()
  try {
    const { sx, proposal: next } = await fetchProposalData(guard.signal)
    if (!guard.isCurrent(token)) return
    sxProposal.value = sx
    proposal.value = next
    armWindowTimer()
    if (sx) void loadExistingSxVote()
    else void loadExistingOffchainVote()
  } catch (e) {
    if (!guard.isCurrent(token)) return
    error.value = e instanceof Error ? e.message : String(e)
    proposal.value = null
  } finally {
    if (guard.isCurrent(token)) {
      loading.value = false
    }
  }
}

/**
 * The ballot UI is single-select, but Snapshot encodes `choice` differently per
 * proposal type — and the EIP-712 type variant must match, or the hub rejects
 * the vote. Project the selected 1-based index onto the right shape.
 */
function encodeChoice(type: ProposalType, choiceIndex: number): VoteChoice {
  if (type === 'approval' || type === 'ranked-choice') return [choiceIndex]
  if (type === 'weighted' || type === 'quadratic') return { [String(choiceIndex)]: 1 }
  return choiceIndex
}

async function submitVote() {
  if (!proposal.value) return
  if (!selectedChoice.value) {
    voteError.value = t('voteChoice')
    return
  }

  voteError.value = null
  voteReceipt.value = null
  submittingVote.value = true
  try {
    if (!auth.isConnected.value) {
      await auth.connect()
    }

    // Email sign-in is identity-only (interim M4) — no key, so no signature.
    if (auth.activeProviderId.value === 'email') {
      throw new EmailSigningUnsupportedError()
    }

    const address = auth.user.value?.address
    if (!address) throw new Error(t('noAccount'))

    // Protocol seam: SX spaces go through the on-chain backend, everything else
    // through the off-chain VoteBackend.
    voteReceipt.value = isSx.value
      ? await castSxVote(address, selectedChoice.value)
      : await activeVoteBackend.castVote({
          vote: {
            from: address,
            space: proposal.value.space.id,
            proposal: proposal.value.id,
            type: proposal.value.type,
            choice: encodeChoice(proposal.value.type, selectedChoice.value),
            reason: reason.value,
            app: SNAPSHOT_APP_NAME
          },
          signTypedData: (typedData) => auth.provider.value.signTypedData({ address, typedData })
        })

    if (isSx.value) {
      // An on-chain vote cannot be repeated; keep the button disabled meanwhile.
      sxVoted.value = true
    } else {
      // Off-chain tallies update immediately; pull them in behind the receipt.
      void refreshOffchainProposal()
      void loadExistingOffchainVote()
    }
  } catch (e) {
    if (e instanceof KmsNotConfiguredError) {
      // Expected until E-5 lands: AirAccount signing has no backend yet.
      voteError.value = t('kmsPending')
    } else if (e instanceof EmailSigningUnsupportedError) {
      // Expected for the interim email identity: it holds no key.
      voteError.value = t('emailSigningUnsupported')
    } else {
      // Coded errors (e.g. hub rejection) are translated; others fall back to
      // their own message.
      voteError.value = resolveErrorMessage(e, t)
    }
  } finally {
    submittingVote.value = false
  }
}

watch(proposalId, () => {
  void loadProposal()
})

onMounted(() => {
  void loadProposal()
})

onUnmounted(() => {
  guard.abort()
  voteGuard.abort()
  clearWindowTimer()
})
</script>

<template>
  <main class="page">
    <div class="top">
      <RouterLink v-if="proposal?.space?.id" class="back" :to="`/space/${proposal.space.id}`">
        {{ t('back') }}
      </RouterLink>
      <RouterLink v-else class="back" to="/explore">{{ t('back') }}</RouterLink>
    </div>

    <div v-if="loading" class="card">
      <div class="muted">{{ t('loading') }}</div>
    </div>

    <div v-else-if="error" class="card">
      <div class="error">
        {{ error }}
        <button class="retryBtn" type="button" :disabled="loading" @click="loadProposal()">
          {{ t('retry') }}
        </button>
      </div>
    </div>

    <div v-else-if="!proposal" class="card">
      <div class="muted">{{ t('empty') }}</div>
    </div>

    <div v-else class="card">
      <div class="titleRow">
        <h1 class="title">{{ proposal.title }}</h1>
        <div class="right">
          <div v-if="isSx" class="chip">{{ t('sxOnchain') }}</div>
          <div class="chip">{{ proposal.state }}</div>
        </div>
      </div>

      <div class="metaGrid">
        <div class="metaItem">
          <div class="metaLabel">{{ t('space') }}</div>
          <RouterLink class="metaValue link" :to="`/space/${proposal.space.id}`">
            {{ proposal.space.name }}
          </RouterLink>
        </div>
        <div class="metaItem">
          <div class="metaLabel">{{ t('author') }}</div>
          <div class="metaValue">{{ shortAddress(proposal.author) }}</div>
        </div>
        <div class="metaItem">
          <div class="metaLabel">{{ t('start') }}</div>
          <div class="metaValue">{{ formatTs(proposal.start) }}</div>
        </div>
        <div class="metaItem">
          <div class="metaLabel">{{ t('end') }}</div>
          <div class="metaValue">{{ formatTs(proposal.end) }}</div>
        </div>
      </div>

      <div v-if="proposal.body" class="body">
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div class="bodyContent" v-html="renderedBody" />
      </div>

      <div class="sectionTitle">{{ t('proposal') }}</div>
      <ul class="choices">
        <li v-for="(c, idx) in proposal.choices" :key="idx" class="choice">
          <button
            class="choiceButton"
            type="button"
            :data-selected="selectedChoice === idx + 1"
            @click="selectedChoice = idx + 1"
          >
            <div class="choiceIndex">{{ idx + 1 }}</div>
            <div class="choiceText">{{ c }}</div>
          </button>
        </li>
      </ul>

      <!-- Vote results -->
      <div v-if="voteResults.length > 0" class="resultsSection">
        <div class="sectionTitle">
          {{ t('results') }}
          <span class="votesCount">{{ proposal.votes }} {{ t('votes') }}</span>
        </div>
        <ul class="resultsList">
          <li v-for="(r, idx) in voteResults" :key="idx" class="resultItem">
            <div class="resultRow">
              <span class="resultChoice">{{ r.choice }}</span>
              <span class="resultPct">{{ r.pct.toFixed(1) }}%</span>
            </div>
            <div class="barTrack">
              <div class="barFill" :style="{ width: `${r.pct}%` }" />
            </div>
          </li>
        </ul>
      </div>

      <div class="voteSection">
        <div class="sectionTitle">{{ t('vote') }}</div>

        <label class="reasonLabel" for="reason">{{ t('reasonOptional') }}</label>
        <textarea id="reason" v-model="reason" class="reason" rows="3" />

        <button
          class="submit"
          type="button"
          :disabled="submittingVote || !canVote"
          @click="submitVote"
        >
          {{ submittingVote ? t('loading') : t('submitVote') }}
        </button>

        <div v-if="isSx && sxBlockText" class="sxVoteNote">{{ sxBlockText }}</div>

        <div v-if="!isSx && existingOffchainVote" class="sxVoteNote">
          {{ t('offchainAlreadyVoted') }}
        </div>

        <div v-if="isSx && (sxVoted || existingSxVote)" class="sxVoteNote">
          {{ t('sxAlreadyVoted') }}
          <span v-if="existingSxVote && existingSxVote.vp !== null" class="sxVotePower">
            · {{ t('sxVotePower') }}: {{ existingSxVote.vp }}
          </span>
          <span v-if="existingSxChoice" class="sxVoteChoice">
            · {{ t('sxYourChoice') }}: {{ existingSxChoice }}
          </span>
          <a v-if="sxVoteLink" class="sxVoteLink" :href="sxVoteLink" target="_blank" rel="noopener">
            {{ t('sxViewTx') }}
          </a>
        </div>

        <div v-if="voteError" class="voteError">{{ t('voteError') }}: {{ voteError }}</div>
        <div v-else-if="voteReceipt" class="voteOk">{{ t('voteSubmitted') }}</div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.page {
  max-width: 960px;
  margin: 0 auto;
  padding: 32px 20px 64px;
}

.top {
  margin-bottom: 18px;
}

.back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--mv-muted);
  text-decoration: none;
  font-weight: 600;
  font-size: 0.92rem;
  padding: 6px 14px;
  border-radius: var(--mv-radius-full);
  background: var(--mv-surface);
  border: 1px solid var(--mv-card-border);
  transition: all 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.back:hover {
  color: var(--mv-primary);
  border-color: var(--mv-card-border-hover);
  background: var(--mv-surface-hover);
  transform: translateX(-2px);
}

.card {
  border: 1px solid var(--mv-card-border);
  border-radius: var(--mv-radius-lg);
  padding: 32px 28px;
  background: var(--mv-card-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: var(--mv-shadow-md);
}

.titleRow {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.title {
  margin: 0;
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.35;
  color: var(--mv-text-heading);
  flex: 1;
}

.right {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.chip {
  border: 1px solid var(--mv-card-border);
  border-radius: var(--mv-radius-full);
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--mv-primary);
  background: var(--mv-selected-bg);
  text-transform: capitalize;
}

.metaGrid {
  margin-top: 20px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.metaItem {
  border: 1px solid var(--mv-border);
  border-radius: var(--mv-radius);
  padding: 12px 14px;
  background: var(--mv-surface);
  transition: all 0.2s ease;
}

.metaItem:hover {
  border-color: var(--mv-card-border);
  background: var(--mv-surface-hover);
}

.metaLabel {
  font-size: 11px;
  font-weight: 700;
  color: var(--mv-muted-sm);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.metaValue {
  margin-top: 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--mv-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.link {
  color: inherit;
  text-decoration: none;
  transition: color 0.2s ease;
}

.link:hover {
  color: var(--mv-primary);
}

.body {
  margin-top: 24px;
}

.bodyContent {
  padding: 24px;
  border: 1px solid var(--mv-border);
  border-radius: var(--mv-radius);
  background: var(--mv-surface);
  font-size: 15px;
  line-height: 1.7;
  color: var(--mv-text);
}

/* Markdown content styling */
.bodyContent :deep(h1),
.bodyContent :deep(h2),
.bodyContent :deep(h3) {
  margin-top: 1.4em;
  margin-bottom: 0.6em;
  font-weight: 700;
  color: var(--mv-text-heading);
}

.bodyContent :deep(p) {
  margin: 0.8em 0;
}

.bodyContent :deep(ul),
.bodyContent :deep(ol) {
  padding-left: 1.6em;
  margin: 0.8em 0;
}

.bodyContent :deep(li) {
  margin: 0.3em 0;
}

.bodyContent :deep(code) {
  background: var(--mv-surface-md);
  border: 1px solid var(--mv-border);
  border-radius: 6px;
  padding: 2px 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.88em;
  color: var(--mv-primary);
}

.bodyContent :deep(pre) {
  background: var(--mv-surface-md);
  border: 1px solid var(--mv-border);
  border-radius: var(--mv-radius);
  padding: 16px;
  overflow-x: auto;
}

.bodyContent :deep(pre code) {
  background: transparent;
  border: none;
  padding: 0;
}

.bodyContent :deep(a) {
  color: var(--mv-primary);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.bodyContent :deep(blockquote) {
  border-left: 3px solid var(--mv-primary);
  background: var(--mv-selected-bg);
  margin: 1.2em 0;
  padding: 10px 16px;
  border-radius: 0 var(--mv-radius-sm) var(--mv-radius-sm) 0;
  color: var(--mv-muted);
}

.sectionTitle {
  margin-top: 28px;
  font-weight: 700;
  font-size: 1.15rem;
  letter-spacing: -0.01em;
  color: var(--mv-text-heading);
  display: flex;
  align-items: center;
  gap: 10px;
}

.sectionTitle::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 16px;
  border-radius: var(--mv-radius-full);
  background: var(--mv-primary);
}

.votesCount {
  font-size: 13px;
  font-weight: 500;
  color: var(--mv-muted-sm);
  background: var(--mv-surface);
  padding: 2px 8px;
  border-radius: var(--mv-radius-full);
  border: 1px solid var(--mv-border);
}

.choices {
  margin: 16px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 12px;
}

.choice {
  border: 1px solid var(--mv-border);
  border-radius: var(--mv-radius);
  padding: 0;
  overflow: hidden;
  transition: all 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
  background: var(--mv-surface);
}

.choice:hover {
  border-color: var(--mv-card-border-hover);
  background: var(--mv-surface-hover);
  transform: translateY(-1px);
}

.choiceButton {
  width: 100%;
  border: none;
  background: transparent;
  padding: 14px 18px;
  display: flex;
  align-items: center;
  gap: 14px;
  text-align: left;
  color: inherit;
  cursor: pointer;
  transition: background 0.2s ease;
}

.choiceButton[data-selected='true'] {
  background: var(--mv-selected-bg);
}

.choice:has(.choiceButton[data-selected='true']) {
  border-color: var(--mv-primary);
  box-shadow: 0 0 16px -2px var(--mv-primary-glow);
}

.choiceButton:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.choiceIndex {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--mv-surface-md);
  border: 1px solid var(--mv-border-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 13px;
  flex-shrink: 0;
  color: var(--mv-text);
  transition: all 0.2s ease;
}

.choiceButton[data-selected='true'] .choiceIndex {
  background: var(--mv-primary);
  border-color: var(--mv-primary);
  color: #ffffff;
  box-shadow: 0 0 10px var(--mv-primary-glow);
}

.choiceText {
  font-weight: 600;
  font-size: 0.98rem;
  line-height: 1.4;
  color: var(--mv-text-heading);
}

/* Vote results */
.resultsSection {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--mv-border);
}

.resultsList {
  margin: 16px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 14px;
}

.resultItem {
  font-size: 14px;
}

.resultRow {
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
}

.resultChoice {
  font-weight: 600;
  color: var(--mv-text-heading);
}

.resultPct {
  font-weight: 700;
  color: var(--mv-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.barTrack {
  height: 8px;
  background: var(--mv-surface-md);
  border-radius: var(--mv-radius-full);
  overflow: hidden;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.1);
}

.barFill {
  height: 100%;
  background: linear-gradient(90deg, var(--mv-primary), #36d399);
  border-radius: var(--mv-radius-full);
  transition: width 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);
  min-width: 0;
}

/* Vote form */
.voteSection {
  margin-top: 28px;
  border-top: 1px solid var(--mv-border);
  padding-top: 20px;
}

.reasonLabel {
  margin-top: 14px;
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--mv-muted-sm);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.reason {
  margin-top: 8px;
  width: 100%;
  resize: vertical;
  border: 1px solid var(--mv-border-md);
  border-radius: var(--mv-radius);
  padding: 12px 14px;
  background: var(--mv-surface);
  color: inherit;
  font: inherit;
  box-sizing: border-box;
}

.submit {
  margin-top: 16px;
  border: 1px solid var(--mv-primary);
  border-radius: var(--mv-radius-full);
  padding: 12px 28px;
  background: linear-gradient(135deg, var(--mv-primary), var(--mv-primary-hover));
  color: #ffffff;
  cursor: pointer;
  font-weight: 700;
  font-size: 0.95rem;
  box-shadow: var(--mv-shadow-glow), var(--mv-shadow-sm);
  transition: all 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.submit:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 0 25px var(--mv-primary), var(--mv-shadow-md);
}

.submit:disabled {
  cursor: not-allowed;
  opacity: 0.5;
  box-shadow: none;
}

.sxVoteNote {
  margin-top: 12px;
  font-size: 13px;
  color: var(--mv-muted);
  background: var(--mv-surface);
  border: 1px solid var(--mv-border);
  padding: 8px 14px;
  border-radius: var(--mv-radius);
}

.sxVoteLink {
  margin-left: 6px;
  color: var(--mv-primary);
  font-weight: 600;
}

.voteError {
  margin-top: 14px;
  padding: 10px 14px;
  border-radius: var(--mv-radius);
  background: rgba(224, 82, 96, 0.1);
  border: 1px solid rgba(224, 82, 96, 0.3);
  color: var(--mv-error);
  font-size: 13px;
  word-break: break-word;
}

.voteOk {
  margin-top: 14px;
  padding: 10px 14px;
  border-radius: var(--mv-radius);
  background: var(--mv-selected-bg);
  border: 1px solid var(--mv-card-border);
  color: var(--mv-primary);
  font-weight: 600;
  font-size: 13px;
}

.muted {
  color: var(--mv-muted);
  font-size: 14px;
}

.error {
  color: var(--mv-error);
  word-break: break-word;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.retryBtn {
  align-self: flex-start;
  border: 1px solid var(--mv-card-border);
  border-radius: var(--mv-radius-full);
  padding: 6px 16px;
  background: var(--mv-surface);
  color: inherit;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  transition: all 0.2s ease;
}

.retryBtn:hover {
  border-color: var(--mv-primary);
  color: var(--mv-primary);
  transform: translateY(-1px);
}

@media (max-width: 720px) {
  .metaGrid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 480px) {
  .metaGrid {
    grid-template-columns: 1fr;
  }
}
</style>
