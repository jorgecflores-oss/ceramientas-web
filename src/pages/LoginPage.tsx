import { useState } from 'react'
import { useHornoStore } from '../store/hornoStore'
import { descubrirHornosMQTT } from '../services/mqttService'
import { verificarHornoMQTT } from '../services/hornoService'

export function LoginPage() {
  const hornos = useHornoStore((s) => s.hornos)
  const agregarHorno = useHornoStore((s) => s.agregarHorno)
  const setHornoActivo = useHornoStore((s) => s.setHornoActivo)

  const [hornoIdInput, setHornoIdInput] = useState('')
  const [hornosDetectados, setHornosDetectados] = useState<string[]>([])
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState('')

  async function buscarHornos() {
    setBuscando(true)
    setError('')
    setHornosDetectados([])
    try {
      const encontrados = await descubrirHornosMQTT(5000)
      if (encontrados.length === 0) {
        setError('No se detectaron hornos. Verificá que el horno esté encendido y conectado a internet.')
      }
      setHornosDetectados(encontrados)
    } catch {
      setError('Error buscando hornos')
    } finally {
      setBuscando(false)
    }
  }

  async function vincularHorno(hornoId: string) {
    if (!hornoId) return
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
    } catch {
      setError('Error vinculando horno')
    } finally {
      setBuscando(false)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">

        <div className="text-center">
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
                onClick={() => setHornoActivo(h.hornoId)}
                className="w-full flex justify-between items-center px-4 py-3 bg-neutral-900 border border-neutral-800 hover:border-orange-500 rounded-lg transition"
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
              className="w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 rounded-lg font-semibold transition"
            >
              {buscando ? 'Buscando...' : 'Buscar hornos'}
            </button>

            {hornosDetectados.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-neutral-500 uppercase tracking-wider">Detectados</p>
                {hornosDetectados.map(id => (
                  <button
                    key={id}
                    onClick={() => vincularHorno(id)}
                    disabled={buscando}
                    className="w-full flex justify-between items-center px-4 py-3 bg-neutral-900 border border-neutral-700 hover:border-orange-500 disabled:opacity-50 rounded-lg transition"
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
                className="px-4 py-3 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 rounded-lg font-semibold transition"
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
