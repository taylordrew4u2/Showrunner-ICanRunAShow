import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './fonts.css'
import './index.css'
import App from './App.tsx'
import './design.css'
import './utility.css'
import './polish.css'
import './luxe.css'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { applyColorScheme, loadColorScheme } from './utils/theme'
import { registerAppUpdates } from './utils/appUpdate'
import { sharedLinkRoute } from './utils/sharedLink'
import { holdInstallPrompt } from './utils/installPrompt'

// Apply the saved color scheme before the first paint to avoid a flash.
applyColorScheme(loadColorScheme())

// Chrome offers the install once per page load, usually before sign-in is
// done and the banner that offers it exists. Held from here until then.
holdInstallPrompt()

// A new version waits until asked for (see utils/appUpdate): taking over on
// its own reloaded the page whenever the download happened to finish, and on
// venue wifi that was mid-show. Asking for it reloads the tab that asked and
// no other. A sent link, which has nowhere to ask, takes it as it opens.
registerAppUpdates({ linkPage: sharedLinkRoute(window.location.search, window.location.pathname) !== null })

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
