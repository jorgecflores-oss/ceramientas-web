import { useEffect, useRef, useState } from 'react'
import { useHornoStore } from '../store/hornoStore'
import { SelectorHorno } from '../components/SelectorHorno'
import { getConfig, postComando, postConfig, postOTA, getOTAStatus, OTA_VERSION_URL, getCachedIP, fetchProgramasOnce, hornoRequest } from '../services/hornoService'
import { OTA_BIN_URL, STORAGE_KEYS } from '../utils/constants'
import { publicarComando } from '../services/mqttService'
import { AP_IP } from '../utils/constants'
import { feedbackBoton } from '../utils/feedback'
import type { ConfigHorno, LimitesConfig } from '../types/horno'

// Límites de firmware anterior a v3.6.0 (no manda "limites" en /config).
// Firmware viejo rechaza valores fuera de estos rangos, así que la app no debe ofrecerlos.
const LIMITES_LEGACY: LimitesConfig = {
  potMin: 2000, potMax: 8000,
  factMin: 20000, factMax: 200000,
  consMin: 200, consMax: 2000,
}

const fmt = (n: number) => n.toLocaleString('es-AR')

// Nombre del horno: el firmware acepta 1–19 bytes y no admite '"' ni '\\' (rompen JSON armado a mano).
const NOMBRE_MAX_BYTES = 19
const bytesUtf8 = (s: string) => new TextEncoder().encode(s).length

