<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import { GRAPHQL_ENDPOINT, SX_API_ENDPOINT } from '../config'
import { fetchSpaceWithProposals, formatSpaceNetwork, type ProposalListItem, type Space } from '../lib/graphql'
import { takePage } from '../lib/pageCursor'
import { createRequestGuard } from '../lib/requestGuard'
import { fetchSxProposals, fetchSxSpace, type SxProposal } from '../lib/sx/api'
import { sxNetworkLabel } from '../lib/sx/backend'
import type { SxProposalState } from '../lib/sx/types'
import { protocolForSpaceId } from '../lib/voteRouting'

const { t, locale } = useI18n()
const route = useRoute()

const PAGE_SIZE = 20

const guard = createRequestGuard()

const spaceId = computed(() => String(route.params.id ?? ''))

// Proposal state filter ('all' sends no predicate; both backends accept one).
const stateFilter = ref<'all' | SxProposalState>('all')
const stateOptions: { value: 'all' | SxProposalState; label: string }[] = [
  { value: 'all', label: 'filterAll' },
  { value: 'active', label: 'filterActive' },
  { value: 'closed', label: 'filterClosed' }
]

const space = ref<Space | null>(null)
const proposals = ref<ProposalListItem[]>([])
const loading = ref(false)
/** A list-only reload (filter change) keeps the card and its filters on screen. */
const listLoading = ref(false)
const loadingMore = ref(false)
const error = ref<string | null>(null)
const hasMore = ref(true)
/** True when the current space is a Snapshot X (on-chain) space. */
const isSx = ref(false)
/** On-chain-only details (network + proposal count), when applicable. */
const sxMeta = ref<{ network: string | null; proposalCount: number } | null>(null)

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

/** Adapts an indexed SX proposal to the list item the template renders. */
function sxListItem(p: SxProposal): ProposalListItem {
  return { id: String(p.proposalId), title: p.title ?? '', created: p.start, state: p.state }
}

async function loadSpace(skip: number, keepSpace = false) {
  if (!spaceId.value) return
  if (skip === 0) {
    if (keepSpace && space.value) {
      // Filter change: keep the header and filters, reload only the list.
      listLoading.value = true
    } else {
      loading.value = true
      space.value = null
      proposals.value = []
      sxMeta.value = null
    }
  } else {
    loadingMore.value = true
  }
  error.value = null
  const token = guard.next()
  const signal = guard.signal
  const sx = protocolForSpaceId(spaceId.value) === 'snapshot-x'
  isSx.value = sx
  const state = stateFilter.value === 'all' ? undefined : stateFilter.value
  try {
    if (sx) {
      // On-chain space: read from the SX indexer instead of the off-chain Hub.
      const [sxSpace, page] = await Promise.all([
        fetchSxSpace(SX_API_ENDPOINT, spaceId.value, { signal }),
        fetchSxProposals(SX_API_ENDPOINT, spaceId.value, { first: PAGE_SIZE + 1, skip, signal, state })
      ])
      if (!guard.isCurrent(token)) return

      space.value = sxSpace
        ? { id: sxSpace.id, name: sxSpace.name ?? sxSpace.id, about: sxSpace.about ?? undefined }
        : null
      sxMeta.value = sxSpace
        ? { network: sxNetworkLabel(sxSpace.network), proposalCount: sxSpace.proposalCount }
        : null
      const { page: sxPage, hasMore: sxMore } = takePage(page.map(sxListItem), PAGE_SIZE)
      proposals.value = skip === 0 ? sxPage : [...proposals.value, ...sxPage]
      hasMore.value = sxMore
      return
    }

    const data = await fetchSpaceWithProposals(GRAPHQL_ENDPOINT, {
      spaceId: spaceId.value,
      first: PAGE_SIZE + 1,
      skip,
      signal,
      state
    })
    if (!guard.isCurrent(token)) return

    const { page, hasMore: more } = takePage(data.proposals, PAGE_SIZE)
    if (skip === 0) {
      space.value = data.space
      proposals.value = page
    } else {
      proposals.value = [...proposals.value, ...page]
    }
    hasMore.value = more
  } catch (e) {
    if (!guard.isCurrent(token)) return
    error.value = e instanceof Error ? e.message : String(e)
    if (skip === 0) {
      space.value = null
      proposals.value = []
    }
  } finally {
    if (guard.isCurrent(token)) {
      loading.value = false
      listLoading.value = false
      loadingMore.value = false
    }
  }
}

