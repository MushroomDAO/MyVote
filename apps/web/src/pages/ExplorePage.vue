<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { GRAPHQL_ENDPOINT } from '../config'
import { fetchSpaces, type Space } from '../lib/graphql'

const { t } = useI18n()

const PAGE_SIZE = 30

const spaces = ref<Space[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const error = ref<string | null>(null)
const hasMore = ref(true)

async function loadSpaces(skip: number) {
  if (skip === 0) {
    loading.value = true
  } else {
    loadingMore.value = true
  }
  error.value = null
  try {
    const data = await fetchSpaces(GRAPHQL_ENDPOINT, { first: PAGE_SIZE, skip })
    const newItems = data.spaces
    if (skip === 0) {
      spaces.value = newItems
    } else {
      spaces.value = [...spaces.value, ...newItems]
    }
    hasMore.value = newItems.length === PAGE_SIZE
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function loadMore() {
  void loadSpaces(spaces.value.length)
}

onMounted(() => {
  void loadSpaces(0)
})
</script>

<template>
  <main class="page">
    <h1 class="title">{{ t('explore') }}</h1>
    <section class="card">
      <div class="muted">{{ t('spaces') }}</div>

      <div v-if="loading" class="placeholder">{{ t('loading') }}</div>
      <div v-else-if="error" class="error">{{ error }}</div>
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
  </main>
</template>

<style scoped>
.page {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px;
}

.title {
  margin: 0 0 16px;
  font-size: 20px;
  font-weight: 600;
}

.card {
  border: 1px solid var(--mv-border);
  border-radius: 12px;
  padding: 16px;
}

.muted {
  color: var(--mv-muted);
  font-size: 14px;
}

.placeholder {
  margin-top: 10px;
  color: var(--mv-muted);
}

.error {
  margin-top: 10px;
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
