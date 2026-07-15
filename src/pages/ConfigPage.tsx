import { useEffect, useRef, useState } from 'react'
import { useHornoStore } from '../store/hornoStore'
import { SelectorHorno } from '../components/SelectorHorno'
import { getConfig, postComando, postConfig, postOTA, getOTAStatus, OTA_VERSION_URL, getCachedIP, cacheIP } from '../services/hornoService'
import { publicarComando } from '../services/mqttService'
import { AP_IP } from '../utils/constants'
import { feedbackBoton } from '../utils/feedback'

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

  const [potencia, setPotencia] = useState('')
  const [factura, setFactura] = useState('')
  const [consumo, setConsumo] = useState('')
  const [versionFw, setVersionFw] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [confirmarDesvincular, setConfirmarDesvincular] = useState(false)
  const [editandoNombre, setEditandoNombre] = useState(false)
  const [nombreInput, setNombreInput] = useState('')
  const [guardandoNombre, setGuardandoNombre] = useState(false)

  const [otaStep, setOtaStep] = useState<OtaStep>(null)
  const [otaProgress, setOtaProgress] = useState(0)
  const [otaMensaje, setOtaMensaje] = useState('')
  const [otaVersionGitHub, setOtaVersionGitHub] = useState('')
  const otaIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [wifiStep, setWifiStep] = useState<WifiStep>(null)
  const [wifiUrl, setWifiUrl] = useState('')

  const [editandoIP, setEditandoIP] = useState(false)
  const [ipInput, setIpInput] = useState('')
  const ipActual = horno?.hornoId ? getCachedIP(horno.hornoId) : null

  useEffect(() => {
    if (!horno?.hornoId) return
    getConfig(horno.hornoId)
      .then(cfg => {
        setPotencia(String(cfg.potencia ?? 6000))
        setFactura(String(cfg.factura ?? 71000))
        setConsumo(String(cfg.consumo ?? 520))
        setVersionFw(cfg.versionFirmware ?? null)
      })
      .catch(e => console.error('[getConfig]', e))
  }, [horno?.hornoId])

  useEffect(() => {
    return () => {
      if (otaIntervalRef.current) clearInterval(otaIntervalRef.current)
    }
  }, [])

  async function guardarParams() {
    const potV = Number(potencia)
    const facV = Number(factura)
    const conV = Number(consumo)

    if (isNaN(potV) || potV < 2000 || potV > 8000) {
      alert('Potencia debe estar entre 2000 y 8000 W')
      return
    }
    if (isNaN(facV) || facV < 20000 || facV > 200000) {
      alert('Factura debe estar entre $20.000 y $200.000')
      return
    }
    if (isNaN(conV) || conV < 200 || conV > 2000) {
      alert('Consumo debe estar entre 200 y 2000 kWh/mes')
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
      alert('Guardado')
    } catch {
      alert('Error guardando')
    } finally {
      setGuardando(false)
    }
  }

  async function guardarNombre() {
    if (!horno?.hornoId || !pass || !nombreInput.trim()) return
    feedbackBoton()
    setGuardandoNombre(true)
    try {
      await postConfig(horno.hornoId, { nombre: nombreInput.trim() })
      setHorno({ ...horno, nombre: nombreInput.trim() }, pass)
      setEditandoNombre(false)
    } catch {
      alert('Error guardando nombre')
    } finally {
      setGuardandoNombre(false)
    }
  }

  function desvincularHorno() {
    if (!horno) return
    quitarHorno(horno.hornoId)
    setConfirmarDesvincular(false)
  }

  function cerrarWifi() {
    setWifiStep(null)
    setWifiUrl('')
  }

  async function abrirConfigWifi() {
    feedbackBoton()
    setWifiStep('detectando')
    // 1. Probar si el AP del firmware responde (usuario conectado al hotspot)
    try {
      const resp = await fetch(`http://${AP_IP}/info`, { signal: AbortSignal.timeout(800) })
      if (resp.ok) {
        setWifiUrl(`http://${AP_IP}/`)
        setWifiStep('listo')
        return
      }
    } catch {}
    // 2. Usar IP LAN cacheada
    if (horno?.hornoId) {
      const ip = getCachedIP(horno.hornoId)
      if (ip) {
        setWifiUrl(`http://${ip}/`)
        setWifiStep('listo')
        return
      }
    }
    // 3. No hay ruta disponible — mostrar instrucciones
    setWifiStep('instrucciones')
  }

  function cerrarOTA() {
    if (otaIntervalRef.current) clearInterval(otaIntervalRef.current)
    setOtaStep(null)
    setOtaProgress(0)
    setOtaMensaje('')
    setOtaVersionGitHub('')
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
        const ghResp = await fetch(OTA_VERSION_URL)
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
            <div className="flex gap-2 items-center mt-1">
              <input
                type="text"
                value={nombreInput}
                onChange={e => setNombreInput(e.target.value)}
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
          ) : (
            <button
              onClick={() => {
                setNombreInput(horno?.nombre ?? '')
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
                    className="w-24 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-white text-right focus:border-orange-500 focus:outline-none"
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
                    className="w-24 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-white text-right focus:border-orange-500 focus:outline-none"
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
                    className="w-24 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-white text-right focus:border-orange-500 focus:outline-none"
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

              <div className="flex items-center gap-4 py-3 border-b border-neutral-800">
                <span className="text-2xl">🌐</span>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-semibold">IP local</p>
                  {editandoIP ? (
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="text"
                        value={ipInput}
                        onChange={e => setIpInput(e.target.value)}
                        placeholder="192.168.1.50"
                        autoFocus
                        className="flex-1 min-w-0 px-2 py-1 bg-neutral-800 border border-orange-500 rounded text-white text-xs font-mono focus:outline-none"
                      />
                      <button
                        onClick={() => {
                          if (horno?.hornoId) cacheIP(horno.hornoId, ipInput.trim())
                          setEditandoIP(false)
                        }}
                        className="px-2 py-1 bg-orange-500 hover:bg-orange-600 rounded text-xs font-bold shrink-0"
                      >
                        OK
                      </button>
                      <button
                        onClick={() => setEditandoIP(false)}
                        className="px-1 py-1 text-neutral-400 hover:text-white text-xs shrink-0"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setIpInput(ipActual ?? ''); setEditandoIP(true) }}
                      className="text-xs font-mono text-orange-400 hover:text-orange-300 mt-0.5 text-left"
                    >
                      {ipActual ?? 'No configurada — tocá para configurar'} ✎
                    </button>
                  )}
                </div>
              </div>

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
                className={`w-full flex items-center gap-4 py-3 border-b border-neutral-800 transition ${otaStep !== null ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neutral-800 rounded-xl'}`}
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

              <button
                onClick={() => setConfirmarDesvincular(true)}
                className="w-full flex items-center gap-4 py-3 hover:bg-red-950/10 rounded transition"
              >
                <span className="text-2xl">🔗</span>
                <div className="flex-1 text-left">
                  <p className="text-red-400 text-sm font-semibold">Desvincular horno</p>
                  <p className="text-xs text-neutral-500 mt-0.5">Vuelve a aparecer si el controlador se reinicia</p>
                </div>
              </button>
            </div>
          </div>
        </section>

        <p className="text-center text-xs text-neutral-500 mt-8">
          App v0.1.0 · FW {versionFw ? `v${versionFw}` : '—'}
        </p>

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
                  Conectate a esa red desde tu dispositivo y volvé a intentar.
                </p>
                <div className="flex gap-2 w-full">
                  <button
                    onClick={cerrarWifi}
                    className="flex-1 py-3 border border-neutral-700 rounded-xl text-neutral-400 text-sm hover:bg-neutral-800 transition"
                  >
                    Cerrar
                  </button>
                  <button
                    onClick={abrirConfigWifi}
                    className="flex-1 py-3 bg-orange-500 hover:bg-orange-600 rounded-xl text-white font-semibold transition active:scale-95 duration-75"
                  >
                    Reintentar
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
            <p className="text-sm text-neutral-400 mb-6">Deberás buscarlo de nuevo para reconectarlo.</p>
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
