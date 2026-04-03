<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { setLocale, type AppLocale } from './i18n'
import { useAuth } from './auth/useAuth'
import { resolvedBranding as branding, tenant } from './tenant'

const { t, locale } = useI18n()
const auth = useAuth()

const selectedLocale = computed({
  get: () => locale.value as AppLocale,
  set: (value: AppLocale) => setLocale(value)
})

const selectedProvider = computed({
  get: () => auth.activeProviderId.value,
  set: (value) => {
    void auth.setProvider(value)
  }
})

const shortAddress = computed(() => {
  const address = auth.user.value?.address
  if (!address) return ''
  return `${address.slice(0, 6)}…${address.slice(-4)}`
})

async function onConnectClick() {
  if (auth.isConnected.value) {
    await auth.disconnect()
    return
  }
  await auth.connect()
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
          <option value="wallet">Wallet</option>
          <option value="airaccount">AirAccount</option>
        </select>

        <label class="label" for="lang">{{ t('language') }}</label>
        <select id="lang" v-model="selectedLocale" class="select">
          <option value="zh-CN">中文</option>
          <option value="en">English</option>
        </select>

        <button class="button" type="button" @click="onConnectClick">
          {{ auth.isConnected ? t('logout') : t('login') }}
        </button>

        <div v-if="auth.isConnected" class="address">{{ shortAddress }}</div>
      </div>
    </header>

    <div v-if="auth.error" class="error">
      {{ auth.error }}
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

.select {
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
