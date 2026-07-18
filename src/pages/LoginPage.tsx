import { useState, useEffect, useRef } from 'react'
import { useHornoStore } from '../store/hornoStore'
import { descubrirHornosMQTT } from '../services/mqttService'
import { verificarHornoMQTT, getInfo } from '../services/hornoService'
import { feedbackBoton } from '../utils/feedback'
import { AP_IP } from '../utils/constants'
import type { InfoHorno } from '../types/horno'

interface Props {
  onVolver?: () => void
  onVinculadoSinInternet?: () => void
}

export function LoginPage({ onVolver, onVinculadoSinInternet }: Props) {
  const hornos = useHornoStore((s) => s.hornos)
  const agregarHorno = useHornoStore((s) => s.agregarHorno)
  const setHornoActivo = useHornoStore((s) => s.setHornoActivo)

  const [hornoIdInput, setHornoIdInput] = useState('')
  const [hornosDetectados, setHornosDetectados] = useState<string[]>([])
  const [buscando, setBuscando] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [error, setError] = useState('')
  const [hornoDetectadoAP, setHornoDetectadoAP] = useState<InfoHorno | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => { if (countdownRef.current) clearInterval(countdownRef.current) }, [])

  async function detectarHornoAP() {
    try {
      const info = await getInfo(AP_IP)
      setHornoDetectadoAP(info)
    } catch {
      setHornoDetectadoAP(null)
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
    onVinculadoSinInternet ? onVinculadoSinInternet() : onVolver?.()
  }

  const BUSQUEDA_MS = 32000

  async function buscarHornos() {
    feedbackBoton()
    setBuscando(true)
    setError('')
    setHornosDetectados([])
    setHornoDetectadoAP(null)
    detectarHornoAP()
    setCountdown(Math.round(BUSQUEDA_MS / 1000))
    if (countdownRef.current) clearInterval(countdownRef.current)
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { clearInterval(countdownRef.current!); return 0 }
        return c - 1
      })
    }, 1000)
    try {
      const encontrados = await descubrirHornosMQTT(BUSQUEDA_MS, (id) => {
        setHornosDetectados((prev) => prev.includes(id) ? prev : [...prev, id])
      })
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

        <div className={hornos.length > 0 ? 'border-t border-neutral-800 pt-4' : ''}>
          <div className="space-y-3">

            <button
              onClick={buscarHornos}
              disabled={buscando}
              className="w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 rounded-lg font-semibold transition active:scale-95 duration-75"
            >
              {buscando ? `Buscando... ${countdown}s` : 'Buscar hornos'}
            </button>

            <p className="text-xs text-neutral-500">
              Si es un horno nuevo o no aparece, conectate a su red <span className="font-mono text-neutral-300">CERAMIENTAS_XXXX</span> y{' '}
              <button
                onClick={() => window.open(`http://${AP_IP}/`, '_blank')}
                className="text-orange-400 underline underline-offset-2"
              >
                abrí la configuración WiFi
              </button>{' '}
              directo desde ahí.
            </p>

            {hornoDetectadoAP && (
              <div className="bg-neutral-800 border border-orange-600 rounded-lg p-3 flex justify-between items-center">
                <div>
                  <p className="text-white font-semibold text-sm">{hornoDetectadoAP.nombre}</p>
                  <p className="text-xs text-neutral-400 font-mono">{hornoDetectadoAP.hornoId.slice(-6)} · conexión directa</p>
                </div>
                <button
                  onClick={vincularDetectadoAP}
                  className="px-3 py-2 bg-orange-500 hover:bg-orange-600 rounded-lg text-xs font-semibold transition active:scale-95 duration-75"
                >
                  Vincular
                </button>
              </div>
            )}

            {hornosDetectados.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-neutral-500 uppercase tracking-wider">Detectados</p>
                {hornosDetectados.map(id => (
                  <button
                    key={id}
                    onClick={() => vincularHorno(id)}
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
