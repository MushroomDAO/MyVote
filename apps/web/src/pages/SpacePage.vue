<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import { GRAPHQL_ENDPOINT, SX_API_ENDPOINT } from '../config'
import { fetchSpaceWithProposals, type ProposalListItem, type Space } from '../lib/graphql'
import { createRequestGuard } from '../lib/requestGuard'
import { fetchSxProposals, fetchSxSpace, type SxProposal } from '../lib/sx/api'
import { sxNetworkLabel } from '../lib/sx/backend'
import { protocolForSpaceId } from '../lib/voteRouting'

const { t, locale } = useI18n()
const route = useRoute()

const PAGE_SIZE = 20

const guard = createRequestGuard()

const spaceId = computed(() => String(route.params.id ?? ''))

const space = ref<Space | null>(null)
const proposals = ref<ProposalListItem[]>([])
const loading = ref(false)
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

async function loadSpace(skip: number) {
  if (!spaceId.value) return
  if (skip === 0) {
    loading.value = true
    space.value = null
    proposals.value = []
    sxMeta.value = null
  } else {
    loadingMore.value = true
  }
  error.value = null
  const token = guard.next()
  const signal = guard.signal
  const sx = protocolForSpaceId(spaceId.value) === 'snapshot-x'
  isSx.value = sx
  try {
    if (sx) {
      // On-chain space: read from the SX indexer instead of the off-chain Hub.
      const [sxSpace, page] = await Promise.all([
        fetchSxSpace(SX_API_ENDPOINT, spaceId.value, { signal }),
        fetchSxProposals(SX_API_ENDPOINT, spaceId.value, { first: PAGE_SIZE, skip, signal })
      ])
      if (!guard.isCurrent(token)) return

      space.value = sxSpace
        ? { id: sxSpace.id, name: sxSpace.name ?? sxSpace.id, about: sxSpace.about ?? undefined }
        : null
      sxMeta.value = sxSpace
        ? { network: sxNetworkLabel(sxSpace.network), proposalCount: sxSpace.proposalCount }
        : null
      const items = page.map(sxListItem)
      proposals.value = skip === 0 ? items : [...proposals.value, ...items]
      hasMore.value = page.length === PAGE_SIZE
      return
    }

    const data = await fetchSpaceWithProposals(GRAPHQL_ENDPOINT, {
      spaceId: spaceId.value,
      first: PAGE_SIZE,
      skip,
      signal
    })
    if (!guard.isCurrent(token)) return

    if (skip === 0) {
      space.value = data.space
      proposals.value = data.proposals
    } else {
      proposals.value = [...proposals.value, ...data.proposals]
    }
    hasMore.value = data.proposals.length === PAGE_SIZE
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
  void loadSpace(0)
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
      <div class="error">{{ error }}</div>
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
      </div>

      <div v-if="space.about" class="about">{{ space.about }}</div>

      <div v-if="sxMeta" class="sxMeta">
        {{ t('network') }}: {{ sxMeta.network ?? '—' }} · {{ t('proposals') }}:
        {{ sxMeta.proposalCount }}
      </div>

      <div class="sectionTitle">{{ t('proposals') }}</div>
      <div v-if="proposals.length === 0" class="muted">{{ t('empty') }}</div>
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

      <div v-if="proposals.length > 0 && hasMore" class="more">
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
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}

.id {
  font-size: 12px;
  color: var(--mv-muted-sm);
}

.chips {
  margin-top: 8px;
  display: flex;
  gap: 6px;
}

.chip {
  border: 1px solid var(--mv-border-md);
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 12px;
  color: var(--mv-muted);
}

.sxMeta {
  margin-top: 8px;
  font-size: 13px;
  color: var(--mv-muted);
}

.about {
  margin-top: 8px;
  color: var(--mv-muted);
  font-size: 14px;
}

.sectionTitle {
  margin-top: 16px;
  font-weight: 700;
}

.muted {
  margin-top: 10px;
  color: var(--mv-muted);
  font-size: 14px;
}

.error {
  color: var(--mv-error);
  word-break: break-word;
}

.list {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 10px;
}

.item {
  border: 1px solid var(--mv-border-sm);
  border-radius: 10px;
  padding: 12px;
}

.proposalTitle {
  color: inherit;
  text-decoration: none;
  font-weight: 700;
}

.meta {
  margin-top: 6px;
  font-size: 12px;
  color: var(--mv-muted-sm);
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.more {
  margin-top: 16px;
  text-align: center;
}

.moreBtn {
  border: 1px solid var(--mv-border-md);
  border-radius: 10px;
  padding: 8px 20px;
  background: var(--mv-surface);
  color: inherit;
  cursor: pointer;
  font-weight: 600;
}

.moreBtn:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}
</style>
