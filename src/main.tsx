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

// La traducción automática de Chrome reemplaza los nodos de texto por <font> y React
// sigue actualizando el nodo viejo: la temperatura grande queda congelada (visto en
// Samsung A07, Chrome Android). El index.html ya pide no traducir; esto es el respaldo
// por si Chrome traduce igual: recarga una vez, con anti-bucle de 5 minutos.
function protegerContraTraduccion() {
  const CLAVE = '@ceramientas_retraduccion_ts'
  const VENTANA_MS = 5 * 60 * 1000
  const html = document.documentElement
  const raiz = document.getElementById('root')

  const traducida = () =>
    html.classList.contains('translated-ltr') ||
    html.classList.contains('translated-rtl') ||
    raiz?.querySelector('font') != null

  const obs = new MutationObserver(revisar)

  function revisar() {
    if (!traducida()) return
    obs.disconnect()
    try {
      const previo = Number(sessionStorage.getItem(CLAVE))
      if (previo && Date.now() - previo < VENTANA_MS) return
      sessionStorage.setItem(CLAVE, String(Date.now()))
    } catch {
      return // sin sessionStorage (modo privado) no hay anti-bucle: no recargar
    }
    location.reload()
  }

  obs.observe(html, { attributes: true, attributeFilter: ['class'] })
  if (raiz) obs.observe(raiz, { childList: true, subtree: true })
  revisar()
}

protegerContraTraduccion()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
