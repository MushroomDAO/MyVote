import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  test: {
    // The AirAccount bridge needs localStorage / sessionStorage / location / history.
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
})
