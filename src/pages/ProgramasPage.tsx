import { useEffect, useState } from 'react'
import { useHornoStore } from '../store/hornoStore'
import { SelectorHorno } from '../components/SelectorHorno'
import { fetchProgramasOnce, postComando } from '../services/hornoService'
import { publicarComando } from '../services/mqttService'
import type { Programa, Paso } from '../types/horno'

const pasoActivo = (p: Paso) => p.velocidad !== 0 || p.temperatura !== 0 || p.tiempo !== 0
const tieneActivos = (prog: Programa) => prog.pasos.some(pasoActivo)

function duracionTotal(pasos: Paso[]): string {
  let totalMin = 0
  let tempActual = 20
  for (const p of pasos) {
    if (!pasoActivo(p)) continue
    const velPorMin = Math.abs(p.velocidad) / 10
    const delta = p.temperatura - tempActual
    if (velPorMin > 0 && Math.abs(delta) > 0.5) {
      totalMin += Math.abs(delta) / velPorMin
    }
    totalMin += p.tiempo
    tempActual = p.temperatura
  }
  const h = Math.floor(totalMin / 60)
  const m = Math.round(totalMin % 60)
  return `${h}:${m.toString().padStart(2, '0')} hs`
}

const formatVel = (v: number) => `${(v / 10).toFixed(1)}°C/min`

export function ProgramasPage() {
  const horno = useHornoStore(s => s.hornoActivo)
  const pass = useHornoStore(s => s.password)
  const programas = useHornoStore(s => s.programas)
  const setProgramas = useHornoStore(s => s.setProgramas)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!horno?.ip || !pass || !horno?.hornoId) return
    if (programas.length > 0) return
    setCargando(true)
    fetchProgramasOnce(horno.ip, pass, horno.hornoId)
      .then(p => setProgramas(p))
      .catch(e => setError(String(e)))
      .finally(() => setCargando(false))
  }, [horno?.ip, horno?.hornoId, pass, programas.length, setProgramas])

  async function ejecutar(idx: number) {
    if (!horno) return
    const ok = publicarComando(horno.hornoId, `ejecutar:${idx}`)
    if (!ok && horno.ip && pass) {
      try {
        await postComando(horno.ip, pass, `ejecutar:${idx}`)
      } catch (e) {
        alert('Error ejecutando programa')
      }
    }
  }

  const programasVisibles = programas
    .map((p, idx) => ({ ...p, idx }))
    .filter(p => tieneActivos(p))

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-6 pb-24">
      <div className="max-w-md mx-auto">
        <header className="mb-6 flex justify-between items-start">
          <div>
            <p className="text-xs text-neutral-400 tracking-widest uppercase">ceramientas</p>
            <h1 className="text-2xl font-bold tracking-widest mt-1">PROGRAMAS</h1>
            <p className="text-sm text-neutral-400 mt-1">{horno?.nombre}</p>
          </div>
          <button
            disabled
            className="px-4 py-2 bg-orange-500 opacity-50 rounded-full text-sm font-semibold cursor-not-allowed"
          >
            + Nuevo
          </button>
        </header>

        <SelectorHorno />

        {cargando && <p className="text-center text-neutral-500 py-8">Cargando...</p>}
        {error && <p className="text-center text-red-400 py-4">{error}</p>}
        {!cargando && programasVisibles.length === 0 && (
          <p className="text-center text-neutral-500 py-8">Sin programas</p>
        )}

        <div className="space-y-3">
          {programasVisibles.map(p => {
            const esPredef = p.idx < 4
            const badgeColor = esPredef
              ? 'bg-orange-500/20 text-orange-400'
              : 'bg-green-500/20 text-green-400'
            const badgeLabel = esPredef ? 'Predefinido' : 'Personal'
            const tempFinalMostrar = p.tempFinal ?? p.pasos.filter(pasoActivo).slice(-1)[0]?.temperatura ?? 0

            return (
              <div key={p.idx} className="bg-neutral-900 rounded-xl p-4 border border-neutral-800">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h3 className="font-bold text-lg">{p.nombre}</h3>
                    <span className={`inline-block px-2 py-0.5 text-xs rounded-full mt-1 ${badgeColor}`}>
                      {badgeLabel} · {duracionTotal(p.pasos)}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-neutral-400">Temp final</p>
                    <p className="text-orange-500 font-bold text-lg">{tempFinalMostrar}°C ✎</p>
                    {!esPredef && (
                      <button
                        disabled
                        className="text-neutral-500 mt-2 cursor-not-allowed"
                        title="Borrar (proximamente)"
                      >
                        🗑
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-1 mb-3 mt-3 border-t border-neutral-800 pt-3">
                  {p.pasos.filter(pasoActivo).map((paso, i) => (
                    <div key={i} className="text-sm flex gap-2 text-neutral-300">
                      <span className="text-orange-500 font-semibold w-6">P{i + 1}</span>
                      <span>↑ {formatVel(paso.velocidad)}</span>
                      <span>→ {paso.temperatura}°C</span>
                      {paso.tiempo > 0 && <span>⏱ {paso.tiempo}min</span>}
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => ejecutar(p.idx)}
                  className="w-full py-2 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500 rounded-lg text-orange-500 font-semibold transition"
                >
                  🔥 Ejecutar
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
