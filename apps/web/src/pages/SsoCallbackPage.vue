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
// Destructured to top-level bindings so the template auto-unwraps the refs:
// `auth.error` in a `v-if` would test the Ref object itself (always truthy).
const { error, completeSsoLogin, startLogin } = useAuth()

const failed = ref(false)
const retrying = ref(false)

onMounted(async () => {
  try {
    const returnTo = await completeSsoLogin()
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
    await startLogin()
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
        <div v-if="error" class="error">{{ error }}</div>
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
  padding: 64px 20px;
}

.card {
  border: 1px solid var(--mv-card-border);
  border-radius: var(--mv-radius-lg);
  padding: 32px 28px;
  background: var(--mv-card-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: var(--mv-shadow-md);
  display: grid;
  gap: 16px;
  justify-items: start;
}

.title {
  font-weight: 800;
  font-size: 20px;
  letter-spacing: -0.01em;
  color: var(--mv-text-heading);
}

.muted {
  color: var(--mv-muted);
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.muted::before {
  content: '';
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--mv-primary);
  box-shadow: 0 0 10px var(--mv-primary);
  animation: pulse 1.8s infinite ease-in-out;
}

@keyframes pulse {
  0%, 100% {
    transform: scale(0.9);
    opacity: 0.5;
  }
  50% {
    transform: scale(1.3);
    opacity: 1;
  }
}

.error {
  color: var(--mv-error);
  word-break: break-word;
  font-size: 14px;
  padding: 10px 14px;
  border-radius: var(--mv-radius);
  background: rgba(224, 82, 96, 0.1);
  border: 1px solid rgba(224, 82, 96, 0.3);
}

.button {
  border: 1px solid var(--mv-primary);
  border-radius: var(--mv-radius-full);
  padding: 10px 20px;
  background: linear-gradient(135deg, var(--mv-primary), var(--mv-primary-hover));
  color: #ffffff;
  cursor: pointer;
  font-weight: 700;
  font-size: 14px;
  box-shadow: var(--mv-shadow-glow), var(--mv-shadow-sm);
  transition: all 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 0 20px var(--mv-primary);
}

.button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
  box-shadow: none;
}

.link {
  color: var(--mv-muted);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  transition: color 0.2s ease;
}

.link:hover {
  color: var(--mv-primary);
}
</style>
