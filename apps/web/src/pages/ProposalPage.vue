<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { providers } from 'ethers'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

import { GRAPHQL_ENDPOINT, SNAPSHOT_APP_NAME, SNAPSHOT_HUB_URL } from '../config'
import { useAuth } from '../auth/useAuth'
import { fetchProposal, type Proposal } from '../lib/graphql'

const { t, locale } = useI18n()
const route = useRoute()
const auth = useAuth()

const proposalId = computed(() => String(route.params.id ?? ''))

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
  return DOMPurify.sanitize(marked(body) as string)
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

async function loadProposal() {
  if (!proposalId.value) return
  loading.value = true
  error.value = null
  voteError.value = null
  voteReceipt.value = null
  selectedChoice.value = null
  reason.value = ''
  try {
    const data = await fetchProposal(GRAPHQL_ENDPOINT, { proposalId: proposalId.value })
    proposal.value = data.proposal
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    proposal.value = null
  } finally {
    loading.value = false
  }
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

    const ethereum = (window as unknown as { ethereum?: unknown }).ethereum
    if (!ethereum) throw new Error('No injected wallet found')

    const web3 = new providers.Web3Provider(ethereum as any)
    const accounts = await web3.listAccounts()
    const account = accounts?.[0]
    if (!account) throw new Error('No account selected')

    const snapshot = (await import('@snapshot-labs/snapshot.js')).default as any
    const client = new snapshot.Client712(SNAPSHOT_HUB_URL)
    const receipt = await client.vote(web3, account, {
      space: proposal.value.space.id,
      proposal: proposal.value.id,
      type: proposal.value.type,
      choice: selectedChoice.value,
      reason: reason.value,
      app: SNAPSHOT_APP_NAME
    })

    voteReceipt.value = receipt
  } catch (e) {
    voteError.value = e instanceof Error ? e.message : String(e)
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
      <div class="error">{{ error }}</div>
    </div>

    <div v-else-if="!proposal" class="card">
      <div class="muted">{{ t('empty') }}</div>
    </div>

    <div v-else class="card">
      <div class="titleRow">
        <h1 class="title">{{ proposal.title }}</h1>
        <div class="right">
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

        <button class="submit" type="button" :disabled="submittingVote" @click="submitVote">
          {{ submittingVote ? t('loading') : t('submitVote') }}
        </button>

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
  padding: 24px;
}

.top {
  margin-bottom: 12px;
}

.back {
  color: inherit;
  text-decoration: none;
  font-weight: 600;
}

.card {
  border: 1px solid var(--mv-border);
  border-radius: 12px;
  padding: 16px;
}

.titleRow {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}

.right {
  display: flex;
  gap: 8px;
}

.chip {
  border: 1px solid var(--mv-border-md);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--mv-muted);
}

.metaGrid {
  margin-top: 12px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.metaItem {
  border: 1px solid var(--mv-border-sm);
  border-radius: 10px;
  padding: 10px;
}

.metaLabel {
  font-size: 12px;
  color: var(--mv-muted-sm);
}

.metaValue {
  margin-top: 4px;
  font-weight: 600;
}

.link {
  color: inherit;
  text-decoration: none;
}

.body {
  margin-top: 14px;
}

.bodyContent {
  padding: 12px;
  border: 1px solid var(--mv-border-sm);
  border-radius: 10px;
  background: var(--mv-surface);
  font-size: 14px;
  line-height: 1.6;
}

/* Markdown content styling */
.bodyContent :deep(h1),
.bodyContent :deep(h2),
.bodyContent :deep(h3) {
  margin-top: 1em;
  margin-bottom: 0.5em;
}
.bodyContent :deep(p) {
  margin: 0.5em 0;
}
.bodyContent :deep(ul),
.bodyContent :deep(ol) {
  padding-left: 1.5em;
}
.bodyContent :deep(code) {
  background: var(--mv-surface-md);
  border-radius: 4px;
  padding: 1px 4px;
  font-size: 0.9em;
}
.bodyContent :deep(pre) {
  background: var(--mv-surface-md);
  border-radius: 8px;
  padding: 12px;
  overflow-x: auto;
}
.bodyContent :deep(a) {
  color: var(--mv-primary);
}
.bodyContent :deep(blockquote) {
  border-left: 3px solid var(--mv-border-md);
  margin: 0;
  padding-left: 12px;
  color: var(--mv-muted);
}

.sectionTitle {
  margin-top: 16px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 8px;
}

.votesCount {
  font-size: 13px;
  font-weight: 400;
  color: var(--mv-muted-sm);
}

.choices {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 10px;
}

.choice {
  border: 1px solid var(--mv-border-sm);
  border-radius: 10px;
  padding: 0;
  overflow: hidden;
}

.choiceButton {
  width: 100%;
  border: none;
  background: transparent;
  padding: 12px;
  display: flex;
  gap: 10px;
  text-align: left;
  color: inherit;
  cursor: pointer;
}

.choiceButton[data-selected='true'] {
  background: var(--mv-selected-bg);
}

.choiceButton:disabled {
  cursor: not-allowed;
}

.choiceIndex {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--mv-surface-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  flex-shrink: 0;
}

.choiceText {
  font-weight: 600;
  line-height: 1.4;
}

/* Vote results */
.resultsSection {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--mv-border-sm);
}

.resultsList {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 10px;
}

.resultItem {
  font-size: 14px;
}

.resultRow {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}

.resultChoice {
  font-weight: 600;
}

.resultPct {
  color: var(--mv-muted-sm);
}

.barTrack {
  height: 6px;
  background: var(--mv-surface-md);
  border-radius: 3px;
  overflow: hidden;
}

.barFill {
  height: 100%;
  background: var(--mv-primary);
  border-radius: 3px;
  transition: width 0.4s ease;
  min-width: 0;
}

/* Vote form */
.voteSection {
  margin-top: 18px;
  border-top: 1px solid var(--mv-border-sm);
  padding-top: 16px;
}

.reasonLabel {
  margin-top: 10px;
  display: block;
  font-size: 12px;
  color: var(--mv-muted-sm);
}

.reason {
  margin-top: 6px;
  width: 100%;
  resize: vertical;
  border: 1px solid var(--mv-border-md);
  border-radius: 10px;
  padding: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  box-sizing: border-box;
}

.submit {
  margin-top: 10px;
  border: 1px solid var(--mv-border-md);
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--mv-surface);
  color: inherit;
  cursor: pointer;
  font-weight: 700;
}

.submit:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.voteError {
  margin-top: 10px;
  color: var(--mv-error);
  word-break: break-word;
}

.voteOk {
  margin-top: 10px;
  color: var(--mv-muted);
  font-weight: 600;
}

.muted {
  color: var(--mv-muted);
  font-size: 14px;
}

.error {
  color: var(--mv-error);
  word-break: break-word;
}

@media (max-width: 720px) {
  .metaGrid {
    grid-template-columns: 1fr;
  }
}
</style>
