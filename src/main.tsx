import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// @ts-expect-error - virtual module provided by vite-plugin-pwa
import { registerSW } from 'virtual:pwa-register'
import './fonts.css'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { applyColorScheme, loadColorScheme } from './utils/theme'

// Apply the saved color scheme before the first paint to avoid a flash.
applyColorScheme(loadColorScheme())

registerSW({ immediate: true })

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
