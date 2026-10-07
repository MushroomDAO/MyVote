<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { setLocale, type AppLocale } from './i18n'
import { currentNetworkId, setNetwork, NETWORK_OPTIONS, type NetworkId } from './lib/networks'
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

const selectedNetwork = computed({
  get: () => currentNetworkId.value,
  set: (value: NetworkId) => setNetwork(value)
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

        <label class="label" for="network">{{ t('network') }}</label>
        <select id="network" v-model="selectedNetwork" class="select networkSelect">
          <option v-for="net in NETWORK_OPTIONS" :key="net.id" :value="net.id">
            {{ net.name }} {{ net.isTestnet ? `(${t('testnet')})` : '' }}
          </option>
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

    <footer class="footer">
      <div class="footerContent">
        <span class="footerTagline">{{ t('footerTagline') }}</span>
        <span class="footerDivider">·</span>
        <a href="https://aastar.io" target="_blank" rel="noopener noreferrer" class="poweredBy">
          <span class="poweredByLabel">Powered by</span>
          <img src="/aastar-logo.png" alt="AAStar" class="aastarLogo" />
          <span class="aastarText">AAStar</span>
        </a>
        <span class="footerDivider">·</span>
        <a
          href="https://github.com/MushroomDAO/MyVote"
          target="_blank"
          rel="noopener noreferrer"
          class="githubLink"
          title="GitHub Repository"
          aria-label="GitHub Repository"
        >
          <svg class="githubIcon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path
              d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
            />
          </svg>
          <span class="githubText">GitHub</span>
        </a>
        <span class="footerDivider">·</span>
        <a
          href="https://www.apache.org/licenses/LICENSE-2.0"
          target="_blank"
          rel="noopener noreferrer"
          class="licenseLink"
          title="Apache License 2.0"
          aria-label="Apache License 2.0"
        >
          <svg class="licenseIcon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path
              d="M17.805 2.197v.066h.156v.44h.072v-.44h.156v-.066zm.9 0l-.175.353-.172-.353h-.087v.506h.067V2.3l.172.35h.045l.172-.35v.404h.066v-.506zm-4.257 1c-.204.31-.424.66-.66 1.06l-.04.062a44.457 44.457 0 00-1.265 2.29c-.187.36-.38.742-.577 1.146l2.267-.25c.66-.302.955-.578 1.242-.976a15.5 15.5 0 00.23-.342c.23-.363.46-.763.663-1.16.197-.386.37-.767.505-1.11.083-.22.15-.422.198-.6.042-.158.074-.307.1-.45-.884.15-1.965.295-2.668.33zM11.894 7.78l-.077.16c-.078.16-.157.32-.236.488-.086.18-.172.364-.26.552l-.132.287a75.265 75.265 0 00-1.427 3.3c-.163.397-.327.807-.493 1.23-.15.38-.297.765-.45 1.164l-.02.06c-.15.396-.3.802-.453 1.22l-.01.027.72-.08a.213.213 0 01-.042-.006c.863-.106 2.01-.75 2.75-1.547.342-.367.652-.8.94-1.306.213-.377.413-.795.604-1.258.168-.405.328-.843.48-1.318-.196.105-.423.18-.673.235a2.184 2.184 0 01-.273.046c.806-.31 1.314-.905 1.683-1.64a2.816 2.816 0 01-.968.428c-.06.012-.116.022-.174.03l-.043.006h.002c.278-.118.514-.248.718-.403a2.571 2.571 0 00.637-.698l.063-.104.077-.154a8.107 8.107 0 00.367-.85l.03-.088a3.04 3.04 0 00.123-.463.733.733 0 01-.094.065c-.243.145-.66.277-.996.34l.663-.074-.664.073h-.017l-.1.017c.006-.003.01-.006.017-.008l-2.265.25-.013.022zM8.27 16.45c-.117.323-.236.654-.355.992l-.005.015c-.016.046-.032.094-.05.142-.08.227-.15.432-.31.9.264.12.475.435.675.793a1.44 1.44 0 00-.466-.99c1.293.06 2.41-.27 2.99-1.217.05-.084.096-.173.14-.268-.26.333-.59.474-1.2.44 0 0-.004 0-.005.002l.004-.002c.9-.404 1.354-.79 1.754-1.433.094-.153.186-.32.28-.503-.788.81-1.702 1.04-2.664.865l-.72.078a6.43 6.43 0 00-.067.183zM15.42.112c-.376.222-1 .85-1.748 1.763l.686 1.294c.48-.687.97-1.307 1.462-1.836l.058-.062c-.02.02-.04.04-.057.062-.16.176-.644.74-1.375 1.863.703-.035 1.784-.18 2.666-.33.262-1.47-.258-2.142-.258-2.142s-.66-1.07-1.436-.61zm-3.084 6.402a40.253 40.253 0 011.306-2.26l.04-.064c.224-.352.45-.693.677-1.02l-.685-1.293-.157.192c-.197.245-.403.51-.613.79a39.853 39.853 0 00-2.016 2.97l-.022.038.893 1.763c.19-.378.38-.752.575-1.118zm-3.73 8.32c.158-.406.319-.81.483-1.225.156-.394.32-.79.484-1.19a91.133 91.133 0 011.6-3.604l.205-.424c.12-.243.237-.485.36-.724a.125.125 0 01.02-.04l-.895-1.763-.044.07c-.207.34-.414.687-.617 1.042a38.056 38.056 0 00-1.092 2.04l-.094.193a24.573 24.573 0 00-1.258 3.087 18.492 18.492 0 00-.52 1.997l.896 1.77c.117-.317.24-.638.364-.963zm-1.376-.476a13.38 13.38 0 00-.234 1.692c0 .02-.004.04-.005.06-.28-.45-1.03-.888-1.026-.884.537.778.944 1.55 1.005 2.31-.29.058-.684-.027-1.14-.195.475.436.83.556.97.588-.434.03-.89.328-1.346.67.668-.27 1.21-.38 1.596-.29-.61 1.74-1.23 3.655-1.843 5.69a.538.538 0 00.364-.354c.11-.368.84-2.786 1.978-5.965l.097-.27.028-.078c.12-.332.246-.672.374-1.02l.09-.237v-.004L7.24 14.3c-.003.02-.01.04-.012.06z"
            />
          </svg>
          <span class="licenseText">Apache 2.0</span>
        </a>
      </div>
    </footer>
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

.footer {
  margin-top: auto;
  border-top: 1px solid var(--mv-border);
  padding: 24px 20px;
  background: var(--mv-surface-card);
}

.footerContent {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--mv-text-muted);
}

.footerTagline {
  color: var(--mv-text-muted);
}

.footerDivider {
  color: var(--mv-card-border);
  font-weight: 600;
}

.poweredBy {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  text-decoration: none;
  color: var(--mv-text);
  font-weight: 600;
  transition: color 0.2s ease, opacity 0.2s ease;
}

.poweredBy:hover {
  color: var(--mv-primary);
}

.poweredByLabel {
  color: var(--mv-text-muted);
  font-weight: 400;
}

.aastarLogo {
  width: 16px;
  height: 16px;
  object-fit: contain;
  vertical-align: middle;
}

.aastarText {
  letter-spacing: -0.01em;
}

.githubLink {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  text-decoration: none;
  color: var(--mv-text);
  font-weight: 600;
  transition: color 0.2s ease, opacity 0.2s ease;
}

.githubLink:hover {
  color: var(--mv-primary);
}

.githubIcon {
  width: 16px;
  height: 16px;
  fill: currentColor;
  vertical-align: middle;
}

.githubText {
  letter-spacing: -0.01em;
}

.licenseLink {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  text-decoration: none;
  color: var(--mv-text);
  font-weight: 600;
  transition: color 0.2s ease, opacity 0.2s ease;
}

.licenseLink:hover {
  color: var(--mv-primary);
}

.licenseIcon {
  width: 16px;
  height: 16px;
  fill: currentColor;
  vertical-align: middle;
}

.licenseText {
  letter-spacing: -0.01em;
}
</style>
