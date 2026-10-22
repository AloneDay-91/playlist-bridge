import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

/*
 * Apparence « Système » de Lumen UI : classe .dark sur <html>.
 * Un choix explicite posé sur la racine (data-theme="dark" | "light", ex. dans
 * la preview hébergée) passe avant le thème de l'OS.
 */
const root = document.documentElement
const media = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = (): void => {
  const forced = root.getAttribute('data-theme')
  root.classList.toggle('dark', forced ? forced === 'dark' : media.matches)
}
applyTheme()
media.addEventListener('change', applyTheme)
new MutationObserver(applyTheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
