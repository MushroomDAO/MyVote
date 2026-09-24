<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { GRAPHQL_ENDPOINT, SX_API_ENDPOINT } from '../config'
import { fetchSpaces, type Space } from '../lib/graphql'
import { cacheGet, cacheSet, cacheDelete, scopedCacheKey } from '../lib/cache'
import { createRequestGuard } from '../lib/requestGuard'
import { fetchSxSpaces, type SxSpace } from '../lib/sx/api'
import { sxNetworkLabel } from '../lib/sx/backend'
import { protocolForSpaceId } from '../lib/voteRouting'

const { t } = useI18n()
const router = useRouter()

const PAGE_SIZE = 30
// Namespaced by host so one tenant's spaces never serve another's cache.
const CACHE_KEY = scopedCacheKey('explore:spaces')

const guard = createRequestGuard()

// Snapshot X spaces are contracts, not ENS names, so they are not in the Hub
// listing above. Let users open one directly by address.
const sxAddress = ref('')
const sxError = ref<string | null>(null)

// Recently created on-chain spaces — the Hub listing only has ENS spaces.
const sxSpaces = ref<SxSpace[]>([])
const sxLoading = ref(false)

const spaces = ref<Space[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const error = ref<string | null>(null)
const hasMore = ref(true)
const fromCache = ref(false)

async function loadSpaces(skip: number, forceRefresh = false) {
  if (skip === 0) {
    // Try cache first on initial load
    if (!forceRefresh) {
      const cached = cacheGet<Space[]>(CACHE_KEY)
      if (cached) {
        spaces.value = cached
        hasMore.value = cached.length === PAGE_SIZE
        fromCache.value = true
        return
      }
    }
    loading.value = true
    fromCache.value = false
  } else {
    loadingMore.value = true
  }
  error.value = null
  const token = guard.next()
  try {
    const data = await fetchSpaces(GRAPHQL_ENDPOINT, { first: PAGE_SIZE, skip })
    if (!guard.isCurrent(token)) return
    const newItems = data.spaces
    if (skip === 0) {
      spaces.value = newItems
      cacheSet(CACHE_KEY, newItems)
    } else {
      spaces.value = [...spaces.value, ...newItems]
    }
    hasMore.value = newItems.length === PAGE_SIZE
  } catch (e) {
    if (!guard.isCurrent(token)) return
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (guard.isCurrent(token)) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

function loadMore() {
  void loadSpaces(spaces.value.length)
}

function refresh() {
  cacheDelete(CACHE_KEY)
  void loadSpaces(0, true)
}

/** Best-effort: a failure here must not take down the off-chain Explore list. */
async function loadSxSpaces() {
  sxLoading.value = true
  try {
    sxSpaces.value = await fetchSxSpaces(SX_API_ENDPOINT, { first: 6 })
  } catch {
    sxSpaces.value = []
  } finally {
    sxLoading.value = false
  }
}

function openSxSpace() {
  const address = sxAddress.value.trim()
  if (protocolForSpaceId(address) !== 'snapshot-x') {
    sxError.value = t('openSxInvalid')
    return
  }
  sxError.value = null
  void router.push(`/space/${address}`)
}

onMounted(() => {
  void loadSpaces(0)
  void loadSxSpaces()
})
</script>

<template>
  <main class="page">
    <div class="titleRow">
      <h1 class="title">{{ t('explore') }}</h1>
      <button class="refreshBtn" type="button" :disabled="loading" @click="refresh" :title="t('refresh')">
        ↻
      </button>
    </div>

    <div class="sxRow">
      <input
        v-model="sxAddress"
        class="sxInput"
        type="text"
        spellcheck="false"
        autocomplete="off"
        :placeholder="t('openSxPlaceholder')"
        @keyup.enter="openSxSpace"
      />
      <button class="sxBtn" type="button" @click="openSxSpace">{{ t('openSxButton') }}</button>
    </div>
    <div v-if="sxError" class="sxError">{{ sxError }}</div>

    <section class="card">
      <div class="cardHeader">
        <span class="muted">{{ t('spaces') }}</span>
        <span v-if="fromCache && !loading" class="cacheNote">{{ t('cached') }}</span>
      </div>

      <div v-if="loading" class="placeholder">{{ t('loading') }}</div>
      <div v-else-if="error" class="error">
        {{ error }}
        <button class="retryBtn" type="button" @click="refresh">{{ t('retry') }}</button>
      </div>
      <div v-else-if="spaces.length === 0" class="placeholder">{{ t('empty') }}</div>
      <ul v-else class="list">
        <li v-for="space in spaces" :key="space.id" class="item">
          <div class="row">
            <RouterLink class="name" :to="`/space/${space.id}`">{{ space.name }}</RouterLink>
            <RouterLink class="id" :to="`/space/${space.id}`">{{ space.id }}</RouterLink>
          </div>
          <div v-if="space.about" class="about">{{ space.about }}</div>
        </li>
      </ul>

      <div v-if="!loading && spaces.length > 0 && hasMore" class="more">
        <button class="moreBtn" type="button" :disabled="loadingMore" @click="loadMore">
          {{ loadingMore ? t('loading') : t('loadMore') }}
        </button>
      </div>
    </section>

    <section class="card onchainCard">
      <div class="cardHeader">
        <span class="muted">{{ t('onchainSpaces') }}</span>
      </div>
      <div v-if="sxLoading" class="placeholder">{{ t('loading') }}</div>
      <div v-else-if="sxSpaces.length === 0" class="placeholder">{{ t('empty') }}</div>
      <ul v-else class="list">
        <li v-for="sp in sxSpaces" :key="sp.id" class="item">
          <div class="row">
            <RouterLink class="name" :to="`/space/${sp.id}`">{{ sp.name ?? sp.id }}</RouterLink>
            <span class="id">{{ sxNetworkLabel(sp.network) ?? '' }}</span>
          </div>
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.page {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px;
}

.onchainCard {
  margin-top: 16px;
}

.sxRow {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.sxInput {
  flex: 1;
  border: 1px solid var(--mv-border-md);
  border-radius: 8px;
  padding: 8px 10px;
  background: transparent;
  color: inherit;
  font: inherit;
}

.sxBtn {
  border: 1px solid var(--mv-border-md);
  border-radius: 8px;
  padding: 8px 12px;
  background: var(--mv-surface);
  color: inherit;
  cursor: pointer;
  font-weight: 600;
}

.sxError {
  margin: -4px 0 12px;
  color: var(--mv-error);
  font-size: 13px;
}

.titleRow {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  flex: 1;
}

.refreshBtn {
  border: 1px solid var(--mv-border-md);
  border-radius: 8px;
  padding: 4px 10px;
  background: var(--mv-surface);
  color: inherit;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}

.refreshBtn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.card {
  border: 1px solid var(--mv-border);
  border-radius: 12px;
  padding: 16px;
}

.cardHeader {
  display: flex;
  align-items: center;
  gap: 10px;
}

.muted {
  color: var(--mv-muted);
  font-size: 14px;
}

.cacheNote {
  font-size: 11px;
  color: var(--mv-muted-sm);
  border: 1px solid var(--mv-border-sm);
  border-radius: 4px;
  padding: 1px 6px;
}

.placeholder {
  margin-top: 10px;
  color: var(--mv-muted);
}

.error {
  margin-top: 10px;
  color: var(--mv-error);
  word-break: break-word;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.retryBtn {
  align-self: flex-start;
  border: 1px solid var(--mv-border-md);
  border-radius: 8px;
  padding: 4px 12px;
  background: var(--mv-surface);
  color: inherit;
  cursor: pointer;
  font-size: 13px;
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

.row {
  display: flex;
  gap: 10px;
  align-items: baseline;
  justify-content: space-between;
}

.name {
  font-weight: 700;
  color: inherit;
  text-decoration: none;
}

.id {
  font-size: 12px;
  color: var(--mv-muted-sm);
  text-decoration: none;
}

.about {
  margin-top: 6px;
  font-size: 13px;
  color: var(--mv-muted);
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
