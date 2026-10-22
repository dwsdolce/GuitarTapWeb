// @parity app/entry
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { apply as applyAppearance } from './presentation/palette'
import { settingsStore } from './settingsStore'
import './index.css'

// The scheme's colours before the first paint, so no frame is drawn without them.
applyAppearance(settingsStore.get().appearance)

const root = document.getElementById('root')
if (!root) throw new Error('Root element #root not found')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
