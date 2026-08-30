import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

if (new URLSearchParams(window.location.search).has('debug')) {
  const s = document.createElement('script')
  s.src = 'https://cdn.jsdelivr.net/npm/eruda'
  s.onload = () => (window as any).eruda?.init()
  document.head.appendChild(s)
}

// Restaurar credenciales guardadas antes de un reset de app
{
  const raw = sessionStorage.getItem('@ceramientas_restore')
  if (raw) {
    sessionStorage.removeItem('@ceramientas_restore')
    try {
      const { hornos, passwords } = JSON.parse(raw) as {
        hornos: object[]
        passwords: Record<string, string>
      }
      localStorage.setItem('@ceramientas_hornos_lista', JSON.stringify(hornos))
      for (const [id, pass] of Object.entries(passwords)) {
        localStorage.setItem(`@ceramientas_pass_${id}`, pass)
      }
    } catch { /* datos corruptos — arranca limpio */ }
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
