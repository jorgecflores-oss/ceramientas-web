import { useState } from 'react'
import { useHornoStore } from '../store/hornoStore'
import { getInfo, cacheIP, probeAP } from '../services/hornoService'
import { AP_IP } from '../utils/constants'

export function LoginPage() {
  const hornos = useHornoStore((s) => s.hornos)
  const agregarHorno = useHornoStore((s) => s.agregarHorno)
  const setHornoActivo = useHornoStore((s) => s.setHornoActivo)
  const [ip, setIp] = useState('')
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function detectarAP() {
    setLoading(true)
    setError('')
    try {
      const ok = await probeAP()
      if (ok) {
        setIp(AP_IP)
      } else {
        setError('AP no detectado')
      }
    } catch (e) {
      setError('Error detectando AP')
    } finally {
      setLoading(false)
    }
  }

  async function conectar() {
    if (!ip || !pass) {
      setError('IP y password requeridos')
      return
    }
    setLoading(true)
    setError('')
    try {
      const info = await getInfo(ip)
      const passEsperado = info.hornoId.slice(-6)
      if (pass !== passEsperado) {
        setError('Password incorrecto')
        setLoading(false)
        return
      }
      cacheIP(info.hornoId, ip)
      const nuevoHorno = {
        hornoId: info.hornoId,
        nombre: info.nombre,
        ip,
        version: info.version,
      }
      agregarHorno(nuevoHorno, pass)
      setHornoActivo(info.hornoId)
    } catch (e: any) {
      setError(`No responde: ${e.message}`)
    } finally {
      setLoading(false)
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
          <div className="space-y-2 mb-6">
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

        <div className={hornos.length > 0 ? 'border-t border-neutral-800 pt-4 mt-4' : ''}>
        <div className="space-y-3">
          <input
            type="text"
            placeholder="IP del horno (ej: 192.168.1.39)"
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            className="w-full px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500"
          />

          <input
            type="password"
            placeholder="Password (últimos 6 hex MAC)"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            className="w-full px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500"
          />

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            onClick={conectar}
            disabled={loading}
            className="w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 rounded-lg font-semibold transition"
          >
            {loading ? 'Conectando...' : 'CONECTAR'}
          </button>

          <button
            onClick={detectarAP}
            disabled={loading}
            className="w-full py-3 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 rounded-lg text-sm transition"
          >
            Detectar AP local
          </button>
        </div>
        </div>

        <p className="text-xs text-neutral-500 text-center">
          v0.1.0 · Requiere firmware v3.4.0+
        </p>
      </div>
    </div>
  )
}