import './styles.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// macOS hides the title bar and floats the traffic lights over the sidebar, so the chrome needs
// clearance there and nowhere else. The renderer has no Node access, so the platform comes from the
// user agent, as it already does for the ⌘/Ctrl key hints.
if (navigator.userAgent.includes('Mac')) document.documentElement.classList.add('is-mac')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
