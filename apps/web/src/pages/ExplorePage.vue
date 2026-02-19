<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { GRAPHQL_ENDPOINT } from '../config'
import { fetchSpaces, type Space } from '../lib/graphql'

const { t } = useI18n()

const spaces = ref<Space[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

async function loadSpaces() {
  loading.value = true
  error.value = null
  try {
    const data = await fetchSpaces(GRAPHQL_ENDPOINT, { first: 30, skip: 0 })
    spaces.value = data.spaces
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    spaces.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadSpaces()
})
</script>

<template>
  <main class="page">
    <h1 class="title">{{ t('explore') }}</h1>
    <section class="card">
      <div class="muted">{{ t('spaces') }}</div>

      <div class="meta">{{ GRAPHQL_ENDPOINT }}</div>

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
  border: 1px solid rgba(60, 60, 60, 0.15);
  border-radius: 12px;
  padding: 16px;
}

.muted {
  color: rgba(60, 60, 60, 0.7);
  font-size: 14px;
}

.meta {
  margin-top: 6px;
  font-size: 12px;
  color: rgba(60, 60, 60, 0.6);
  word-break: break-all;
}

.placeholder {
  margin-top: 10px;
  color: rgba(60, 60, 60, 0.7);
}

.error {
  margin-top: 10px;
  color: #b00020;
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
  border: 1px solid rgba(60, 60, 60, 0.12);
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
  color: rgba(60, 60, 60, 0.6);
  text-decoration: none;
}

.about {
  margin-top: 6px;
  font-size: 13px;
  color: rgba(60, 60, 60, 0.75);
}
</style>
