<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { useAuth } from '../auth/useAuth'

/**
 * The one path cos72 is allowed to redirect back to (`/sso/callback`).
 *
 * It exists so cos72's redirect whitelist can name a single exact URL instead of
 * a bare origin. The page itself does nothing but spend the `?code=` and forward
 * the user to wherever they were actually headed (carried in local `returnTo`
 * state, not in the redirect_uri).
 */

const { t } = useI18n()
const router = useRouter()
const auth = useAuth()

const failed = ref(false)
const retrying = ref(false)

onMounted(async () => {
  try {
    const returnTo = await auth.completeSsoLogin()
    // replace(), not push() — the callback URL must not sit in the back stack.
    await router.replace(returnTo)
  } catch {
    // auth.error already holds the reason; let the user act on it.
    failed.value = true
  }
})

async function onRetry() {
  retrying.value = true
  try {
    // Navigates away to cos72.
    await auth.startLogin()
  } finally {
    retrying.value = false
  }
}
</script>

<template>
  <main class="page">
    <div class="card">
      <template v-if="!failed">
        <div class="muted">{{ t('ssoCompleting') }}</div>
      </template>

      <template v-else>
        <div class="title">{{ t('ssoFailed') }}</div>
        <div v-if="auth.error" class="error">{{ auth.error }}</div>
        <button class="button" type="button" :disabled="retrying" @click="onRetry">
          {{ retrying ? t('loading') : t('ssoRetry') }}
        </button>
        <RouterLink class="link" to="/explore">{{ t('explore') }}</RouterLink>
      </template>
    </div>
  </main>
</template>

<style scoped>
.page {
  max-width: 480px;
  margin: 0 auto;
  padding: 48px 24px;
}

.card {
  border: 1px solid var(--mv-border);
  border-radius: 12px;
  padding: 24px;
  display: grid;
  gap: 12px;
  justify-items: start;
}

.title {
  font-weight: 700;
}

.muted {
  color: var(--mv-muted);
  font-size: 14px;
}

.error {
  color: var(--mv-error);
  word-break: break-word;
  font-size: 14px;
}

.button {
  border: 1px solid var(--mv-border-md);
  border-radius: 10px;
  padding: 8px 12px;
  background: var(--mv-surface);
  color: inherit;
  cursor: pointer;
  font-weight: 600;
}

.button:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.link {
  color: var(--mv-muted);
  font-size: 13px;
}
</style>