function loadMore() {
  void loadSpace(proposals.value.length)
}

/**
 * Off-chain proposal ids are globally unique (a hash), so they go straight in
 * the path. SX proposal ids are only unique within their space, so the space
 * rides along as a query param instead of a slash-bearing path segment.
 */
function proposalLink(p: ProposalListItem) {
  return isSx.value
    ? { path: `/proposal/${p.id}`, query: { space: spaceId.value } }
    : `/proposal/${p.id}`
}

watch(spaceId, () => {
  // Resetting the filter already reloads via the stateFilter watcher; calling
  // here as well would fire the same request twice.
  if (stateFilter.value !== 'all') {
    stateFilter.value = 'all'
    return
  }
  void loadSpace(0)
})

watch(stateFilter, () => {
  // Keep the card and its filters mounted; only the list reloads.
  void loadSpace(0, true)
})

onMounted(() => {
  void loadSpace(0)
})

onUnmounted(() => {
  guard.abort()
})
</script>

<template>
  <main class="page">
    <div class="top">
      <RouterLink class="back" to="/explore">{{ t('back') }}</RouterLink>
    </div>

    <div v-if="loading" class="card">
      <div class="muted">{{ t('loading') }}</div>
    </div>

    <div v-else-if="error" class="card">
      <div class="error">
        {{ error }}
        <button class="retryBtn" type="button" :disabled="loading" @click="loadSpace(0)">
          {{ t('retry') }}
        </button>
      </div>
    </div>

    <div v-else-if="!space" class="card">
      <div class="muted">{{ t('empty') }}</div>
    </div>

    <div v-else class="card">
      <div class="titleRow">
        <h1 class="title">{{ space.name }}</h1>
        <div class="id">{{ space.id }}</div>
      </div>

      <div v-if="isSx" class="chips">
        <span class="chip">{{ t('sxOnchain') }}</span>
        <span v-if="sxMeta?.network" class="chip">{{ sxMeta.network }}</span>
      </div>
      <div v-else-if="formatSpaceNetwork(space.network)" class="chips">
        <span class="chip">{{ formatSpaceNetwork(space.network) }}</span>
      </div>

      <div v-if="space.about" class="about">{{ space.about }}</div>

      <div v-if="sxMeta" class="sxMeta">
        {{ t('network') }}: {{ sxMeta.network ?? '—' }} · {{ t('proposals') }}:
        {{ sxMeta.proposalCount }}
      </div>
      <div v-else-if="formatSpaceNetwork(space.network)" class="sxMeta">
        {{ t('network') }}: {{ formatSpaceNetwork(space.network) }}
      </div>

      <div class="sectionTitle">{{ t('proposals') }}</div>
      <div class="filters">
        <button
          v-for="option in stateOptions"
          :key="option.value"
          type="button"
          class="filterBtn"
          :class="{ isActive: stateFilter === option.value }"
          @click="stateFilter = option.value"
        >
          {{ t(option.label) }}
        </button>
      </div>
      <div v-if="listLoading" class="muted listLoading">{{ t('loading') }}</div>
      <div v-else-if="proposals.length === 0" class="muted">
        {{ stateFilter === 'all' ? t('empty') : t('emptyFiltered') }}
      </div>
      <ul v-else class="list">
        <li v-for="p in proposals" :key="p.id" class="item">
          <RouterLink class="proposalTitle" :to="proposalLink(p)">
            {{ p.title }}
          </RouterLink>
          <div class="meta">
            <span>{{ t('state') }}: {{ p.state }}</span>
            <span>·</span>
            <span>{{ formatTs(p.created) }}</span>
          </div>
        </li>
      </ul>

      <div v-if="!listLoading && proposals.length > 0 && hasMore" class="more">
        <button class="moreBtn" type="button" :disabled="loadingMore" @click="loadMore">
          {{ loadingMore ? t('loading') : t('loadMore') }}
        </button>
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
  padding: 28px;
  background: var(--mv-card-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: var(--mv-shadow-md);
}

