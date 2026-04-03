import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { i18n } from './i18n'
import { router } from './router'
import { resolvedBranding } from './tenant'

// Apply brand colors (tenant overrides merged with defaults) as CSS custom properties
const root = document.documentElement
root.style.setProperty('--mv-primary', resolvedBranding.colors.primary)
root.style.setProperty('--mv-primary-hover', resolvedBranding.colors.primaryHover)
root.style.setProperty('--mv-error', resolvedBranding.colors.error)
root.style.setProperty('--mv-selected-bg', resolvedBranding.colors.selectedBg)

// Set document title from resolved branding
document.title = resolvedBranding.name

createApp(App).use(router).use(i18n).mount('#app')
