import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  test: {
    // The AirAccount bridge needs localStorage / sessionStorage / location / history.
    environment: 'happy-dom',
    // Include the edge Functions too — they are plain TS and run under Node.
    include: ['src/**/*.test.ts', 'functions/**/*.test.ts'],
  },
})
