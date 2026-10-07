<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { GRAPHQL_ENDPOINT, SX_API_ENDPOINT } from '../config'
import { fetchSpaces, formatSpaceNetwork, type Space } from '../lib/graphql'
import { cacheGet, cacheSet, cacheDelete, scopedCacheKey } from '../lib/cache'
import { currentNetworkId, getCurrentNetwork, matchesNetwork } from '../lib/networks'
import { takePage } from '../lib/pageCursor'
import { createRequestGuard } from '../lib/requestGuard'
import { fetchSxSpaces, type SxSpace } from '../lib/sx/api'
import { sxNetworkLabel } from '../lib/sx/backend'
import { protocolForSpaceId } from '../lib/voteRouting'

const { t } = useI18n()
const router = useRouter()

const PAGE_SIZE = 30
/** The on-chain preview list is shorter, so it pages in smaller steps. */
const SX_PAGE_SIZE = 6

function getGraphqlEndpoint(): string {
  const current = getCurrentNetwork()
  if (current.id === 'sepolia') return GRAPHQL_ENDPOINT
  return current.graphqlEndpoint
}

function getSxEndpoint(): string {
  const current = getCurrentNetwork()
  if (current.id === 'sepolia') return SX_API_ENDPOINT
  return current.sxApiEndpoint
}

function getCacheKey(): string {
  return scopedCacheKey('explore:spaces', undefined, currentNetworkId.value)
}

function getSxCacheKey(): string {
  return scopedCacheKey('explore:sx-spaces', undefined, currentNetworkId.value)
}

const guard = createRequestGuard()
// The on-chain list loads in parallel and must not be cancelled by a paginated
// off-chain load, so it gets its own guard.
const sxGuard = createRequestGuard()

// Snapshot X spaces are contracts, not ENS names, so they are not in the Hub
// listing above. Let users open one directly by address.
const sxAddress = ref('')
const sxError = ref<string | null>(null)

// Recently created on-chain spaces — the Hub listing only has ENS spaces.
const sxSpaces = ref<SxSpace[]>([])
const sxLoading = ref(false)
const sxLoadingMore = ref(false)
const sxHasMore = ref(false)
/** True when the last on-chain list read failed (it is best-effort). */
const sxFailed = ref(false)
/** True when the on-chain list came from the 5-minute cache. */
const sxCached = ref(false)

