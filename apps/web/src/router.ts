import { createRouter, createWebHistory } from 'vue-router'

import ExplorePage from './pages/ExplorePage.vue'
import ProposalPage from './pages/ProposalPage.vue'
import SpacePage from './pages/SpacePage.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/explore' },
    { path: '/explore', name: 'explore', component: ExplorePage },
    { path: '/space/:id', name: 'space', component: SpacePage, props: true },
    { path: '/proposal/:id', name: 'proposal', component: ProposalPage, props: true }
  ]
})
