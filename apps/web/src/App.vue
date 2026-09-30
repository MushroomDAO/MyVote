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

type AppTheme = 'light' | 'dark'
const THEME_STORAGE_KEY = 'myvote_theme'

function getInitialTheme(): AppTheme {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  }
  return 'light'
}

const theme = ref<AppTheme>(getInitialTheme())

function applyTheme(val: AppTheme) {
  theme.value = val
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', val)
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(THEME_STORAGE_KEY, val)
  }
}

function toggleTheme() {
  applyTheme(theme.value === 'light' ? 'dark' : 'light')
}

onMounted(() => {
  applyTheme(theme.value)
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
          <option value="th">ไทย</option>
        </select>

        <button
          class="themeToggleBtn"
          type="button"
          :title="theme === 'light' ? '切换至深色模式' : '切换至明亮模式'"
          :aria-label="theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'"
          @click="toggleTheme"
        >
          <svg
            v-if="theme === 'light'"
            class="themeIcon"
            viewBox="0 0 24 24"
            width="17"
            height="17"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="5"></circle>
            <line x1="12" y1="1" x2="12" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="23"></line>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
            <line x1="1" y1="12" x2="3" y2="12"></line>
            <line x1="21" y1="12" x2="23" y2="12"></line>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
          </svg>
          <svg
            v-else
            class="themeIcon"
            viewBox="0 0 24 24"
            width="17"
            height="17"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
          </svg>
        </button>

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
  display: flex;
  flex-direction: column;
}

.header {
  position: sticky;
  top: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 14px 24px;
  border-bottom: 1px solid var(--mv-border);
  background: var(--mv-card-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.15);
  transition: all 0.25s ease;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 800;
  font-size: 1.2rem;
  letter-spacing: -0.02em;
  color: var(--mv-text-heading);
}

.brand::before {
  content: '';
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--mv-primary);
  box-shadow: 0 0 10px var(--mv-primary);
}

.logo {
  height: 32px;
  width: auto;
  display: block;
  border-radius: var(--mv-radius-sm);
}

.nav {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.link {
  color: var(--mv-muted);
  text-decoration: none;
  font-weight: 600;
  font-size: 0.92rem;
  padding: 6px 14px;
  border-radius: var(--mv-radius-full);
  border: 1px solid transparent;
  transition: all 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.link:hover {
  color: var(--mv-primary);
  background: var(--mv-surface);
  border-color: var(--mv-card-border);
  transform: translateY(-1px);
}

.link.router-link-active {
  color: var(--mv-primary);
  background: var(--mv-selected-bg);
  border-color: var(--mv-card-border);
  text-decoration: none;
  box-shadow: var(--mv-shadow-sm);
}

.actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.label {
  font-size: 12px;
  font-weight: 600;
  color: var(--mv-muted-sm);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.select,
.input {
  border: 1px solid var(--mv-border-md);
  border-radius: var(--mv-radius);
  padding: 7px 12px;
  background: var(--mv-surface);
  color: var(--mv-text);
  font-size: 0.88rem;
  font-weight: 500;
}

.select:hover,
.input:hover {
  border-color: var(--mv-card-border-hover);
  background: var(--mv-surface-hover);
}

.themeToggleBtn {
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--mv-card-border);
  background: var(--mv-surface);
  color: var(--mv-text);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--mv-shadow-sm);
  transition: all 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
  flex-shrink: 0;
}

.themeToggleBtn:hover {
  border-color: var(--mv-primary);
  color: var(--mv-primary);
  background: var(--mv-surface-hover);
  transform: scale(1.08) rotate(12deg);
  box-shadow: var(--mv-shadow-glow);
}

.themeIcon {
  display: block;
}

.button {
  border: 1px solid var(--mv-card-border);
  border-radius: var(--mv-radius-full);
  padding: 7px 16px;
  background: var(--mv-surface-md);
  color: var(--mv-text-heading);
  cursor: pointer;
  font-weight: 600;
  font-size: 0.88rem;
  box-shadow: var(--mv-shadow-sm);
  transition: all 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.button:hover {
  border-color: var(--mv-primary);
  color: var(--mv-primary);
  background: var(--mv-surface-hover);
  box-shadow: var(--mv-shadow-glow);
  transform: translateY(-1px);
}

.address {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-weight: 600;
  color: var(--mv-primary);
  background: var(--mv-selected-bg);
  border: 1px solid var(--mv-card-border);
  border-radius: var(--mv-radius-full);
  padding: 5px 12px;
}

.address::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--mv-primary);
  box-shadow: 0 0 6px var(--mv-primary);
}

.error {
  max-width: 960px;
  margin: 16px auto 0;
  padding: 12px 18px;
  border-radius: var(--mv-radius);
  border: 1px solid rgba(224, 82, 96, 0.35);
  background: rgba(224, 82, 96, 0.08);
  color: var(--mv-error);
  font-size: 0.9rem;
  font-weight: 500;
}
</style>
