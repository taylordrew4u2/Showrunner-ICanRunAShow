/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { sharedLinkPage, sharedLinkPageName, type SharedLinkKind } from './src/utils/sharedLink'

/**
 * Emit one page per kind of sent link beside `index.html`: the same app, with
 * head metadata that neither redirects the link to the homepage nor leaves the
 * preview card silent about what was sent. See sharedLinkPage, and the
 * rewrites in vercel.json that route /?sign=, /?profile= and /?view= here.
 */
function sharedLinkPagePlugin(): Plugin {
  const KINDS: SharedLinkKind[] = ['sign', 'profile', 'view']
  return {
    name: 'emit-shared-link-pages',
    enforce: 'post',
    apply: 'build',
    generateBundle(_options, bundle) {
      const index = bundle['index.html']
      if (!index || index.type !== 'asset') return
      for (const kind of KINDS) {
        this.emitFile({
          type: 'asset',
          fileName: sharedLinkPageName(kind),
          source: sharedLinkPage(String(index.source), kind),
        })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [
    react(),
    VitePWA({
      // 'prompt', not 'autoUpdate': an automatic update reloads every open
      // tab the moment it lands, and it lands whenever the download finishes
      // — which on venue wifi is mid-show. The app offers the reload instead.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icons/*.png', 'brand/*.svg'],
      manifest: {
        name: 'I Can Run A Show',
        short_name: 'Run A Show',
        description: 'Live-show management for comedians, drag promoters, and variety show producers.',
        theme_color: '#111827',
        background_color: '#111827',
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
    sharedLinkPagePlugin(),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
