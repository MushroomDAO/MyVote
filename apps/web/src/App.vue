<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { setLocale, type AppLocale } from './i18n'
import { useAuth } from './auth/useAuth'
import { errorKey } from './lib/errors'
import { resolvedBranding as branding, tenant } from './tenant'

const { t, locale } = useI18n()

// Destructure to top-level bindings: <script setup> only auto-unwraps refs that
// are top-level, so `auth.error` / `auth.isConnected` in the template would be
// Ref objects (always truthy) rather than their values.
const {
  activeProviderId,
  isConnected,
  error,
  errorCode,
  user,
  // MV-4: in SSO-only mode — or once a cos72 session exists — the wallet
  // provider is not an option, and AirAccount is the only dropdown entry.
  walletDisabled,
  setProvider,
  connect,
  disconnect,
  restoreSession
} = useAuth()

const emailInput = ref('')
// Email sign-in is the interim M4 substitute and needs the address typed in.
const needsEmail = computed(() => activeProviderId.value === 'email' && !isConnected.value)

/** Localized message when the failure carries a code; raw text otherwise. */
const errorText = computed(() => {
  const key = errorCode.value ? errorKey(errorCode.value) : undefined
  return key ? t(key) : (error.value ?? '')
})

onMounted(() => {
  // Consumes a `?code=` from cos72, or revalidates a stored token. Silent by design.
  void restoreSession()
})

const selectedLocale = computed({
  get: () => locale.value as AppLocale,
  set: (value: AppLocale) => setLocale(value)
})

const selectedProvider = computed({
  get: () => activeProviderId.value,
  set: (value) => {
    void setProvider(value)
  }
})

const accountLabel = computed(() => {
  const address = user.value?.address
  if (address) return `${address.slice(0, 6)}…${address.slice(-4)}`
  return user.value?.displayName ?? ''
})

async function onConnectClick() {
  if (isConnected.value) {
    await disconnect()
    return
  }
  await connect(needsEmail.value ? { email: emailInput.value } : undefined)
}
</script>

<template>
  <div class="app">
    <header class="header">
      <div class="brand">
        <img v-if="branding.logo" :src="branding.logo" :alt="branding.name" class="logo" />
        <span v-else>{{ t('appTitle') }}</span>
      </div>

      <nav class="nav">
        <RouterLink class="link" to="/explore">{{ t('explore') }}</RouterLink>
        <!-- Register link: hidden in single-space (tenant) mode -->
        <RouterLink v-if="!tenant.spaceId" class="link" to="/register">{{ t('register') }}</RouterLink>
      </nav>

      <div class="actions">
        <label class="label" for="provider">{{ t('loginProvider') }}</label>
        <select id="provider" v-model="selectedProvider" class="select">
          <option v-if="!walletDisabled" value="wallet">Wallet</option>
          <option value="airaccount">AirAccount</option>
          <option value="email">{{ t('emailLogin') }}</option>
        </select>

        <label class="label" for="lang">{{ t('language') }}</label>
        <select id="lang" v-model="selectedLocale" class="select">
          <option value="zh-CN">中文</option>
          <option value="en">English</option>
        </select>

        <input
          v-if="needsEmail"
          v-model="emailInput"
          class="input"
          type="email"
          autocomplete="email"
          :placeholder="t('emailPlaceholder')"
        />

        <button class="button" type="button" @click="onConnectClick">
          {{ isConnected ? t('logout') : t('login') }}
        </button>

        <div v-if="isConnected" class="address">{{ accountLabel }}</div>
      </div>
    </header>

    <div v-if="error" class="error">
      {{ errorText }}
    </div>

    <RouterView />
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
}

.header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--mv-border);
}

.brand {
  font-weight: 700;
}

.logo {
  height: 28px;
  width: auto;
  display: block;
}

.nav {
  display: flex;
  gap: 12px;
  flex: 1;
}

.link {
  color: inherit;
  text-decoration: none;
  font-weight: 600;
}

.link.router-link-active {
  text-decoration: underline;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.label {
  font-size: 12px;
  color: var(--mv-muted);
}

.select,
.input {
  border: 1px solid var(--mv-border-md);
  border-radius: 8px;
  padding: 6px 8px;
  background: transparent;
  color: inherit;
}

.button {
  border: 1px solid var(--mv-border-md);
  border-radius: 10px;
  padding: 6px 10px;
  background: var(--mv-surface);
  color: inherit;
  cursor: pointer;
  font-weight: 600;
}

.address {
  font-size: 12px;
  color: var(--mv-muted);
}

.error {
  padding: 10px 16px;
  border-bottom: 1px solid var(--mv-border);
  color: var(--mv-error);
}
</style>
