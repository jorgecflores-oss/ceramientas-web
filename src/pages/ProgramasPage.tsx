import { useEffect, useState } from 'react'
import { useHornoStore } from '../store/hornoStore'
import { SelectorHorno } from '../components/SelectorHorno'
import { fetchProgramasOnce, postComando, postPrograma, deletePrograma } from '../services/hornoService'
import { publicarComando } from '../services/mqttService'
import { STORAGE_KEYS } from '../utils/constants'
import { feedbackBoton } from '../utils/feedback'
import type { Programa, Paso } from '../types/horno'

const pasoActivo = (p: Paso) => p.velocidad !== 0 || p.temperatura !== 0 || p.tiempo !== 0
const tieneActivos = (prog: Programa) => prog.pasos.some(pasoActivo)

function normalizarSignosRampa(pasos: Paso[]): Paso[] {
  return pasos.map((paso, i) => {
    if (i === 0) return paso
    const anterior = pasos[i - 1]
    if (paso.velocidad > 0 && paso.temperatura < anterior.temperatura) {
      return { ...paso, velocidad: -paso.velocidad }
    }
    return paso
  })
}

// Aplica tempFinal al último paso activo, igual que matchPrograma.
function pasosEfectivos(prog: Programa): Paso[] {
  const activos = prog.pasos.filter(pasoActivo)
  if ((prog.tempFinal ?? 0) > 0 && activos.length > 0) {
    const lastActivo = activos[activos.length - 1]
    const lastIdx = prog.pasos.lastIndexOf(lastActivo)
    const result = [...prog.pasos]
    result[lastIdx] = { ...result[lastIdx], temperatura: prog.tempFinal! }
    return result
  }
  return prog.pasos
}

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
  const programas = useHornoStore(s => s.programas)
  const setProgramas = useHornoStore(s => s.setProgramas)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  // Edición inline de tempFinal
  const [editTF, setEditTF] = useState<{ idx: number; valor: string } | null>(null)
  const [guardandoTF, setGuardandoTF] = useState(false)

  // Confirmación borrar
  const [confirmarBorrar, setConfirmarBorrar] = useState<number | null>(null)

  // Modal edición pasos (solo programas custom idx >= 4)
  const [editPasos, setEditPasos] = useState<{ idx: number; nombre: string; pasos: Paso[]; velTexto: string[] } | null>(null)
  const [guardandoPasos, setGuardandoPasos] = useState(false)

  // Modal nuevo programa
  const [nuevoPrograma, setNuevoPrograma] = useState<{ nombre: string; pasos: Paso[]; velTexto: string[] } | null>(null)
  const [guardandoNuevo, setGuardandoNuevo] = useState(false)

  useEffect(() => {
    if (!horno?.hornoId) return
    setCargando(true)
    fetchProgramasOnce(horno.hornoId)
      .then(p => setProgramas(p))
      .catch(e => setError(String(e)))
      .finally(() => setCargando(false))
  }, [horno?.hornoId, setProgramas])

  function slotLibre(): number | null {
    for (let i = 4; i <= 23; i++) {
      if (!programas[i] || !tieneActivos(programas[i])) return i
    }
    return null
  }

  function actualizarLocal(idx: number, cambios: Partial<Programa>) {
    const nuevos = programas.map((p, i) => i === idx ? { ...p, ...cambios } : p)
    setProgramas(nuevos)
    if (horno?.hornoId) {
      localStorage.setItem(STORAGE_KEYS.PROGRAMAS_CACHE(horno.hornoId), JSON.stringify(nuevos))
    }
  }

  async function ejecutar(idx: number) {
    if (!horno) return
    feedbackBoton()
    localStorage.setItem(STORAGE_KEYS.ULTIMO_PROG(horno.hornoId), String(idx))
    // Programas custom: re-enviar pasos al firmware antes de ejecutar para garantizar
    // que la EEPROM tiene los datos actuales (la escritura puede tener lag).
    if (idx >= 4 && programas[idx]) {
      const p = programas[idx]
      try {
        await postPrograma(horno.hornoId, idx, { nombre: p.nombre, pasos: p.pasos })
      } catch {
        // Si falla, ejecutar igual — el usuario ya guardó antes
      }
    }
    const ok = publicarComando(horno.hornoId, `ejecutar:${idx}`)
    if (!ok) {
      try {
        await postComando(horno.hornoId, `ejecutar:${idx}`)
      } catch {
        alert('Error ejecutando programa')
      }
    }
  }

  async function guardarTempFinal() {
    if (!editTF || !horno?.hornoId) return
    const valor = parseInt(editTF.valor, 10)
    if (isNaN(valor) || valor < 100 || valor > 1300) {
      alert('Temperatura inválida (100–1300°C)')
      return
    }
    feedbackBoton()
    setGuardandoTF(true)
    try {
      await postPrograma(horno.hornoId, editTF.idx, { tempFinal: valor })
      actualizarLocal(editTF.idx, { tempFinal: valor })
      setEditTF(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error guardando temperatura'
      const esBugMQTT = msg.toLowerCase().includes('rango') || msg.toLowerCase().includes('tempfinal')
      if (esBugMQTT) {
        alert('No se pudo guardar: el horno no está accesible por la red local.\n\nConfigurá la IP del horno en Ajustes → IP local, o conectate al hotspot del horno (red CERAMIENTAS_' + (horno?.hornoId?.slice(-4) ?? '????') + ').')
      } else {
        alert(msg)
      }
    } finally {
      setGuardandoTF(false)
    }
  }

  async function borrarPrograma(idx: number) {
    if (!horno?.hornoId) return
    feedbackBoton()
    try {
      await deletePrograma(horno.hornoId, idx)
      const nuevos = programas.filter((_, i) => i !== idx)
      setProgramas(nuevos)
      if (horno.hornoId) {
        localStorage.setItem(STORAGE_KEYS.PROGRAMAS_CACHE(horno.hornoId), JSON.stringify(nuevos))
      }
    } catch {
      alert('Error borrando programa')
    } finally {
      setConfirmarBorrar(null)
    }
  }

  async function guardarPasos() {
    if (!editPasos || !horno?.hornoId) return
    const nombre = editPasos.nombre.trim()
    if (!nombre) { alert('El nombre no puede estar vacío'); return }
    const activos = editPasos.pasos.filter(pasoActivo)
    const invalido = activos.find(p => p.temperatura < 30 || p.temperatura > 1300)
    if (invalido) {
      alert(`Temperatura inválida: ${invalido.temperatura}°C (rango 30–1300°C)`)
      return
    }
    feedbackBoton()
    setGuardandoPasos(true)
    try {
      const pasosNormalizados = normalizarSignosRampa(editPasos.pasos)
      await postPrograma(horno.hornoId, editPasos.idx, { nombre, pasos: pasosNormalizados })
      const tempFinal = [...pasosNormalizados].reverse().find(p => p.temperatura > 0)?.temperatura ?? 0
      actualizarLocal(editPasos.idx, { nombre, pasos: pasosNormalizados, tempFinal })
      setEditPasos(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error guardando pasos'
      // El firmware rechaza el cuerpo MQTT por un bug de parseo (no por nombre inválido).
      // Si el nombre es válido, el problema es que no hay conexión directa.
      if (nombre && msg.toLowerCase().includes('nombre')) {
        alert('No se pudo guardar: el horno no está accesible por la red local.\n\nConfigurá la IP del horno en Ajustes → IP local, o conectate al hotspot del horno (red CERAMIENTAS_' + (horno?.hornoId?.slice(-4) ?? '????') + ').')
      } else {
        alert(msg)
      }
    } finally {
      setGuardandoPasos(false)
    }
  }

  function editarNuevoPaso(pasoIdx: number, campo: keyof Paso, rawValor: string) {
    if (!nuevoPrograma) return
    const valor = parseFloat(rawValor)
    const num = isNaN(valor) ? 0 : (campo === 'velocidad' ? valor : Math.round(valor))
    const nuevoPaso: Paso = { ...nuevoPrograma.pasos[pasoIdx], [campo]: num }
    setNuevoPrograma({ ...nuevoPrograma, pasos: nuevoPrograma.pasos.map((p, i) => i === pasoIdx ? nuevoPaso : p) })
  }

  function editarVelocidadTextoNuevo(pasoIdx: number, rawTexto: string) {
    if (!nuevoPrograma) return
    const normalizado = rawTexto.replace(',', '.')
    const valor = parseFloat(normalizado)
    const nuevosPasos = nuevoPrograma.pasos.map((p, i) =>
      i === pasoIdx ? { ...p, velocidad: isNaN(valor) ? p.velocidad : valor } : p
    )
    const nuevosTextos = nuevoPrograma.velTexto.map((t, i) => i === pasoIdx ? rawTexto : t)
    setNuevoPrograma({ ...nuevoPrograma, pasos: nuevosPasos, velTexto: nuevosTextos })
  }

  function agregarNuevoPaso() {
    if (!nuevoPrograma || nuevoPrograma.pasos.length >= 8) return
    const ultimo = nuevoPrograma.pasos[nuevoPrograma.pasos.length - 1]
    setNuevoPrograma({
      ...nuevoPrograma,
      pasos: [...nuevoPrograma.pasos, { velocidad: ultimo.velocidad, temperatura: 0, tiempo: 0 }],
      velTexto: [...nuevoPrograma.velTexto, ultimo.velocidad.toFixed(1)],
    })
  }

  function quitarNuevoPaso(pasoIdx: number) {
    if (!nuevoPrograma || nuevoPrograma.pasos.length <= 1) return
    setNuevoPrograma({
      ...nuevoPrograma,
      pasos: nuevoPrograma.pasos.filter((_, i) => i !== pasoIdx),
      velTexto: nuevoPrograma.velTexto.filter((_, i) => i !== pasoIdx),
    })
  }

  async function guardarNuevo() {
    if (!nuevoPrograma || !horno?.hornoId) return
    const nombre = nuevoPrograma.nombre.trim()
    if (!nombre) { alert('El nombre no puede estar vacío'); return }
    const slot = slotLibre()
    if (slot === null) { alert('No hay slots disponibles (máximo 20 programas personales)'); return }
    const pasosParaFirmware = normalizarSignosRampa(nuevoPrograma.pasos.map(p => ({ ...p, velocidad: Math.round(p.velocidad * 10) })))
    feedbackBoton()
    setGuardandoNuevo(true)
    try {
      await postPrograma(horno.hornoId, slot, { nombre, pasos: pasosParaFirmware })
      const tempFinal = [...pasosParaFirmware].reverse().find(p => p.temperatura > 0)?.temperatura ?? 0
      actualizarLocal(slot, { nombre, pasos: pasosParaFirmware, tempFinal })
      setNuevoPrograma(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error guardando programa'
      if (nombre && msg.toLowerCase().includes('nombre')) {
        alert('No se pudo guardar: el horno no está accesible por la red local.\n\nConfigurá la IP del horno en Ajustes → IP local, o conectate al hotspot del horno (red CERAMIENTAS_' + (horno?.hornoId?.slice(-4) ?? '????') + ').')
      } else {
        alert(msg)
      }
    } finally {
      setGuardandoNuevo(false)
    }
  }

  function editarPaso(pasoIdx: number, campo: keyof Paso, rawValor: string) {
    if (!editPasos) return
    const valor = parseFloat(rawValor)
    const nuevoPaso = { ...editPasos.pasos[pasoIdx] }
    if (campo === 'velocidad') {
      nuevoPaso.velocidad = isNaN(valor) ? 0 : Math.round(valor * 10)
    } else {
      (nuevoPaso[campo] as number) = isNaN(valor) ? 0 : Math.round(valor)
    }
    const nuevosPasos = editPasos.pasos.map((p, i) => i === pasoIdx ? nuevoPaso : p)
    setEditPasos({ ...editPasos, pasos: nuevosPasos })
  }

  function editarVelocidadTexto(pasoIdx: number, rawTexto: string) {
    if (!editPasos) return
    const normalizado = rawTexto.replace(',', '.')
    const valor = parseFloat(normalizado)
    const nuevosPasos = editPasos.pasos.map((p, i) =>
      i === pasoIdx ? { ...p, velocidad: isNaN(valor) ? p.velocidad : Math.round(valor * 10) } : p
    )
    const nuevosTextos = editPasos.velTexto.map((t, i) => i === pasoIdx ? rawTexto : t)
    setEditPasos({ ...editPasos, pasos: nuevosPasos, velTexto: nuevosTextos })
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
            <h1 className="text-2xl font-bold text-white mt-1">{horno?.nombre ?? '—'}</h1>
            {horno?.potencia && (
              <p className="text-sm text-neutral-400 mt-1">{horno.potencia} W</p>
            )}
          </div>
          <button
            onClick={() => {
              if (slotLibre() === null) { alert('No hay slots disponibles (máximo 20 programas personales)'); return }
              setNuevoPrograma({ nombre: '', pasos: [{ velocidad: 1, temperatura: 600, tiempo: 0 }], velTexto: ['1.0'] })
            }}
            className="px-4 py-2 bg-orange-500 hover:bg-orange-600 rounded-full text-sm font-semibold transition"
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
            const editandoEsteTF = editTF?.idx === p.idx

            return (
              <div key={p.idx} className="bg-neutral-900 rounded-xl p-4 border border-neutral-800">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1 min-w-0 pr-2">
                    <h3 className="font-bold text-lg truncate">{p.nombre}</h3>
                    <span className={`inline-block px-2 py-0.5 text-xs rounded-full mt-1 ${badgeColor}`}>
                      {badgeLabel} · {duracionTotal(pasosEfectivos(p))}
                    </span>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="text-xs text-neutral-400 mb-1">Temp final</p>
                    {esPredef ? (
                      editandoEsteTF ? (
                        <div className="flex items-center gap-1 justify-end">
                          <input
                            type="number"
                            value={editTF.valor}
                            onChange={e => setEditTF({ ...editTF, valor: e.target.value })}
                            onKeyDown={e => { if (e.key === 'Enter') guardarTempFinal(); if (e.key === 'Escape') setEditTF(null) }}
                            autoFocus
                            className="w-20 px-2 py-1 bg-neutral-800 border border-orange-500 rounded text-white text-right text-sm focus:outline-none"
                          />
                          <span className="text-neutral-400 text-sm">°C</span>
                          <button
                            onClick={guardarTempFinal}
                            disabled={guardandoTF}
                            className="ml-1 px-2 py-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 rounded text-xs font-bold"
                          >
                            {guardandoTF ? '...' : '✓'}
                          </button>
                          <button
                            onClick={() => setEditTF(null)}
                            disabled={guardandoTF}
                            className="px-1 py-1 text-neutral-400 hover:text-white text-xs"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setEditTF({ idx: p.idx, valor: String(tempFinalMostrar) })}
                          className="text-orange-500 font-bold text-lg hover:text-orange-400 transition"
                        >
                          {tempFinalMostrar}°C ✎
                        </button>
                      )
                    ) : (
                      <button
                        onClick={() => setEditPasos({
                        idx: p.idx,
                        nombre: p.nombre,
                        pasos: [...p.pasos],
                        velTexto: p.pasos.map(pp => (pp.velocidad / 10).toFixed(1)),
                      })}
                        className="text-orange-500 font-bold text-lg hover:text-orange-400 transition"
                      >
                        {tempFinalMostrar}°C ✎
                      </button>
                    )}

                    {!esPredef && (
                      <div className="flex gap-2 mt-2 justify-end">
                        <button
                          onClick={() => setConfirmarBorrar(p.idx)}
                          className="text-neutral-500 hover:text-red-400 transition p-1"
                          title="Borrar programa"
                        >
                          🗑
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-1 mb-3 mt-3 border-t border-neutral-800 pt-3">
                  {pasosEfectivos(p).filter(pasoActivo).map((paso, i) => (
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
                  className="w-full py-2 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500 rounded-lg text-orange-500 font-semibold transition active:scale-95 duration-75"
                >
                  🔥 Ejecutar
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Modal confirmación borrar */}
      {confirmarBorrar !== null && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-6">
          <div className="bg-neutral-900 rounded-2xl p-6 max-w-sm w-full border border-neutral-800">
            <h3 className="font-bold text-lg mb-2">¿Borrar programa?</h3>
            <p className="text-sm text-neutral-400 mb-6">
              {programas[confirmarBorrar]?.nombre ?? `Programa ${confirmarBorrar}`} — esta acción no se puede deshacer.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmarBorrar(null)}
                className="flex-1 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition"
              >
                Cancelar
              </button>
              <button
                onClick={() => borrarPrograma(confirmarBorrar)}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 rounded-lg font-semibold transition active:scale-95 duration-75"
              >
                Borrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal nuevo programa */}
      {nuevoPrograma !== null && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4 overflow-y-auto">
          <div className="bg-neutral-900 rounded-2xl p-5 max-w-sm w-full border border-neutral-800 my-4">
            <h3 className="font-bold text-lg mb-4">Nuevo programa</h3>

            <div className="mb-4">
              <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Nombre</label>
              <input
                type="text"
                value={nuevoPrograma.nombre}
                onChange={e => setNuevoPrograma({ ...nuevoPrograma, nombre: e.target.value })}
                placeholder="Ej: Bisque 980°C"
                maxLength={20}
                autoFocus
                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm focus:border-orange-500 focus:outline-none"
              />
            </div>

            <div className="mb-5">
              <div className="flex gap-2 text-xs text-neutral-500 uppercase tracking-wider mb-2 px-1">
                <span className="w-6 shrink-0"></span>
                <span className="flex-1">Vel °C/min</span>
                <span className="flex-1">Temp °C</span>
                <span className="flex-1">Tiempo min</span>
                <span className="w-5 shrink-0"></span>
              </div>

              <div className="space-y-2">
                {nuevoPrograma.pasos.map((paso, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-orange-500 text-xs font-bold w-6 shrink-0">P{i + 1}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0"
                      value={nuevoPrograma.velTexto[i]}
                      onChange={e => editarVelocidadTextoNuevo(i, e.target.value)}
                      className="flex-1 min-w-0 px-2 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-white text-sm focus:border-orange-500 focus:outline-none"
                    />
                    <input
                      type="number"
                      min="0"
                      max="1300"
                      value={paso.temperatura || ''}
                      placeholder="0"
                      onChange={e => editarNuevoPaso(i, 'temperatura', e.target.value)}
                      className="flex-1 min-w-0 px-2 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-white text-sm focus:border-orange-500 focus:outline-none"
                    />
                    <input
                      type="number"
                      min="0"
                      value={paso.tiempo || ''}
                      placeholder="0"
                      onChange={e => editarNuevoPaso(i, 'tiempo', e.target.value)}
                      className="flex-1 min-w-0 px-2 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-white text-sm focus:border-orange-500 focus:outline-none"
                    />
                    <button
                      onClick={() => quitarNuevoPaso(i)}
                      disabled={nuevoPrograma.pasos.length <= 1}
                      className="w-5 shrink-0 text-neutral-500 hover:text-red-400 disabled:opacity-30 transition text-sm"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              {nuevoPrograma.pasos.length < 8 && (
                <button
                  onClick={agregarNuevoPaso}
                  className="mt-3 w-full py-1.5 border border-dashed border-neutral-700 hover:border-neutral-500 rounded-lg text-neutral-500 hover:text-neutral-300 text-sm transition"
                >
                  + Agregar paso
                </button>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setNuevoPrograma(null)}
                disabled={guardandoNuevo}
                className="flex-1 py-2.5 border border-neutral-700 rounded-xl text-neutral-400 text-sm hover:bg-neutral-800 transition"
              >
                Cancelar
              </button>
              <button
                onClick={guardarNuevo}
                disabled={guardandoNuevo}
                className="flex-1 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 rounded-xl font-semibold transition active:scale-95 duration-75"
              >
                {guardandoNuevo ? 'Guardando...' : 'Crear'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal edición de pasos */}
      {editPasos !== null && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4 overflow-y-auto">
          <div className="bg-neutral-900 rounded-2xl p-5 max-w-sm w-full border border-neutral-800 my-4">
            <h3 className="font-bold text-lg mb-4">Editar programa</h3>

            <div className="mb-4">
              <label className="text-xs text-neutral-500 uppercase tracking-wider block mb-1">Nombre</label>
              <input
                type="text"
                value={editPasos.nombre}
                onChange={e => setEditPasos({ ...editPasos, nombre: e.target.value })}
                maxLength={20}
                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-white text-sm focus:border-orange-500 focus:outline-none"
              />
            </div>

            <div className="space-y-3 mb-5">
              {/* Encabezados */}
              <div className="grid grid-cols-3 gap-2 text-xs text-neutral-500 uppercase tracking-wider px-1">
                <span>Vel °C/min</span>
                <span>Temp °C</span>
                <span>Tiempo min</span>
              </div>

              {editPasos.pasos.map((paso, origIdx) => {
                if (!pasoActivo(paso)) return null
                const numVisible = editPasos.pasos.slice(0, origIdx).filter(pasoActivo).length + 1
                return (
                  <div key={origIdx} className="grid grid-cols-3 gap-2 items-center">
                    <div className="flex items-center gap-1">
                      <span className="text-orange-500 text-xs font-bold w-5">P{numVisible}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={editPasos.velTexto[origIdx]}
                        onChange={e => editarVelocidadTexto(origIdx, e.target.value)}
                        className="w-full px-2 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-white text-sm focus:border-orange-500 focus:outline-none"
                      />
                    </div>
                    <input
                      type="number"
                      value={paso.temperatura || ''}
                      placeholder="0"
                      onChange={e => editarPaso(origIdx, 'temperatura', e.target.value)}
                      className="w-full px-2 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-white text-sm focus:border-orange-500 focus:outline-none"
                    />
                    <input
                      type="number"
                      value={paso.tiempo || ''}
                      placeholder="0"
                      onChange={e => editarPaso(origIdx, 'tiempo', e.target.value)}
                      className="w-full px-2 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-white text-sm focus:border-orange-500 focus:outline-none"
                    />
                  </div>
                )
              })}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setEditPasos(null)}
                disabled={guardandoPasos}
                className="flex-1 py-2.5 border border-neutral-700 rounded-xl text-neutral-400 text-sm hover:bg-neutral-800 transition"
              >
                Cancelar
              </button>
              <button
                onClick={guardarPasos}
                disabled={guardandoPasos}
                className="flex-1 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 rounded-xl font-semibold transition active:scale-95 duration-75"
              >
                {guardandoPasos ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bloqueo total mientras se confirma temp final (predefinidos) */}
      {guardandoTF && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-6">
          <div className="bg-neutral-900 rounded-2xl p-7 max-w-sm w-full border border-neutral-800 flex flex-col items-center text-center">
            <div className="w-10 h-10 border-4 border-neutral-700 border-t-orange-500 rounded-full animate-spin mb-4" />
            <p className="text-white font-bold text-lg mb-2">Guardando...</p>
            <p className="text-neutral-400 text-sm">Confirmando el cambio con el horno. No cierres la app.</p>
          </div>
        </div>
      )}
    </div>
  )
}
