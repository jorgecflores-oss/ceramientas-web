import { useState, useEffect, useRef } from 'react'
import { useHornoStore } from '../store/hornoStore'
import { descubrirHornosMQTT } from '../services/mqttService'
import { verificarHornoMQTT, probeAP, getInfo } from '../services/hornoService'
import { feedbackBoton } from '../utils/feedback'
import { AP_IP } from '../utils/constants'
import type { InfoHorno } from '../types/horno'

interface Props {
  onVolver?: () => void
}

export function LoginPage({ onVolver }: Props) {
  const hornos = useHornoStore((s) => s.hornos)
  const agregarHorno = useHornoStore((s) => s.agregarHorno)
  const setHornoActivo = useHornoStore((s) => s.setHornoActivo)

  const [hornoIdInput, setHornoIdInput] = useState('')
  const [hornosDetectados, setHornosDetectados] = useState<string[]>([])
  const [buscando, setBuscando] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [error, setError] = useState('')
  const [wifiNuevo, setWifiNuevo] = useState<null | 'buscando' | 'ok' | 'manual'>(null)
  const [mostrarSinWifi, setMostrarSinWifi] = useState(false)
  const [detectandoAP, setDetectandoAP] = useState(false)
  const [hornoDetectadoAP, setHornoDetectadoAP] = useState<InfoHorno | null>(null)
  const [errorAP, setErrorAP] = useState('')
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => { if (countdownRef.current) clearInterval(countdownRef.current) }, [])

  async function configurarWifiNuevo() {
    feedbackBoton()
    setWifiNuevo('buscando')
    try {
      const apOk = await probeAP()
      if (apOk) {
        window.open('http://192.168.4.1/', '_blank')
        setWifiNuevo('ok')
      } else {
        setWifiNuevo('manual')
      }
    } catch {
      setWifiNuevo('manual')
    }
  }

  async function detectarHornoAP() {
    feedbackBoton()
    setDetectandoAP(true)
    setErrorAP('')
    setHornoDetectadoAP(null)
    try {
      const info = await getInfo(AP_IP)
      setHornoDetectadoAP(info)
    } catch {
      setErrorAP('No se detectó horno. Conectate a la red WiFi CERAMIENTAS_XXXX del horno e intentá de nuevo.')
    } finally {
      setDetectandoAP(false)
    }
  }

  function vincularDetectadoAP() {
    if (!hornoDetectadoAP) return
    feedbackBoton()
    const passDerivada = hornoDetectadoAP.hornoId.slice(-6).toLowerCase()
    agregarHorno({
      hornoId: hornoDetectadoAP.hornoId,
      nombre: hornoDetectadoAP.nombre,
      version: hornoDetectadoAP.version,
    }, passDerivada)
    setHornoActivo(hornoDetectadoAP.hornoId)
    onVolver?.()
  }

  const BUSQUEDA_MS = 12000

  async function buscarHornos() {
    feedbackBoton()
    setBuscando(true)
    setError('')
    setHornosDetectados([])
    setCountdown(Math.round(BUSQUEDA_MS / 1000))
    if (countdownRef.current) clearInterval(countdownRef.current)
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { clearInterval(countdownRef.current!); return 0 }
        return c - 1
      })
    }, 1000)
    try {
      const encontrados = await descubrirHornosMQTT(BUSQUEDA_MS)
      if (encontrados.length === 0) {
        setError('No se detectaron hornos. Verificá que el horno esté encendido y conectado a internet.')
      }
      setHornosDetectados(encontrados)
    } catch {
      setError('Error buscando hornos')
    } finally {
      setBuscando(false)
      setCountdown(0)
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }

  async function vincularHorno(hornoId: string) {
    if (!hornoId) return
    feedbackBoton()
    setBuscando(true)
    setError('')
    try {
      const result = await verificarHornoMQTT(hornoId)
      if (!result.ok) {
        setError('Horno no responde. Verificá el ID y que el horno esté encendido.')
        return
      }
      const passDerivada = hornoId.slice(-6).toLowerCase()
      agregarHorno({
        hornoId,
        nombre: result.nombre ?? hornoId,
        version: result.version,
      }, passDerivada)
      setHornoActivo(hornoId)
      onVolver?.()
    } catch {
      setError('Error vinculando horno')
    } finally {
      setBuscando(false)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">

        <div className="text-center relative">
          {onVolver && (
            <button
              onClick={onVolver}
              className="absolute left-0 top-1 text-neutral-400 hover:text-white text-sm transition"
            >
              ← Volver
            </button>
          )}
          <p className="text-xs text-neutral-400 tracking-widest uppercase">ceramientas</p>
          <h1 className="text-2xl font-bold tracking-widest mt-1">
            {hornos.length > 0 ? 'AGREGAR HORNO' : 'CONECTAR'}
          </h1>
        </div>

        {hornos.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-neutral-500 uppercase tracking-wider">Hornos guardados</p>
            {hornos.map(h => (
              <button
                key={h.hornoId}
                onClick={() => { feedbackBoton(); setHornoActivo(h.hornoId); onVolver?.() }}
                className="w-full flex justify-between items-center px-4 py-3 bg-neutral-900 border border-neutral-800 hover:border-orange-500 rounded-lg transition active:scale-95 duration-75"
              >
                <div className="text-left">
                  <p className="text-white font-semibold">{h.nombre}</p>
                  <p className="text-xs text-neutral-500">{h.hornoId.slice(-6)}</p>
                </div>
                <span className="text-orange-500">→</span>
              </button>
            ))}
          </div>
        )}

        {onVolver && (
          <div className="space-y-2">
            <p className="text-xs text-neutral-400">
              Si el horno ya tiene WiFi configurado, presioná <span className="text-white font-semibold">Buscar hornos</span> — no hace falta cambiar de red.
            </p>
            <button
              onClick={() => setMostrarSinWifi(!mostrarSinWifi)}
              className="text-xs text-blue-400 hover:text-blue-300 transition underline"
            >
              {mostrarSinWifi ? 'Ocultar' : '¿No lo encontrás? Conectate directo al horno'}
            </button>
            {mostrarSinWifi && (
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 text-sm space-y-3 mt-1">
                <p className="text-neutral-300 font-semibold text-xs uppercase tracking-wider">Conexión directa</p>
                <ol className="text-neutral-400 text-xs space-y-1.5 list-decimal list-inside">
                  <li>Conectate a la red WiFi del horno: <span className="font-mono text-neutral-200">CERAMIENTAS_XXXX</span></li>
                  <li>Tocá "Detectar horno conectado" abajo.</li>
                  <li>Confirmá vincular — no hace falta escribir ningún ID.</li>
                </ol>

                <button
                  onClick={detectarHornoAP}
                  disabled={detectandoAP}
                  className="w-full py-2.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 rounded-lg text-sm font-semibold transition active:scale-95 duration-75"
                >
                  {detectandoAP ? 'Buscando...' : 'Detectar horno conectado'}
                </button>

                {hornoDetectadoAP && (
                  <div className="bg-neutral-800 border border-orange-600 rounded-lg p-3 flex justify-between items-center">
                    <div>
                      <p className="text-white font-semibold text-sm">{hornoDetectadoAP.nombre}</p>
                      <p className="text-xs text-neutral-400 font-mono">{hornoDetectadoAP.hornoId.slice(-6)}</p>
                    </div>
                    <button
                      onClick={vincularDetectadoAP}
                      className="px-3 py-2 bg-orange-500 hover:bg-orange-600 rounded-lg text-xs font-semibold transition active:scale-95 duration-75"
                    >
                      Vincular
                    </button>
                  </div>
                )}

                {errorAP && <p className="text-xs text-red-400">{errorAP}</p>}

                <div className="border-t border-neutral-800 pt-3">
                  <p className="text-neutral-300 font-semibold text-xs uppercase tracking-wider mb-2">¿Horno nuevo, sin WiFi de casa?</p>
                  <button
                    onClick={configurarWifiNuevo}
                    disabled={wifiNuevo === 'buscando'}
                    className="w-full py-2.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 rounded-lg text-sm font-semibold transition active:scale-95 duration-75"
                  >
                    {wifiNuevo === 'buscando' ? 'Buscando horno en AP...' : 'Configurarle WiFi de casa'}
                  </button>
                  {wifiNuevo === 'ok' && (
                    <p className="text-xs text-green-400 mt-2">
                      Página abierta. Ingresá las credenciales WiFi y guardá. Después volvé acá y tocá "Detectar horno conectado" o vinculalo ya y esperá que aparezca Online.
                    </p>
                  )}
                  {wifiNuevo === 'manual' && (
                    <p className="text-xs text-yellow-400 mt-2">
                      No se detectó el horno en modo AP. Asegurate de estar conectado a <span className="font-mono">CERAMIENTAS_XXXX</span> e intentá de nuevo.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className={hornos.length > 0 ? 'border-t border-neutral-800 pt-4' : ''}>
          <div className="space-y-3">

            <button
              onClick={buscarHornos}
              disabled={buscando}
              className="w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 rounded-lg font-semibold transition active:scale-95 duration-75"
            >
              {buscando ? `Buscando... ${countdown}s` : 'Buscar hornos'}
            </button>

            {hornosDetectados.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-neutral-500 uppercase tracking-wider">Detectados</p>
                {hornosDetectados.map(id => (
                  <button
                    key={id}
                    onClick={() => vincularHorno(id)}
                    disabled={buscando}
                    className="w-full flex justify-between items-center px-4 py-3 bg-neutral-900 border border-neutral-700 hover:border-orange-500 disabled:opacity-50 rounded-lg transition active:scale-95 duration-75"
                  >
                    <span className="text-neutral-300 font-mono text-sm">{id.slice(-6)}</span>
                    <span className="text-orange-500 text-sm">Vincular →</span>
                  </button>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="ID horno manual"
                value={hornoIdInput}
                onChange={(e) => setHornoIdInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && vincularHorno(hornoIdInput.trim())}
                className="flex-1 px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 font-mono text-sm"
              />
              <button
                onClick={() => vincularHorno(hornoIdInput.trim())}
                disabled={buscando || !hornoIdInput.trim()}
                className="px-4 py-3 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 rounded-lg font-semibold transition active:scale-95 duration-75"
              >
                Vincular
              </button>
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

          </div>
        </div>

        <p className="text-xs text-neutral-500 text-center">
          v0.1.0 · Requiere firmware v3.4.0+
        </p>

      </div>
    </div>
  )
}
