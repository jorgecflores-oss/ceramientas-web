import { useEffect, useState } from 'react'
import { useHornoStore } from '../store/hornoStore'
import { SelectorHorno } from '../components/SelectorHorno'
import { getConfig, postComando, postConfig } from '../services/hornoService'
import { publicarComando } from '../services/mqttService'

export function ConfigPage() {
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

  useEffect(() => {
    if (!horno?.ip || !pass) return
    getConfig(horno.ip, pass)
      .then(cfg => {
        setPotencia(String(cfg.potencia ?? 6000))
        setFactura(String(cfg.factura ?? 71000))
        setConsumo(String(cfg.consumo ?? 520))
        setVersionFw(cfg.versionFirmware ?? null)
      })
      .catch(e => console.error('[getConfig]', e))
  }, [horno?.hornoId, horno?.ip, pass])

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

    setGuardando(true)
    try {
      if (!horno) return
      const cmd = `setconfig:potencia=${potR},factura=${facR},consumo=${conR}`
      const ok = publicarComando(horno.hornoId, cmd)
      if (!ok && horno.ip && pass) {
        await postComando(horno.ip, pass, cmd)
      }
      alert('Guardado')
    } catch {
      alert('Error guardando')
    } finally {
      setGuardando(false)
    }
  }

  async function guardarNombre() {
    if (!horno?.ip || !pass || !nombreInput.trim()) return
    setGuardandoNombre(true)
    try {
      await postConfig(horno.ip, pass, { nombre: nombreInput.trim() })
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
                className="px-3 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 rounded text-sm font-semibold"
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
              className="w-full mt-6 py-3 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 rounded-xl font-semibold transition"
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
                disabled
                className="w-full flex items-center gap-4 py-3 border-b border-neutral-800 opacity-50 cursor-not-allowed"
              >
                <span className="text-2xl">🔍</span>
                <div className="flex-1 text-left">
                  <p className="text-white text-sm font-semibold">Buscar hornos</p>
                  <p className="text-xs text-neutral-500 mt-0.5">Re-descubrir hornos en la red local</p>
                </div>
                <span className="text-neutral-600">›</span>
              </button>

              <button
                disabled
                className="w-full flex items-center gap-4 py-3 border-b border-neutral-800 opacity-50 cursor-not-allowed"
              >
                <span className="text-2xl">📡</span>
                <div className="flex-1 text-left">
                  <p className="text-white text-sm font-semibold">Configurar WiFi</p>
                  <p className="text-xs text-neutral-500 mt-0.5">Conectar el controlador a una red nueva</p>
                </div>
                <span className="text-neutral-600">›</span>
              </button>

              <button
                disabled
                className="w-full flex items-center gap-4 py-3 border-b border-neutral-800 opacity-50 cursor-not-allowed"
              >
                <span className="text-2xl">⬆️</span>
                <div className="flex-1 text-left">
                  <p className="text-white text-sm font-semibold">Actualizar firmware</p>
                  <p className="text-xs text-neutral-500 mt-0.5">Instalar nueva versión OTA</p>
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
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 rounded-lg font-semibold transition"
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
