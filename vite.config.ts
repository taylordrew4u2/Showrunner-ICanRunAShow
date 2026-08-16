/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icons/*.png'],
      manifest: {
        name: 'I Can Run A Show',
        short_name: 'Run A Show',
        description: 'Live-show management for comedians, drag promoters, and variety show producers.',
        theme_color: '#0a0a0b',
        background_color: '#0a0a0b',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512x512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // woff2 is here because the typeface is part of the app now rather
        // than a request to Google — without it in the precache, an offline
        // launch would fall back to a system face and every weight, width and
        // line-height in the design would shift.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // ...but not all seven subsets. Precaching every script cost 217KiB on
        // every install to guarantee glyphs almost no one here will render —
        // this is an app for comedy, drag and burlesque producers, and latin
        // plus latin-ext covers the names they book. The other four are still
        // served by this origin and still cached once fetched; they are simply
        // not paid for up front by everybody.
        globIgnores: ['**/fonts/inter-{greek,greek-ext,cyrillic,cyrillic-ext,vietnamese}.woff2'],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
