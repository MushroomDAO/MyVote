import { createRouter, createWebHistory } from 'vue-router'

import { SSO_CALLBACK_PATH } from './config'
import ExplorePage from './pages/ExplorePage.vue'
import ProposalPage from './pages/ProposalPage.vue'
import RegisterPage from './pages/RegisterPage.vue'
import SsoCallbackPage from './pages/SsoCallbackPage.vue'
import SpacePage from './pages/SpacePage.vue'
import { tenant } from './tenant'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/explore' },
    { path: '/explore', name: 'explore', component: ExplorePage },
    { path: '/space/:id', name: 'space', component: SpacePage, props: true },
    { path: '/proposal/:id', name: 'proposal', component: ProposalPage, props: true },
    { path: '/register', name: 'register', component: RegisterPage },
    // The single URL cos72 may redirect back to — see config.ts SSO_CALLBACK_PATH.
    { path: SSO_CALLBACK_PATH, name: 'sso-callback', component: SsoCallbackPage }
  ]
})

// In single-space mode (tenant.spaceId set), redirect / and /explore to the tenant's space.
if (tenant.spaceId) {
  router.beforeEach((to) => {
    // Never swallow the SSO callback — it must run to spend the code.
    if (to.path === SSO_CALLBACK_PATH) return true
    if (to.path === '/' || to.path === '/explore') {
      return { path: `/space/${tenant.spaceId}` }
    }
  })
}
