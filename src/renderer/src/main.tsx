import './styles.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// Both desktops hide the title bar, and each puts its window controls somewhere else: macOS floats
// the traffic lights over the top-left of the sidebar, Windows draws its buttons over the top-right
// of the main area. So the page has to leave clearance, and know which side to expect them on. The
// renderer has no Node access, so the platform comes from the user agent, as it already does for
// the ⌘/Ctrl key hints.
const platformClass = navigator.userAgent.includes('Mac')
  ? 'is-mac'
  : navigator.userAgent.includes('Windows')
    ? 'is-windows'
    : null
if (platformClass !== null) document.documentElement.classList.add(platformClass)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