.titleRow {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
}

.title {
  margin: 0;
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--mv-text-heading);
}

.id {
  font-size: 13px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: var(--mv-muted-sm);
  background: var(--mv-surface);
  border: 1px solid var(--mv-border);
  padding: 3px 10px;
  border-radius: var(--mv-radius-full);
}

.chips {
  margin: 10px 0 16px;
  display: flex;
  gap: 8px;
}

.chip {
  border: 1px solid var(--mv-card-border);
  border-radius: var(--mv-radius-full);
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--mv-primary);
  background: var(--mv-selected-bg);
}

.sxMeta {
  margin-top: 10px;
  font-size: 13px;
  color: var(--mv-muted);
}

.about {
  margin: 14px 0 20px;
  color: var(--mv-text);
  font-size: 15px;
  line-height: 1.6;
  opacity: 0.9;
}

.sectionTitle {
  margin-top: 28px;
  font-weight: 700;
  font-size: 1.15rem;
  letter-spacing: -0.01em;
  color: var(--mv-text-heading);
  display: flex;
  align-items: center;
  gap: 8px;
}

.sectionTitle::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 16px;
  border-radius: var(--mv-radius-full);
  background: var(--mv-primary);
}

.muted {
  margin-top: 14px;
  color: var(--mv-muted);
  font-size: 14px;
}

.listLoading {
  padding: 16px 0;
}

.error {
  color: var(--mv-error);
  word-break: break-word;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 0;
}

.filters {
  display: flex;
  gap: 8px;
  margin: 14px 0 18px;
  padding: 4px;
  background: var(--mv-surface);
  border: 1px solid var(--mv-border);
  border-radius: var(--mv-radius-full);
  width: fit-content;
}

.filterBtn {
  border: 1px solid transparent;
  border-radius: var(--mv-radius-full);
  padding: 6px 16px;
  background: transparent;
  color: var(--mv-muted);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  transition: all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
  box-shadow: none;
}

.filterBtn:hover {
  color: var(--mv-text);
  background: var(--mv-surface-hover);
}

.filterBtn.isActive {
  background: var(--mv-card-bg);
  border-color: var(--mv-card-border);
  color: var(--mv-primary);
  font-weight: 700;
  box-shadow: var(--mv-shadow-sm);
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

.list {
  margin: 16px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 12px;
}

.item {
  border: 1px solid var(--mv-border);
  border-radius: var(--mv-radius);
  padding: 18px 20px;
  background: var(--mv-surface);
  transition: all 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.item:hover {
  border-color: var(--mv-card-border-hover);
  background: var(--mv-surface-hover);
  transform: translateY(-2px);
  box-shadow: var(--mv-shadow-md), var(--mv-shadow-glow);
}

.proposalTitle {
  color: var(--mv-text-heading);
  text-decoration: none;
  font-weight: 700;
  font-size: 1.05rem;
  line-height: 1.4;
  display: block;
  transition: color 0.2s ease;
}

.item:hover .proposalTitle {
  color: var(--mv-primary);
}

.meta {
  margin-top: 8px;
  font-size: 12px;
  color: var(--mv-muted-sm);
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.more {
  margin-top: 24px;
  text-align: center;
}

.moreBtn {
  border: 1px solid var(--mv-card-border);
  border-radius: var(--mv-radius-full);
  padding: 10px 28px;
  background: var(--mv-surface-md);
  color: var(--mv-text-heading);
  cursor: pointer;
  font-weight: 600;
  font-size: 0.95rem;
  box-shadow: var(--mv-shadow-sm);
  transition: all 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.moreBtn:hover:not(:disabled) {
  border-color: var(--mv-primary);
  color: var(--mv-primary);
  background: var(--mv-surface-hover);
  box-shadow: var(--mv-shadow-glow);
  transform: translateY(-1px);
}

.moreBtn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>