const spaces = ref<Space[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const error = ref<string | null>(null)
const hasMore = ref(true)
const fromCache = ref(false)

const filteredSpaces = computed(() => {
  const netId = currentNetworkId.value
  return spaces.value.filter((sp) => {
    if (!sp.network) return true
    if (netId === 'sepolia') {
      return sp.network === '11155111' || sp.network.toLowerCase() === 'sepolia'
    }
    return matchesNetwork(sp.network, netId)
  })
})

const filteredSxSpaces = computed(() => {
  const netId = currentNetworkId.value
  return sxSpaces.value.filter((sp) => {
    if (!sp.network) return true
    if (netId === 'sepolia') {
      return sp.network === 'sepolia' || sp.network === 'optimism'
    }
    return matchesNetwork(sp.network, netId)
  })
})

async function loadSpaces(skip: number, forceRefresh = false) {
  const key = getCacheKey()
  if (skip === 0) {
    // Try cache first on initial load
    if (!forceRefresh) {
      const cached = cacheGet<Space[]>(key)
      if (cached) {
        // The cache holds the raw lookahead page, so the flag stays exact.
        const { page, hasMore: more } = takePage(cached, PAGE_SIZE)
        spaces.value = page
        hasMore.value = more
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
  const signal = guard.signal
  try {
    // When filtering by specific mainnet chain, fetch up to 100 to ensure sufficient matching candidates
    const fetchLimit = currentNetworkId.value === 'sepolia' ? PAGE_SIZE + 1 : 100
    const data = await fetchSpaces(getGraphqlEndpoint(), { first: fetchLimit, skip, signal })
    if (!guard.isCurrent(token)) return
    const { page, hasMore: more } = takePage(data.spaces, PAGE_SIZE)
    if (skip === 0) {
      spaces.value = page
      cacheSet(key, data.spaces)
    } else {
      spaces.value = [...spaces.value, ...page]
    }
    hasMore.value = more
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
  cacheDelete(getCacheKey())
  cacheDelete(getSxCacheKey())
  // Clean legacy keys for tests that test direct unnamespaced keys
  cacheDelete('explore:spaces')
  cacheDelete('explore:sx-spaces')
  void loadSpaces(0, true)
  // The on-chain card has no refresh of its own; refresh it with this button.
  void loadSxSpaces(0, true)
}

/** Best-effort: a failure here must not take down the off-chain Explore list. */
async function loadSxSpaces(skip = 0, force = false) {
  const key = getSxCacheKey()
  if (skip === 0) {
    if (!force) {
      const cached = cacheGet<SxSpace[]>(key)
      if (cached) {
        // The cache holds the raw lookahead page, so the flag stays exact.
        const { page, hasMore: more } = takePage(cached, SX_PAGE_SIZE)
        sxSpaces.value = page
        sxHasMore.value = more
        sxFailed.value = false
        sxCached.value = true
        return
      }
    }
    sxCached.value = false
    sxLoading.value = true
  } else {
    sxLoadingMore.value = true
  }
  sxFailed.value = false
  const token = sxGuard.next()
  try {
    // The lookahead row makes hasMore exact (see lib/pageCursor.ts).
    const raw = await fetchSxSpaces(getSxEndpoint(), {
      first: SX_PAGE_SIZE + 1,
      skip,
      signal: sxGuard.signal
    })
    if (!sxGuard.isCurrent(token)) return
    const { page, hasMore: more } = takePage(raw, SX_PAGE_SIZE)
    sxSpaces.value = skip === 0 ? page : [...sxSpaces.value, ...page]
    sxHasMore.value = more
    if (skip === 0) cacheSet(key, raw)
  } catch {
    if (sxGuard.isCurrent(token)) {
      if (skip === 0) sxSpaces.value = []
      sxFailed.value = true
      sxHasMore.value = false
    }
  } finally {
    if (sxGuard.isCurrent(token)) {
      sxLoading.value = false
      sxLoadingMore.value = false
    }
  }
}

function loadMoreSxSpaces() {
  void loadSxSpaces(sxSpaces.value.length)
}

watch(currentNetworkId, () => {
  refresh()
})

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

// Stop in-flight reads on navigation; the tokens flip stale so their catch
// blocks do not render an AbortError on a dead component.
onUnmounted(() => {
  guard.abort()
  sxGuard.abort()
})
</script>

<template>
  <main class="page">
    <div class="titleRow">
      <div>
        <h1 class="title">{{ t('explore') }}</h1>
        <p class="subtitle">{{ t('exploreSubtitle') }}</p>
      </div>
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
      <div v-else-if="filteredSpaces.length === 0" class="placeholder">{{ t('emptyFiltered') }}</div>
      <ul v-else class="list">
        <li v-for="space in filteredSpaces" :key="space.id" class="item">
          <div class="row">
            <div class="nameRow">
              <RouterLink class="name" :to="`/space/${space.id}`">{{ space.name }}</RouterLink>
              <span v-if="formatSpaceNetwork(space.network)" class="networkBadge">{{ formatSpaceNetwork(space.network) }}</span>
            </div>
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
        <span v-if="sxCached && !sxLoading" class="cacheNote">{{ t('cached') }}</span>
      </div>
      <div v-if="sxLoading" class="placeholder">{{ t('loading') }}</div>
      <div v-else-if="sxFailed" class="error">
        {{ t('error') }}
        <button class="retryBtn" type="button" @click="loadSxSpaces(0, true)">{{ t('retry') }}</button>
      </div>
      <div v-else-if="filteredSxSpaces.length === 0" class="placeholder">{{ t('emptyFiltered') }}</div>
      <ul v-else class="list">
        <li v-for="sp in filteredSxSpaces" :key="sp.id" class="item">
          <div class="row">
            <div class="nameRow">
              <RouterLink class="name" :to="`/space/${sp.id}`">{{ sp.name ?? sp.id }}</RouterLink>
              <span v-if="sxNetworkLabel(sp.network)" class="networkBadge sxBadge">{{ sxNetworkLabel(sp.network) }}</span>
            </div>
            <span class="id">{{ sp.id }}</span>
          </div>
          <div v-if="sp.about" class="about">{{ sp.about }}</div>
        </li>
      </ul>

      <div v-if="sxSpaces.length > 0 && sxHasMore" class="more">
        <button class="moreBtn" type="button" :disabled="sxLoadingMore" @click="loadMoreSxSpaces">
          {{ sxLoadingMore ? t('loading') : t('loadMore') }}
        </button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.page {
  max-width: 960px;
  margin: 0 auto;
  padding: 36px 20px 64px;
}

.titleRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}

.title {
  margin: 0;
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--mv-text-heading);
  background: linear-gradient(135deg, var(--mv-text-heading) 40%, var(--mv-primary));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.subtitle {
  margin: 6px 0 0;
  font-size: 14px;
  color: var(--mv-text-muted);
}

.refreshBtn {
  border: 1px solid var(--mv-card-border);
  border-radius: var(--mv-radius-full);
  width: 38px;
  height: 38px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--mv-surface);
  color: var(--mv-text);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  transition: all 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
  box-shadow: var(--mv-shadow-sm);
}

.refreshBtn:hover:not(:disabled) {
  border-color: var(--mv-primary);
  color: var(--mv-primary);
  background: var(--mv-surface-hover);
  transform: rotate(180deg) scale(1.05);
}

.refreshBtn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.sxRow {
  display: flex;
  gap: 10px;
  margin-bottom: 24px;
  background: var(--mv-surface);
  border: 1px solid var(--mv-card-border);
  border-radius: var(--mv-radius-lg);
  padding: 6px;
  box-shadow: var(--mv-shadow-sm);
  transition: all 0.2s ease;
}

.sxRow:focus-within {
  border-color: var(--mv-primary);
  box-shadow: 0 0 0 3px var(--mv-selected-bg), var(--mv-shadow-sm);
}

.sxInput {
  flex: 1;
  border: none !important;
  outline: none !important;
  box-shadow: none !important;
  background: transparent;
  padding: 8px 14px;
  color: var(--mv-text);
  font: inherit;
  font-size: 0.95rem;
}

.sxInput::placeholder {
  color: var(--mv-muted-sm);
}

.sxBtn {
  border: 1px solid var(--mv-card-border);
  border-radius: var(--mv-radius);
  padding: 8px 18px;
  background: var(--mv-surface-md);
  color: var(--mv-text-heading);
  cursor: pointer;
  font-weight: 600;
  font-size: 0.9rem;
  transition: all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.sxBtn:hover {
  border-color: var(--mv-primary);
  color: var(--mv-primary);
  background: var(--mv-surface-hover);
  box-shadow: var(--mv-shadow-glow);
}

.sxError {
  margin: -14px 0 20px 8px;
  color: var(--mv-error);
  font-size: 13px;
  font-weight: 500;
}

.card {
  border: 1px solid var(--mv-card-border);
  border-radius: var(--mv-radius-lg);
  padding: 24px;
  background: var(--mv-card-bg);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: var(--mv-shadow-md);
  margin-bottom: 24px;
  transition: border-color 0.2s ease;
}

.onchainCard {
  border-color: rgba(245, 158, 11, 0.2);
}

.cardHeader {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--mv-border);
}

.muted {
  color: var(--mv-muted);
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.cacheNote {
  font-size: 11px;
  font-weight: 600;
  color: var(--mv-primary);
  background: var(--mv-selected-bg);
  border: 1px solid var(--mv-card-border);
  border-radius: var(--mv-radius-full);
  padding: 2px 8px;
}

.placeholder {
  padding: 32px 0;
  text-align: center;
  color: var(--mv-muted);
  font-size: 0.95rem;
}

.error {
  padding: 20px 0;
  color: var(--mv-error);
  word-break: break-word;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  font-size: 0.95rem;
}

.retryBtn {
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
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.item {
  border: 1px solid var(--mv-border);
  border-radius: var(--mv-radius);
  padding: 18px;
  background: var(--mv-surface);
  transition: all 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.item:hover {
  border-color: var(--mv-card-border-hover);
  background: var(--mv-surface-hover);
  transform: translateY(-2px);
  box-shadow: var(--mv-shadow-md), var(--mv-shadow-glow);
}

.row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nameRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.name {
  font-weight: 700;
  font-size: 1.05rem;
  color: var(--mv-text-heading);
  text-decoration: none;
  transition: color 0.2s ease;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.networkBadge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: var(--mv-radius-full);
  background: var(--mv-chip-bg);
  border: 1px solid var(--mv-chip-border);
  color: var(--mv-chip-text);
  white-space: nowrap;
  flex-shrink: 0;
}

.sxBadge {
  background: var(--mv-selected-bg);
  border-color: var(--mv-selected-border);
  color: var(--mv-primary);
}

.item:hover .name {
  color: var(--mv-primary);
}

.id {
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: var(--mv-muted-sm);
  text-decoration: none;
  display: inline-block;
}

.about {
  margin-top: 10px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--mv-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
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
