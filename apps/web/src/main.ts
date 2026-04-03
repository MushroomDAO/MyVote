import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { i18n } from './i18n'
import { router } from './router'
import { branding } from './branding'

// Apply brand colors as CSS custom properties
const root = document.documentElement
root.style.setProperty('--mv-primary', branding.colors.primary)
root.style.setProperty('--mv-primary-hover', branding.colors.primaryHover)
root.style.setProperty('--mv-error', branding.colors.error)
root.style.setProperty('--mv-selected-bg', branding.colors.selectedBg)

// Set document title from branding
document.title = branding.name

createApp(App).use(router).use(i18n).mount('#app')
