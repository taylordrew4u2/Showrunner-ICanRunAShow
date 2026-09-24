import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// @ts-expect-error - virtual module provided by vite-plugin-pwa
import { registerSW } from 'virtual:pwa-register'
import './fonts.css'
import './index.css'
import App from './App.tsx'
import './design.css'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { applyColorScheme, loadColorScheme } from './utils/theme'
import { updateReady } from './utils/appUpdate'

// Apply the saved color scheme before the first paint to avoid a flash.
applyColorScheme(loadColorScheme())

// A new version waits until asked for (see utils/appUpdate): taking over on
// its own reloaded the page whenever the download happened to finish, and on
// venue wifi that was mid-show.
const updateServiceWorker = registerSW({
  immediate: true,
  onNeedRefresh() {
    updateReady(() => { void updateServiceWorker(true) })
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// Fade out the static boot splash now that React has painted, so a cold
// launch from the home-screen icon reads as an app opening rather than a
// page loading in.
requestAnimationFrame(() => {
  const splash = document.getElementById('boot-splash')
  if (!splash) return
  splash.classList.add('boot-splash--hidden')
  setTimeout(() => splash.remove(), 250)
})
