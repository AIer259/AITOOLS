import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { STORAGE_KEYS } from './lib/constants'
import './styles/global.css'
import './styles/editor.css'

try {
  const saved = localStorage.getItem(STORAGE_KEYS.theme)
  document.documentElement.dataset.theme = saved === 'light' ? 'light' : 'dark'
} catch {
  document.documentElement.dataset.theme = 'dark'
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
