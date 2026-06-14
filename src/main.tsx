import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// @ts-expect-error - virtual module provided by vite-plugin-pwa
import { registerSW } from 'virtual:pwa-register'
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
