import { useEffect, useState, useCallback } from 'react'
import { useHornoStore } from '../store/hornoStore'
import { SelectorHorno } from '../components/SelectorHorno'
import { getHistorial, getHistorialCache, deleteHistorialItem, deleteHistorialAll } from '../services/historialService'
import type { Horneada } from '../types/horno'

const MOTIVO_INFO: Record<string, { texto: string; color: string }> = {
  normal:               { texto: '✓ Finalizado normalmente', color: 'text-green-500'  },
  alarma_exceso:        { texto: '⚠ Exceso de temp. final',  color: 'text-yellow-500' },
  alarma_critica:       { texto: '🚨 Temp. máxima superada', color: 'text-red-500'    },
  detenido:             { texto: '⏹ Detenido manualmente',   color: 'text-blue-400'   },
  emergencia:           { texto: '⚡ Apagado de emergencia',  color: 'text-orange-500' },
  detenido_manualment:  { texto: '⏹ Detenido manualmente',   color: 'text-blue-400'   },
  detenido_manualmente: { texto: '⏹ Detenido manualmente',   color: 'text-blue-400'   },
  cancelado_usuario:    { texto: '⏹ Detenido manualmente',   color: 'text-blue-400'   },
}

function formatearFecha(timestamp: number): string {
  if (!timestamp) return 'Sin fecha'
  const fecha = new Date(timestamp * 1000)
  if (isNaN(fecha.getTime()) || fecha.getFullYear() < 2020) return 'Sin fecha'
  return fecha.toLocaleDateString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatearDuracion(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}min`
}

function ModalConfirmar({ titulo, mensaje, onCancelar, onConfirmar }: {
  titulo: string; mensaje: string; onCancelar: () => void; onConfirmar: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-6">
      <div className="bg-neutral-900 rounded-2xl p-6 max-w-sm w-full border border-neutral-800">
        <h3 className="font-bold text-lg mb-2">{titulo}</h3>
        <p className="text-sm text-neutral-400 mb-6">{mensaje}</p>
        <div className="flex gap-2">
          <button
            onClick={onCancelar}
            className="flex-1 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirmar}
            className="flex-1 py-2 bg-red-600 hover:bg-red-700 rounded-lg font-semibold transition"
          >
            Borrar
          </button>
        </div>
      </div>
    </div>
  )
}

export function HistorialPage() {
  const horno = useHornoStore(s => s.hornoActivo)
  const pass = useHornoStore(s => s.password)

  const [historial, setHistorial] = useState<Horneada[]>([])
  const [cargando, setCargando] = useState(false)
  const [expandido, setExpandido] = useState<string | null>(null)
  const [confirmarBorrarTodo, setConfirmarBorrarTodo] = useState(false)
  const [confirmarBorrarItem, setConfirmarBorrarItem] = useState<Horneada | null>(null)

  const cargar = useCallback(async () => {
    if (!horno?.hornoId || !horno.ip || !pass) return
    setCargando(true)
    try {
      const data = await getHistorial(horno.hornoId, horno.ip, pass)
      setHistorial(data)
    } catch (e) {
      console.error('[historial]', e)
    } finally {
      setCargando(false)
    }
  }, [horno?.hornoId, horno?.ip, pass])

  useEffect(() => {
    const hornoId = horno?.hornoId ?? ''
    const cached = getHistorialCache(hornoId)
    if (cached.length > 0) setHistorial(cached)
    cargar()
  }, [cargar, horno?.hornoId])

  const totalKwh   = historial.reduce((s, h) => s + (h.kWhConsumidos || 0), 0)
  const totalCosto = historial.reduce((s, h) => s + (h.costo         || 0), 0)

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-6 pb-24">
      <div className="max-w-md mx-auto">

        <header className="mb-6 flex justify-between items-start">
          <div>
            <p className="text-xs text-neutral-400 tracking-widest uppercase">ceramientas</p>
            <h1 className="text-2xl font-bold text-white mt-1">{horno?.nombre ?? '—'}</h1>
            {horno?.potencia && (
              <p className="text-sm text-neutral-400 mt-1">{horno.potencia} W</p>
            )}
          </div>
          {historial.length > 0 && (
            <button
              onClick={() => setConfirmarBorrarTodo(true)}
              className="px-3 py-2 border border-red-500/50 text-red-400 rounded-lg text-xs hover:bg-red-500/10 transition"
            >
              🗑 Borrar todo
            </button>
          )}
        </header>

        <SelectorHorno />

        {historial.length > 0 && (
          <div className="bg-neutral-900 rounded-xl p-4 mb-6 border border-neutral-800">
            <p className="text-xs text-neutral-400 uppercase tracking-wider mb-3">Resumen total</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-2xl font-bold">{historial.length}</p>
                <p className="text-xs text-neutral-400 mt-1">horneadas</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{totalKwh.toFixed(1)}</p>
                <p className="text-xs text-neutral-400 mt-1">kWh total</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-orange-500">
                  ${Math.round(totalCosto).toLocaleString('es-AR')}
                </p>
                <p className="text-xs text-neutral-400 mt-1">costo total</p>
              </div>
            </div>
          </div>
        )}

        {cargando && historial.length === 0 && (
          <p className="text-center text-neutral-500 py-8">Cargando...</p>
        )}

        {!cargando && historial.length === 0 && (
          <div className="text-center py-12">
            <p className="text-6xl mb-4">🏺</p>
            <p className="text-neutral-300 font-semibold">Todavía no hay horneadas registradas</p>
            <p className="text-sm text-neutral-500 mt-2">Aparecerán aquí al finalizar cada proceso</p>
          </div>
        )}

        <div className="space-y-2">
          {historial.map(item => {
            const info = MOTIVO_INFO[item.motivo] ?? { texto: item.motivo || 'Desconocido', color: 'text-neutral-400' }
            const abierta = expandido === item.id

            return (
              <div key={item.id} className="bg-neutral-900 rounded-xl border border-neutral-800 overflow-hidden">
                <div
                  onClick={() => setExpandido(abierta ? null : item.id)}
                  className="w-full p-3 flex items-start justify-between text-left cursor-pointer"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setExpandido(abierta ? null : item.id)
                    }
                  }}
                >
                  <div className="flex-1 min-w-0 pr-2">
                    <p className="font-semibold truncate">{item.programa || 'Programa desconocido'}</p>
                    <p className={`text-xs mt-1 ${info.color}`}>{info.texto}</p>
                    <p className="text-xs text-neutral-500 mt-1">{formatearFecha(item.timestamp)}</p>
                  </div>
                  <div className="text-right shrink-0 mr-2">
                    <p className="text-orange-500 font-bold text-lg">{item.tempMax || '--'}°C</p>
                    <p className="text-xs text-neutral-500">temp máx</p>
                  </div>
                  <div className="flex flex-col items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmarBorrarItem(item) }}
                      className="text-neutral-500 hover:text-red-400 transition p-1"
                    >
                      🗑
                    </button>
                    <span className="text-neutral-500 text-xs">{abierta ? '▲' : '▼'}</span>
                  </div>
                </div>

                {abierta && (
                  <div className="border-t border-neutral-800 p-3 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-xs text-neutral-400 uppercase tracking-wider">Duración</p>
                      <p className="text-sm font-semibold mt-1">
                        {formatearDuracion(item.duracionHoras, item.duracionMinutos)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-neutral-400 uppercase tracking-wider">Consumo</p>
                      <p className="text-sm font-semibold mt-1">{item.kWhConsumidos.toFixed(1)} kWh</p>
                    </div>
                    <div>
                      <p className="text-xs text-neutral-400 uppercase tracking-wider">Costo</p>
                      <p className="text-sm font-semibold text-orange-500 mt-1">
                        ${item.costo.toLocaleString('es-AR')}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

      </div>

      {confirmarBorrarTodo && (
        <ModalConfirmar
          titulo="¿Borrar todo el historial?"
          mensaje="Esta acción no se puede deshacer."
          onCancelar={() => setConfirmarBorrarTodo(false)}
          onConfirmar={async () => {
            if (horno?.ip && pass) {
              try {
                await deleteHistorialAll(horno.hornoId, horno.ip, pass)
                setHistorial([])
              } catch {
                alert('Error borrando historial')
              }
            }
            setConfirmarBorrarTodo(false)
          }}
        />
      )}

      {confirmarBorrarItem && (
        <ModalConfirmar
          titulo="¿Borrar horneada?"
          mensaje={`${confirmarBorrarItem.programa || 'Programa desconocido'} — ${formatearFecha(confirmarBorrarItem.timestamp)}`}
          onCancelar={() => setConfirmarBorrarItem(null)}
          onConfirmar={() => {
            if (horno) {
              deleteHistorialItem(horno.hornoId, confirmarBorrarItem.timestamp)
              setHistorial(prev => prev.filter(r => r.timestamp !== confirmarBorrarItem.timestamp))
            }
            setConfirmarBorrarItem(null)
          }}
        />
      )}
    </div>
  )
}
