<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import { GRAPHQL_ENDPOINT } from '../config'
import { graphqlRequest } from '../lib/graphql'

const { t, locale } = useI18n()
const route = useRoute()

const spaceId = computed(() => String(route.params.id ?? ''))

type Space = {
  id: string
  name: string
  about?: string
  network?: string
  symbol?: string
}

type Proposal = {
  id: string
  title: string
  created: number
  state: string
}

const space = ref<Space | null>(null)
const proposals = ref<Proposal[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

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

async function loadSpace() {
  if (!spaceId.value) return
  loading.value = true
  error.value = null
  try {
    const data = await graphqlRequest<{
      space: Space | null
      proposals: Proposal[]
    }>(
      GRAPHQL_ENDPOINT,
      `
        query SpacePage($spaceId: String!, $first: Int!, $skip: Int!) {
          space(id: $spaceId) {
            id
            name
            about
            network
            symbol
          }
          proposals(
            first: $first
            skip: $skip
            where: { space_in: [$spaceId] }
            orderBy: "created"
            orderDirection: desc
          ) {
            id
            title
            created
            state
          }
        }
      `,
      { spaceId: spaceId.value, first: 20, skip: 0 }
    )

    space.value = data.space
    proposals.value = data.proposals
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    space.value = null
    proposals.value = []
  } finally {
    loading.value = false
  }
}

watch(spaceId, () => {
  void loadSpace()
})

onMounted(() => {
  void loadSpace()
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

      <div v-if="space.about" class="about">{{ space.about }}</div>

      <div class="sectionTitle">{{ t('proposals') }}</div>
      <div v-if="proposals.length === 0" class="muted">{{ t('empty') }}</div>
      <ul v-else class="list">
        <li v-for="p in proposals" :key="p.id" class="item">
          <RouterLink class="proposalTitle" :to="`/proposal/${p.id}`">
            {{ p.title }}
          </RouterLink>
          <div class="meta">
            <span>{{ t('state') }}: {{ p.state }}</span>
            <span>·</span>
            <span>{{ formatTs(p.created) }}</span>
          </div>
        </li>
      </ul>
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
  border: 1px solid rgba(60, 60, 60, 0.15);
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
  color: rgba(60, 60, 60, 0.6);
}

.about {
  margin-top: 8px;
  color: rgba(60, 60, 60, 0.75);
  font-size: 14px;
}

.sectionTitle {
  margin-top: 16px;
  font-weight: 700;
}

.muted {
  margin-top: 10px;
  color: rgba(60, 60, 60, 0.7);
  font-size: 14px;
}

.error {
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

.proposalTitle {
  color: inherit;
  text-decoration: none;
  font-weight: 700;
}

.meta {
  margin-top: 6px;
  font-size: 12px;
  color: rgba(60, 60, 60, 0.6);
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
