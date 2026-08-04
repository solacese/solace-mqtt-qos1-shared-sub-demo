import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  // solclientjs ships a CommonJS browser bundle (its `browser` field points at
  // lib-browser/solclient.js), so it has to be pre-bundled to be importable as ESM.
  optimizeDeps: {
    include: ['solclientjs', 'mqtt'],
  },
  // Some of the solclientjs bundle's UMD preamble references the Node `global`.
  define: {
    global: 'globalThis',
  },
})
