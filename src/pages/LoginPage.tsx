import { useState } from 'react'
import { useHornoStore } from '../store/hornoStore'
import { descubrirHornosMQTT } from '../services/mqttService'
import { verificarHornoMQTT, hornoRequest } from '../services/hornoService'
import { feedbackBoton } from '../utils/feedback'
import { AP_IP, STORAGE_KEYS } from '../utils/constants'

interface Props {
  onVolver?: () => void
}

// Único procedimiento de vinculación (Android, iPhone, cualquier teléfono):
//  1) Conectar el horno a un WiFi con internet (desde su red CERAMIENTAS_XXXX).
//  2) Escribir en la app el código XXXX que muestra esa red / la pantalla del horno.
// La app busca el horno por internet (MQTT), prueba su clave y lo vincula.
export function LoginPage({ onVolver }: Props) {
  const hornos = useHornoStore((s) => s.hornos)
  const agregarHorno = useHornoStore((s) => s.agregarHorno)
  const setHornoActivo = useHornoStore((s) => s.setHornoActivo)

  const [hornoIdInput, setHornoIdInput] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState('')



  // Código corto = últimos 4 (o 6) caracteres del ID, el mismo que lleva la red CERAMIENTAS_XXXX
  // y se ve en la pantalla del horno. Se busca por MQTT entre los hornos publicando y se vincula
  // con la pass derivada (vincularHorno prueba la derivada y la invertida).
  async function vincularPorCodigo(codigo: string) {
    feedbackBoton()
    const sufijo = codigo.toLowerCase()
    setBuscando(true)
    setError('')
    let hallado: string | null = null
    try {
      // Con 6 caracteres el horno es único: cortar apenas aparece. Con 4 esperar y detectar choques.
      const todos = await descubrirHornosMQTT(
        sufijo.length >= 6 ? 20000 : 10000,
        undefined,
        (id) => sufijo.length >= 6 && id.toLowerCase().endsWith(sufijo),
      )
      const coinciden = todos.filter(id => id.toLowerCase().endsWith(sufijo))
      if (coinciden.length > 1) {
        setError('Hay más de un horno con ese código. Escribí los últimos 6 caracteres del ID.')
        setBuscando(false)
        return
      }
      hallado = coinciden[0] ?? null
    } catch {
      setError('Error buscando el horno')
      setBuscando(false)
      return
    }
    if (!hallado) {
      setError('No apareció ese horno. Tiene que estar encendido, con WiFi e internet, y el teléfono también con internet.')
      setBuscando(false)
      return
    }
    await vincularHorno(hallado)
  }

  async function vincularHorno(entrada: string) {
    if (!entrada) return
    if (/^[0-9a-f]{4,6}$/i.test(entrada.trim())) { await vincularPorCodigo(entrada.trim()); return }
    feedbackBoton()
    setBuscando(true)
    setError('')
    const [hornoId, passExplicita] = entrada.includes(':')
      ? entrada.split(':').map(s => s.trim())
      : [entrada.trim(), undefined]
    try {
      const result = await verificarHornoMQTT(hornoId, passExplicita)
      if (!result.ok) {
        if (result.razon === 'timeout') setError('Horno sin conexión. Verificá que esté encendido y con wifi.')
        else if (result.razon === 'auth') setError('Contraseña incorrecta. Probá con ID:contraseña.')
        else setError('Horno no responde. Verificá el ID y que el horno esté encendido.')
        return
      }
      try {
        const reclamo = await hornoRequest(hornoId, 'config', 'POST', JSON.stringify({ reclamar: true }))
        const data = reclamo.data as { nuevaPass?: string }
        if (data.nuevaPass) localStorage.setItem(STORAGE_KEYS.PASS(hornoId), data.nuevaPass)
      } catch {
        localStorage.removeItem(STORAGE_KEYS.PASS(hornoId))
        setError('Pass incorrecta. Pedí el ID actualizado a quien te lo compartió.')
        return
      }
      agregarHorno({
        hornoId,
        nombre: result.nombre ?? hornoId,
        version: result.version,
      }, localStorage.getItem(STORAGE_KEYS.PASS(hornoId)) ?? '')
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
              <div
                key={h.hornoId}
                className="bg-neutral-900 border border-neutral-800 hover:border-orange-500 rounded-lg transition"
              >
                <button
                  onClick={() => { feedbackBoton(); setHornoActivo(h.hornoId); onVolver?.() }}
                  className="w-full flex justify-between items-center px-4 py-3 active:scale-95 duration-75"
                >
                  <div className="text-left">
                    <p className="text-white font-semibold">{h.nombre}</p>
                    <p className="text-xs text-neutral-500">{h.hornoId.slice(-6)}</p>
                  </div>
                  <span className="text-orange-500">→</span>
                </button>
                <div className="px-4 pb-3 border-t border-neutral-800 pt-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-neutral-300 font-mono text-[11px] break-all select-all">
                      {h.hornoId}
                    </p>
                    <button
                      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(h.hornoId) }}
                      className="shrink-0 text-xs text-neutral-300 bg-neutral-700 hover:bg-neutral-600 px-3 py-1.5 rounded-lg transition-colors font-medium"
                    >
                      Copiar ID
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-orange-400 font-mono text-[11px] break-all select-all">
                      ceramientas-{h.hornoId}
                    </p>
                    <button
                      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(`ceramientas-${h.hornoId}`) }}
                      className="shrink-0 text-xs text-neutral-300 bg-neutral-700 hover:bg-neutral-600 px-3 py-1.5 rounded-lg transition-colors font-medium"
                    >
                      Copiar
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className={hornos.length > 0 ? 'border-t border-neutral-800 pt-4' : ''}>
          <div className="space-y-4">

            <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-3 space-y-2">
              <p className="text-xs text-neutral-500 uppercase tracking-wider">Cómo vincular un horno</p>
              <ol className="text-sm text-neutral-300 space-y-2 list-decimal list-inside">
                <li>
                  Conectá el teléfono a la red <span className="font-mono text-neutral-100">CERAMIENTAS_XXXX</span>{' '}
                  del horno (clave <span className="font-mono text-neutral-100">ceramientas</span>) y{' '}
                  <button
                    onClick={() => window.open(`http://${AP_IP}/`, '_blank')}
                    className="text-orange-400 underline underline-offset-2"
                  >
                    abrí la configuración WiFi
                  </button>{' '}
                  para conectar el horno a tu WiFi. Si ya está conectado, salteá este paso.
                </li>
                <li>Volvé a tu WiFi (o datos móviles) con internet.</li>
                <li>
                  Escribí abajo las 4 letras o números finales del nombre de la red
                  (<span className="font-mono text-neutral-100">CERAMIENTAS_<b className="text-orange-400">XXXX</b></span>)
                  y tocá Vincular.
                </li>
              </ol>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                inputMode="text"
                autoCapitalize="none"
                autoCorrect="off"
                maxLength={64}
                placeholder="Código del horno (XXXX)"
                value={hornoIdInput}
                onChange={(e) => setHornoIdInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && vincularHorno(hornoIdInput.trim())}
                className="flex-1 px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500 font-mono text-sm"
              />
              <button
                onClick={() => vincularHorno(hornoIdInput.trim())}
                disabled={buscando || !hornoIdInput.trim()}
                className="px-4 py-3 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 rounded-lg font-semibold transition active:scale-95 duration-75"
              >
                {buscando ? 'Buscando…' : 'Vincular'}
              </button>
            </div>

            {buscando && (
              <p className="text-xs text-neutral-500">Buscando el horno por internet. Puede tardar hasta 20 segundos.</p>
            )}

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
