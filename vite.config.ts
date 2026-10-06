import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['tests/**/*.test.ts','shared/**/*.test.ts'] }, build: { outDir: 'dist', sourcemap: false, rollupOptions: { output: { manualChunks: { identity:['@azure/msal-browser'] } } } }, server: { host: '127.0.0.1' } })