// Quita '"' y '\\', y recorta por caracteres completos hasta entrar en 19 bytes UTF-8.
function limpiarNombre(s: string): { limpio: string; quitados: boolean; recortado: boolean } {
  const sinProhibidos = s.replace(/["\\]/g, '')
  let limpio = ''
  for (const ch of sinProhibidos) {
    if (bytesUtf8(limpio + ch) > NOMBRE_MAX_BYTES) break
    limpio += ch
  }
  return { limpio, quitados: sinProhibidos !== s, recortado: limpio !== sinProhibidos }
}

// Motivos de reinicio que publica el firmware en /info ("reset" y "resets")
const MOTIVOS_RESET: Record<string, string> = {
  'power-on': 'encendido / corte de luz',
  'watchdog-tarea': 'watchdog (se colgó)',
  'watchdog-interrupcion': 'watchdog (interrupción)',
  'watchdog': 'watchdog',
  'brownout-caida-tension': 'caída de tensión',
  'software': 'reinicio por software',
  'panic': 'error interno',
  'reset-externo': 'reset externo',
  'desconocido': 'desconocido',
}

// "*" al final = había horneada activa. Motivo que no está en la tabla se muestra tal cual.
function traducirReset(crudo: string): string {
  const limpio = crudo.trim()
  const conHorneada = limpio.endsWith('*')
  const motivo = conHorneada ? limpio.slice(0, -1).trim() : limpio
  const texto = MOTIVOS_RESET[motivo] ?? motivo
  return conHorneada ? `${texto} (con horneada activa)` : texto
}

type OtaStep  = null | 'checking' | 'downloading' | 'current' | 'done' | 'error'
type WifiStep = null | 'detectando' | 'listo' | 'instrucciones'

interface Props {
  onAgregarHorno: () => void
}

export function ConfigPage({ onAgregarHorno }: Props) {
  const horno = useHornoStore(s => s.hornoActivo)
  const pass = useHornoStore(s => s.password)
  const quitarHorno = useHornoStore(s => s.quitarHorno)
  const setHorno = useHornoStore(s => s.setHorno)
  const setProgramas = useHornoStore(s => s.setProgramas)

  const [potencia, setPotencia] = useState('')
  const [factura, setFactura] = useState('')
  const [consumo, setConsumo] = useState('')
  const [limites, setLimites] = useState<LimitesConfig>(LIMITES_LEGACY)
  const [versionFw, setVersionFw] = useState<string | null>(null)
  const [resetsFw, setResetsFw] = useState<{ ultimo?: string; historial?: string[]; aviso?: string } | null>(null)
  const [cargandoResets, setCargandoResets] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [confirmarDesvincular, setConfirmarDesvincular] = useState(false)
  const [editandoNombre, setEditandoNombre] = useState(false)
  const [nombreInput, setNombreInput] = useState('')
  const [avisoNombre, setAvisoNombre] = useState('')
  const [guardandoNombre, setGuardandoNombre] = useState(false)

  const [otaStep, setOtaStep] = useState<OtaStep>(null)
  const [otaProgress, setOtaProgress] = useState(0)
  const [otaMensaje, setOtaMensaje] = useState('')
  const [otaVersionGitHub, setOtaVersionGitHub] = useState('')
  const otaIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [showUrlRescate, setShowUrlRescate] = useState(false)
  const [urlRescate, setUrlRescate] = useState('')
  const [enviandoUrlRescate, setEnviandoUrlRescate] = useState(false)

  const [wifiStep, setWifiStep] = useState<WifiStep>(null)
  const [wifiUrl, setWifiUrl] = useState('')
  const [restaurando, setRestaurando] = useState(false)
  const [reiniciando, setReiniciando] = useState(false)

  useEffect(() => {
    if (!horno?.hornoId) return
    getConfig(horno.hornoId)
      .then(cfg => {
        setPotencia(String(cfg.potencia ?? 6000))
        setFactura(String(cfg.factura ?? 71000))
        setConsumo(String(cfg.consumo ?? 520))
        setLimites(cfg.limites ?? LIMITES_LEGACY)
        setVersionFw(cfg.versionFirmware ?? null)
      })
      .catch(e => console.error('[getConfig]', e))
  }, [horno?.hornoId])

  useEffect(() => {
    return () => {
      if (otaIntervalRef.current) clearInterval(otaIntervalRef.current)
    }
  }, [])

  // Consulta bajo demanda (no al abrir la página): evita cargar la cola MQTT con señal floja.
  async function verResets() {
    if (!horno?.hornoId || cargandoResets) return
    setCargandoResets(true)
    try {
      const resp = await hornoRequest(horno.hornoId, 'info', 'GET')
      const d = resp.data as { reset?: string; resets?: string }
      const historial = (d.resets ?? '').split(',').map(r => r.trim()).filter(Boolean).map(traducirReset)
      const ultimo = d.reset?.trim() ? traducirReset(d.reset) : (historial[0] ?? null)
      // Firmware viejo sin esos campos: no hay líneas de reinicio para mostrar
      setResetsFw(ultimo ? { ultimo, historial } : { aviso: 'no disponible en este firmware' })
    } catch {
      setResetsFw({ aviso: 'sin respuesta del horno' })
    } finally {
      setCargandoResets(false)
    }
  }

  async function guardarParams() {
    const potV = Number(potencia)
    const facV = Number(factura)
    const conV = Number(consumo)

    const L = limites
    if (isNaN(potV) || potV < L.potMin || potV > L.potMax) {
      alert(`Potencia debe estar entre ${fmt(L.potMin)} y ${fmt(L.potMax)} W`)
      return
    }
    if (isNaN(facV) || facV < L.factMin || facV > L.factMax) {
      alert(`Factura debe estar entre $${fmt(L.factMin)} y $${fmt(L.factMax)}`)
      return
    }
    if (isNaN(conV) || conV < L.consMin || conV > L.consMax) {
      alert(`Consumo debe estar entre ${fmt(L.consMin)} y ${fmt(L.consMax)} kWh/mes`)
      return
    }

    const potR = Math.floor(potV / 100) * 100
    const facR = Math.floor(facV / 1000) * 1000
    const conR = Math.floor(conV / 10) * 10

    feedbackBoton()
    setGuardando(true)
    try {
      if (!horno) return
      const cmd = `setconfig:potencia=${potR},factura=${facR},consumo=${conR}`
      const ok = publicarComando(horno.hornoId, cmd)
      if (!ok) {
        await postComando(horno.hornoId, cmd)
      }
      // setconfig por MQTT es fire-and-forget: releer /config y comparar.
      // Hasta 3 lecturas separadas 1s para darle tiempo al firmware a procesar el comando.
      // Campos ausentes en GET /config (firmware viejo) no se verifican.
      let aplicado = false
      let cfg: ConfigHorno | null = null
      for (let i = 0; i < 3 && !aplicado; i++) {
        await new Promise(r => setTimeout(r, 1000))
        try {
          cfg = await getConfig(horno.hornoId)
        } catch {
          continue
        }
        aplicado = (cfg.potencia === undefined || cfg.potencia === potR)
          && (cfg.factura === undefined || cfg.factura === facR)
          && (cfg.consumo === undefined || cfg.consumo === conR)
      }
      if (!cfg) {
        alert('Comando enviado, pero no se pudo verificar con el horno.')
        return
      }
      if (!aplicado) {
        // Reflejar lo que el horno tiene realmente
        setPotencia(String(cfg.potencia ?? potR))
        setFactura(String(cfg.factura ?? facR))
        setConsumo(String(cfg.consumo ?? conR))
        throw new Error('El horno no aplicó el cambio')
      }
      alert('Guardado')
    } catch (e) {
      alert(e instanceof Error && e.message === 'El horno no aplicó el cambio' ? e.message : 'Error guardando')
    } finally {
      setGuardando(false)
    }
  }

  async function guardarNombre() {
    // Re-limpiar al guardar (por si el valor llegó sin pasar por onChange)
    const { limpio, quitados } = limpiarNombre(nombreInput)
    const nuevoNombre = limpio.trim()
    if (quitados) setAvisoNombre('Se quitaron comillas y barras invertidas')
    if (!horno?.hornoId || !pass || !nuevoNombre) return
    feedbackBoton()
    setGuardandoNombre(true)
    try {
      await postConfig(horno.hornoId, { nombre: nuevoNombre })
      // El firmware responde 200 aunque ignore el nombre: releer y comparar.
      // Si GET /config no trae `nombre` (firmware viejo) no se puede verificar → se acepta.
      const cfg = await getConfig(horno.hornoId)
      if (cfg.nombre !== undefined && cfg.nombre.trim() !== nuevoNombre) {
        throw new Error('El horno no aplicó el cambio')
      }
      setHorno({ ...horno, nombre: nuevoNombre }, pass)
      setEditandoNombre(false)
    } catch (e) {
      alert(e instanceof Error && e.message === 'El horno no aplicó el cambio' ? e.message : 'Error guardando nombre')
    } finally {
      setGuardandoNombre(false)
    }
  }

  async function restaurarPredefinidos() {
    if (!horno?.hornoId) return
    feedbackBoton()
    setRestaurando(true)
    const hornoId = horno.hornoId
    try {
      const ok = publicarComando(hornoId, 'restaurar_predef')
      if (!ok) {
        await postComando(hornoId, 'restaurar_predef')
      }
      // Invalidar caché local antes de refetchear — evita que otros dispositivos
      // sirvan nombres genéricos obsoletos si el fetch les falla
      localStorage.removeItem(STORAGE_KEYS.PROGRAMAS_CACHE(hornoId))
      // Esperar que el firmware termine de escribir en EEPROM antes de leer
      await new Promise(r => setTimeout(r, 2000))
      try {
        const progs = await fetchProgramasOnce(hornoId)
        setProgramas(progs)
      } catch {
        // Si el refetch falla el usuario igual verá los nombres correctos
        // al navegar a Programas (la caché ya fue limpiada)
      }
      alert('Predefinidos restaurados.')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error restaurando programas predefinidos'
      alert(msg)
    } finally {
      setRestaurando(false)
    }
  }

  async function compartirHorno() {
    if (!horno?.hornoId || !pass) return
    feedbackBoton()
    const texto = `${horno.hornoId}:${pass}`
    if (navigator.share) {
      try {
        await navigator.share({ title: 'ID horno Ceramientas', text: texto })
      } catch {
        // cancelado, ignorar
      }
    } else {
      try {
        await navigator.clipboard.writeText(texto)
        alert('ID copiado. Pegalo donde quieras compartirlo.')
      } catch {
        alert('No se pudo copiar ID.')
      }
    }
  }

  function desvincularHorno() {
    if (!horno) return
    quitarHorno(horno.hornoId)
    setConfirmarDesvincular(false)
  }

  async function reiniciarApp() {
    if (!confirm('¿Reiniciar la app?\n\nSe borran el caché y el Service Worker. Tus hornos se restauran automáticamente.')) return
    setReiniciando(true)
    try {
      const listaRaw = localStorage.getItem('@ceramientas_hornos_lista')
      const hornos = listaRaw ? JSON.parse(listaRaw) as { hornoId: string }[] : []
      const passwords: Record<string, string> = {}
      for (const h of hornos) {
        const p = localStorage.getItem(`@ceramientas_pass_${h.hornoId}`)
        if (p) passwords[h.hornoId] = p
      }
      sessionStorage.setItem('@ceramientas_restore', JSON.stringify({ hornos, passwords }))
      localStorage.clear()
      try {
        if ('caches' in window) {
          const keys = await caches.keys()
          await Promise.all(keys.map(k => caches.delete(k)))
        }
      } catch { /* ignorar */ }
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations()
          await Promise.all(regs.map(r => r.unregister()))
        }
      } catch { /* ignorar */ }
      location.reload()
    } catch (e) {
      setReiniciando(false)
      alert('Error al reiniciar: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  function cerrarWifi() {
    setWifiStep(null)
    setWifiUrl('')
  }

  async function abrirConfigWifi() {
    feedbackBoton()
    if (horno?.hornoId) {
      const ip = getCachedIP(horno.hornoId)
      if (ip) {
        setWifiUrl(`http://${ip}/`)
        setWifiStep('listo')
        return
      }
    }
    setWifiStep('instrucciones')
  }

  function cerrarOTA() {
    if (otaIntervalRef.current) clearInterval(otaIntervalRef.current)
    setOtaStep(null)
    setOtaProgress(0)
    setOtaMensaje('')
    setOtaVersionGitHub('')
  }

  async function instalarUrlDirecta() {
    if (!horno?.hornoId || !urlRescate.trim()) return
    feedbackBoton()
    setEnviandoUrlRescate(true)
    try {
      await postComando(horno.hornoId, `ota_forzar_url:${urlRescate.trim()}`)
      alert('Comando enviado. El horno va a descargar el firmware y reiniciar. Puede tardar 1-2 minutos.')
      setShowUrlRescate(false)
      setUrlRescate('')
    } catch (e) {
      alert('Error enviando comando: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setEnviandoUrlRescate(false)
    }
  }

  async function iniciarOTA() {
    if (!horno?.hornoId) return
    feedbackBoton()
    if (otaIntervalRef.current) clearInterval(otaIntervalRef.current)
    setOtaProgress(0)
    setOtaMensaje('')
    setOtaVersionGitHub('')
    setOtaStep('checking')

    try {
      // 1. Verificar versión disponible en GitHub
      try {
        const ghResp = await fetch(OTA_VERSION_URL, { cache: 'no-store' })
        if (ghResp.ok) {
          const ghJson = await ghResp.json() as { version?: string }
          const remoteVer = (ghJson.version ?? '').trim()
          if (remoteVer) {
            setOtaVersionGitHub(remoteVer)
            if (versionFw && remoteVer === versionFw) {
              setOtaStep('current')
              return
            }
          }
        }
      } catch {}

      // 2. Disparar OTA en el firmware
      const json = await postOTA(horno.hornoId)
      const msg = (json.msg ?? '').toLowerCase()
      if (msg.includes('no hay') || msg.includes('igual') || (msg.includes('actualiz') && msg.includes('ya'))) {
        setOtaStep('current')
        return
      }

      // 3. Polling real de /ota/status cada 2s
      setOtaStep('downloading')
      setOtaProgress(5)
      let instalandoConfirmado = false
      let pollsInactivos = 0
      let segundosPoll = 0
      const hornoId = horno.hornoId

      otaIntervalRef.current = setInterval(async () => {
        segundosPoll += 2
        const status = await getOTAStatus(hornoId)

        if (status?.enProgreso) {
          instalandoConfirmado = true
          pollsInactivos = 0
          const p = Math.min(90, 10 + Math.round(80 * (1 - Math.exp(-segundosPoll / 30))))
          setOtaProgress(p)
        } else if (instalandoConfirmado) {
          if (otaIntervalRef.current) clearInterval(otaIntervalRef.current)
          setOtaProgress(100)
          setOtaStep('done')
        } else {
          pollsInactivos += 1
          if (pollsInactivos >= 4) {
            // 8s sin actividad → firmware no encontró versión nueva
            if (otaIntervalRef.current) clearInterval(otaIntervalRef.current)
            setOtaStep('current')
            return
          }
          setOtaProgress(Math.min(15, segundosPoll * 2))
        }

        if (segundosPoll >= 60) {
          if (otaIntervalRef.current) clearInterval(otaIntervalRef.current)
          setOtaStep('done')
        }
      }, 2000)

    } catch (e) {
      if (otaIntervalRef.current) clearInterval(otaIntervalRef.current)
      setOtaMensaje((e as Error).message || 'No se pudo conectar con el horno')
      setOtaStep('error')
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-6 pb-24">
      <div className="max-w-md mx-auto">

        <header className="mb-6">
          <p className="text-xs text-neutral-400 tracking-widest uppercase">ceramientas</p>
          {editandoNombre ? (
            <>
            <div className="flex gap-2 items-center mt-1">
              <input
                type="text"
                value={nombreInput}
                onChange={e => {
                  const { limpio, quitados, recortado } = limpiarNombre(e.target.value)
                  setNombreInput(limpio)
                  setAvisoNombre(
                    quitados ? 'No se permiten comillas ni barras invertidas'
                    : recortado ? `Máximo ${NOMBRE_MAX_BYTES} caracteres (los acentos y emojis ocupan más)`
                    : ''
                  )
                }}
                maxLength={19}
                autoFocus
                className="flex-1 px-2 py-1 bg-neutral-900 border border-orange-500 rounded text-2xl font-bold text-white"
              />
              <button
                onClick={guardarNombre}
                disabled={guardandoNombre}
                className="px-3 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 rounded text-sm font-semibold active:scale-95 transition duration-75"
              >
                {guardandoNombre ? '...' : 'OK'}
              </button>
              <button
                onClick={() => setEditandoNombre(false)}
                disabled={guardandoNombre}
                className="px-2 py-2 text-neutral-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>
            {avisoNombre && <p className="text-xs text-amber-400 mt-1">{avisoNombre}</p>}
            </>
          ) : (
            <button
              onClick={() => {
                setNombreInput(horno?.nombre ?? '')
                setAvisoNombre('')
                setEditandoNombre(true)
              }}
              className="text-2xl font-bold text-white mt-1 hover:text-orange-400 transition text-left"
            >
              {horno?.nombre ?? '—'} ✎
            </button>
          )}
          {horno?.potencia && (
            <p className="text-sm text-neutral-400 mt-1">{horno.potencia} W</p>
          )}
        </header>

        <SelectorHorno />

        <section className="mb-6">
          <div className="bg-neutral-900 rounded-2xl border border-neutral-800 p-5">
            <p className="text-xs text-neutral-500 uppercase tracking-widest mb-4">Configuración del controlador</p>

            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
                <label className="text-xs text-neutral-400 uppercase tracking-wider">Potencia</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={potencia}
                    onChange={e => setPotencia(e.target.value)}
                    min={limites.potMin}
                    max={limites.potMax}
                    placeholder={`${limites.potMin}–${limites.potMax}`}
                    className="w-28 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-white text-right focus:border-orange-500 focus:outline-none"
                  />
                  <span className="text-neutral-500 text-sm w-16">W</span>
                </div>
              </div>

              <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
                <label className="text-xs text-neutral-400 uppercase tracking-wider">Factura</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={factura}
                    onChange={e => setFactura(e.target.value)}
                    min={limites.factMin}
                    max={limites.factMax}
                    placeholder={`${limites.factMin}–${limites.factMax}`}
                    className="w-28 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-white text-right focus:border-orange-500 focus:outline-none"
                  />
                  <span className="text-neutral-500 text-sm w-16">$/mes</span>
                </div>
              </div>

              <div className="flex items-center justify-between pb-2">
                <label className="text-xs text-neutral-400 uppercase tracking-wider">Consumo</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={consumo}
                    onChange={e => setConsumo(e.target.value)}
                    min={limites.consMin}
                    max={limites.consMax}
                    placeholder={`${limites.consMin}–${limites.consMax}`}
                    className="w-28 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-white text-right focus:border-orange-500 focus:outline-none"
                  />
                  <span className="text-neutral-500 text-sm w-16">kWh/mes</span>
                </div>
              </div>
            </div>

            <button
              onClick={guardarParams}
              disabled={guardando}
              className="w-full mt-6 py-3 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 rounded-xl font-semibold transition active:scale-95 duration-75"
            >
              {guardando ? 'Guardando...' : 'Guardar configuración'}
            </button>
          </div>
        </section>

        <section className="mb-6">
          <div className="bg-neutral-900 rounded-2xl border border-neutral-800 p-5">
            <p className="text-xs text-neutral-500 uppercase tracking-widest mb-4">Horno</p>

            <div className="space-y-2">
              <button
                onClick={() => { feedbackBoton(); onAgregarHorno() }}
                className="w-full flex items-center gap-4 py-3 border-b border-neutral-800 hover:bg-neutral-800 rounded-xl transition active:scale-95 duration-75"
              >
                <span className="text-2xl">➕</span>
                <div className="flex-1 text-left">
                  <p className="text-white text-sm font-semibold">Agregar horno</p>
                  <p className="text-xs text-neutral-500 mt-0.5">Vincular un nuevo controlador</p>
                </div>
                <span className="text-neutral-600">›</span>
              </button>

              {horno && (
                <div className="w-full flex items-center gap-4 py-3 border-b border-neutral-800">
                  <span className="text-2xl">🔔</span>
                  <div className="flex-1 text-left">
                    <p className="text-white text-sm font-semibold">Notificaciones</p>
                    <p className="text-xs text-neutral-500 mt-0.5 mb-2">Nombre del canal en la app ntfy</p>
                    <div className="bg-neutral-800 rounded-xl px-3 py-2 flex items-center justify-between gap-2">
                      <p className="text-orange-400 font-mono text-xs break-all select-all">
                        ceramientas-{horno.hornoId}
                      </p>
                      <button
                        onClick={() => navigator.clipboard.writeText(`ceramientas-${horno.hornoId}`)}
                        className="shrink-0 text-xs text-neutral-300 bg-neutral-600 hover:bg-neutral-500 px-3 py-1.5 rounded-lg transition-colors font-medium"
                      >
                        Copiar
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={abrirConfigWifi}
                disabled={wifiStep !== null}
                className={`w-full flex items-center gap-4 py-3 border-b border-neutral-800 transition ${wifiStep !== null ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neutral-800 rounded-xl'}`}
              >
                <span className="text-2xl">📡</span>
                <div className="flex-1 text-left">
                  <p className="text-white text-sm font-semibold">Configurar WiFi</p>
                  <p className="text-xs text-neutral-500 mt-0.5">Conectar el controlador a una red nueva</p>
                </div>
                <span className="text-neutral-600">›</span>
              </button>

              <button
                onClick={iniciarOTA}
                disabled={otaStep !== null}
                className={`w-full flex items-center gap-4 py-3 border-neutral-800 transition ${otaStep !== null ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neutral-800 rounded-xl'} ${showUrlRescate ? '' : 'border-b'}`}
              >
                <span className="text-2xl">⬆️</span>
                <div className="flex-1 text-left">
                  <p className="text-white text-sm font-semibold">Actualizar firmware</p>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {versionFw ? `v${versionFw} instalada` : 'Instalar nueva versión OTA'}
                  </p>
                </div>
                <span className="text-neutral-600">›</span>
              </button>

              {/* Rescate: instalar .bin por URL directa (bypassea otaChequearVersion) */}
              <div className="border-b border-neutral-800 pb-3">
                <button
                  onClick={() => {
                    if (showUrlRescate) { setShowUrlRescate(false); return }
                    const ver = otaVersionGitHub || versionFw || ''
                    setUrlRescate(ver ? OTA_BIN_URL(ver) : '')
                    setShowUrlRescate(true)
                  }}
                  className="text-xs text-neutral-600 hover:text-neutral-400 transition pt-1"
                >
                  {showUrlRescate ? '▲ Cancelar' : '↗ Forzar instalación por URL directa'}
                </button>
                {showUrlRescate && (
                  <div className="mt-2 flex flex-col gap-2">
                    <p className="text-xs text-neutral-500">Editá el número de versión en la URL o pegá una URL diferente. El firmware descarga e instala sin verificar versión.</p>
                    <textarea
                      value={urlRescate}
                      onChange={e => setUrlRescate(e.target.value)}
                      rows={4}
                      className="w-full bg-neutral-800 text-white text-xs rounded-lg p-2 border border-neutral-700 resize-none"
                    />
                    <button
                      onClick={instalarUrlDirecta}
                      disabled={enviandoUrlRescate || !urlRescate.trim()}
                      className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-sm font-semibold py-2 rounded-xl transition"
                    >
                      {enviandoUrlRescate ? 'Enviando...' : 'Instalar'}
                    </button>
                  </div>
                )}
              </div>

              <button
                onClick={restaurarPredefinidos}
                disabled={restaurando}
                className={`w-full flex items-center gap-4 py-3 border-b border-neutral-800 transition ${restaurando ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neutral-800 rounded-xl'}`}
              >
                <span className="text-2xl">↺</span>
                <div className="flex-1 text-left">
                  <p className="text-white text-sm font-semibold">Restaurar predefinidos</p>
                  <p className="text-xs text-neutral-500 mt-0.5">Recupera los 4 programas originales, si los borraste</p>
                </div>
                <span className="text-neutral-600">›</span>
              </button>

              <button
                onClick={compartirHorno}
                className="w-full flex items-center gap-4 py-3 border-b border-neutral-800 hover:bg-neutral-800 rounded-xl transition active:scale-95 duration-75"
              >
                <svg className="w-6 h-6 text-neutral-300 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z" />
                </svg>
                <div className="flex-1 text-left">
                  <p className="text-white text-sm font-semibold">Compartir ID</p>
                  <p className="text-xs text-neutral-500 mt-0.5">Enviar ID para vincular en otro dispositivo</p>
                </div>
                <span className="text-neutral-600">›</span>
              </button>

              <button
                onClick={() => setConfirmarDesvincular(true)}
                className="w-full flex items-center gap-4 py-3 border-b border-neutral-800 hover:bg-red-950/10 rounded transition"
              >
                <span className="text-2xl">🔗</span>
                <div className="flex-1 text-left">
                  <p className="text-red-400 text-sm font-semibold">Desvincular horno</p>
                  <p className="text-xs text-neutral-500 mt-0.5">Vuelve a aparecer si el controlador se reinicia</p>
                </div>
              </button>

              <button
                onClick={reiniciarApp}
                disabled={reiniciando}
                className={`w-full flex items-center gap-4 py-3 transition ${reiniciando ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-950/10 rounded'}`}
              >
                <span className="text-2xl">🔄</span>
                <div className="flex-1 text-left">
                  <p className="text-red-400 text-sm font-semibold">Reiniciar app</p>
                  <p className="text-xs text-neutral-500 mt-0.5">Borra el caché y recarga. Los hornos se restauran.</p>
                </div>
              </button>
            </div>
          </div>
        </section>

        <p className="text-center text-xs text-neutral-500 mt-8">
          App v0.1.0 · FW {versionFw ? `v${versionFw}` : '—'}
        </p>
        <div className="text-center mt-2">
          <button onClick={verResets} className="text-xs text-neutral-500 underline">
            {cargandoResets ? 'Consultando…' : 'Ver últimos reinicios del controlador'}
          </button>
          {resetsFw?.aviso && (
            <p className="text-xs text-neutral-400 mt-1">{resetsFw.aviso}</p>
          )}
          {resetsFw?.ultimo && (
            <p className="text-xs text-neutral-400 mt-1">Último reinicio: {resetsFw.ultimo}</p>
          )}
          {resetsFw?.historial && resetsFw.historial.length > 0 && (
            <p className="text-xs text-neutral-400 mt-1">
              Historial: {resetsFw.historial.join(' · ')}{' '}
              <span className="text-neutral-600">(más nuevo primero)</span>
            </p>
          )}
        </div>

      </div>

      {/* Modal WiFi Setup */}
      {wifiStep !== null && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-6">
          <div className="bg-neutral-900 rounded-2xl p-7 max-w-sm w-full border border-neutral-800 flex flex-col items-center text-center">

            {wifiStep === 'detectando' && (
              <>
                <div className="w-10 h-10 border-4 border-neutral-700 border-t-orange-500 rounded-full animate-spin mb-4" />
                <p className="text-white font-bold text-lg mb-2">Detectando controlador...</p>
              </>
            )}

            {wifiStep === 'listo' && (
              <>
                <p className="text-4xl mb-3">📡</p>
                <p className="text-white font-bold text-lg mb-2">Configurar WiFi</p>
                <p className="text-neutral-400 text-sm mb-6">
                  Se abrirá la página de configuración del controlador en una nueva pestaña.
                  Desde ahí podés escanear y conectar a una red WiFi nueva.
                </p>
                <div className="flex gap-2 w-full">
                  <button
                    onClick={cerrarWifi}
                    className="flex-1 py-3 border border-neutral-700 rounded-xl text-neutral-400 text-sm hover:bg-neutral-800 transition"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => { window.open(wifiUrl, '_blank'); cerrarWifi() }}
                    className="flex-1 py-3 bg-orange-500 hover:bg-orange-600 rounded-xl text-white font-semibold transition active:scale-95 duration-75"
                  >
                    Abrir
                  </button>
                </div>
              </>
            )}

            {wifiStep === 'instrucciones' && (
              <>
                <p className="text-4xl mb-3">📡</p>
                <p className="text-white font-bold text-lg mb-2">Conectate al hotspot</p>
                <div className="bg-neutral-800 rounded-xl p-4 w-full mb-4 text-left">
                  <p className="text-xs text-neutral-400 uppercase tracking-wider mb-2">Red WiFi</p>
                  <p className="text-orange-400 font-bold font-mono">
                    CERAMIENTAS_{horno?.hornoId?.slice(-4) ?? '????'}
                  </p>
                  <p className="text-xs text-neutral-400 uppercase tracking-wider mt-3 mb-1">Contraseña</p>
                  <p className="text-white font-mono">ceramientas</p>
                </div>
                <p className="text-neutral-400 text-sm mb-6">
                  Conectate a esa red desde tu dispositivo. Después tocá "Abrir configuración".
                </p>
                <div className="flex gap-2 w-full">
                  <button
                    onClick={cerrarWifi}
                    className="flex-1 py-3 border border-neutral-700 rounded-xl text-neutral-400 text-sm hover:bg-neutral-800 transition"
                  >
                    Cerrar
                  </button>
                  <button
                    onClick={() => { window.open(`http://${AP_IP}/`, '_blank'); cerrarWifi() }}
                    className="flex-1 py-3 bg-orange-500 hover:bg-orange-600 rounded-xl text-white font-semibold transition active:scale-95 duration-75"
                  >
                    Abrir configuración
                  </button>
                </div>
              </>
            )}

          </div>
        </div>
      )}

      {/* Modal OTA */}
      {otaStep !== null && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-6">
          <div className="bg-neutral-900 rounded-2xl p-7 max-w-sm w-full border border-neutral-800 flex flex-col items-center text-center">

            {otaStep === 'checking' && (
              <>
                <div className="w-10 h-10 border-4 border-neutral-700 border-t-orange-500 rounded-full animate-spin mb-4" />
                <p className="text-white font-bold text-lg mb-2">Verificando...</p>
                <p className="text-neutral-400 text-sm">Conectando con el controlador</p>
              </>
            )}

            {otaStep === 'downloading' && (
              <>
                <p className="text-4xl mb-3">📦</p>
                <p className="text-white font-bold text-lg mb-2">Instalando actualización</p>
                <p className="text-neutral-400 text-sm mb-5">No apagues el horno ni cierres la pestaña</p>
                <div className="w-full bg-neutral-800 rounded-full h-1.5 overflow-hidden mb-2">
                  <div
                    className="h-full bg-orange-500 rounded-full transition-all duration-500"
                    style={{ width: `${otaProgress}%` }}
                  />
                </div>
                <p className="text-neutral-500 text-xs mb-5">{otaProgress}%</p>
                <button
                  onClick={cerrarOTA}
                  className="w-full py-3 border border-neutral-700 rounded-xl text-neutral-400 text-sm hover:bg-neutral-800 transition"
                >
                  Cancelar espera
                </button>
              </>
            )}

            {otaStep === 'current' && (
              <>
                <p className="text-4xl mb-3">✅</p>
                <p className="text-white font-bold text-lg mb-2">Ya tenés la última versión</p>
                <p className="text-neutral-400 text-sm mb-6">
                  {otaVersionGitHub
                    ? `v${otaVersionGitHub} es la versión más reciente.`
                    : versionFw ? `v${versionFw} es la versión más reciente.` : 'El firmware ya está actualizado.'}
                </p>
                <button
                  onClick={cerrarOTA}
                  className="w-full py-3 bg-orange-500 hover:bg-orange-600 rounded-xl text-white font-semibold transition"
                >
                  Cerrar
                </button>
              </>
            )}

            {otaStep === 'done' && (
              <>
                <p className="text-4xl mb-3">✅</p>
                <p className="text-white font-bold text-lg mb-2">Actualización instalada</p>
                <p className="text-neutral-400 text-sm mb-6">
                  El controlador se está reiniciando.
                  Puede tardar unos segundos en volver a conectarse.
                </p>
                <button
                  onClick={cerrarOTA}
                  className="w-full py-3 bg-orange-500 hover:bg-orange-600 rounded-xl text-white font-semibold transition"
                >
                  Cerrar
                </button>
              </>
            )}

            {otaStep === 'error' && (
              <>
                <p className="text-4xl mb-3">⚠️</p>
                <p className="text-red-400 font-bold text-lg mb-2">Error</p>
                <p className="text-neutral-400 text-sm mb-6">{otaMensaje}</p>
                <button
                  onClick={cerrarOTA}
                  className="w-full py-3 bg-orange-500 hover:bg-orange-600 rounded-xl text-white font-semibold transition"
                >
                  Cerrar
                </button>
              </>
            )}

          </div>
        </div>
      )}

      {confirmarDesvincular && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-6">
          <div className="bg-neutral-900 rounded-2xl p-6 max-w-sm w-full border border-neutral-800">
            <h3 className="font-bold text-lg mb-2">¿Desvincular {horno?.nombre}?</h3>
            <p className="text-sm text-neutral-400 mb-6">
              No vas a poder redetectarlo solo — ya quedó reclamado. Necesitás el ID:pass desde otro dispositivo que lo tenga vinculado ("Compartir ID"), o resetear el horno físico (↑↓ 10 seg) si este era el único.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmarDesvincular(false)}
                className="flex-1 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition"
              >
                Cancelar
              </button>
              <button
                onClick={desvincularHorno}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 rounded-lg font-semibold transition active:scale-95 duration-75"
              >
                Desvincular
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
