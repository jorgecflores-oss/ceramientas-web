import { useEffect, useRef, useState } from 'react'
import { useHornoStore } from '../store/hornoStore'
import { suscribirEstado, publicarComando } from '../services/mqttService'
import { postComando, fetchProgramasOnce, getConfig, getEstado } from '../services/hornoService'
import { CurvaGrafico } from '../components/CurvaGrafico'
import { SelectorHorno } from '../components/SelectorHorno'
import { calcularCurvaTeorica, calcularT0Virtual } from '../utils/curvaTeorica'
import { matchPrograma } from '../utils/matchPrograma'

function LedEstado({ activo, label, color }: { activo: boolean; label: string; color: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`w-3 h-3 rounded-full ${color}`} />
      <span className={`text-xs ${activo ? 'text-white' : 'text-neutral-500'}`}>
        {label}
      </span>
    </div>
  )
}

export function HornoPage() {
  const horno = useHornoStore((s) => s.hornoActivo)
  const pass = useHornoStore((s) => s.password)
  const estado = useHornoStore((s) => s.estado)
  const hornoId = useHornoStore((s) => s.hornoActivoId)
  const ultimoVia = useHornoStore((s) => hornoId ? s.ultimoVia[hornoId] ?? null : null)
  const ultimoAt = useHornoStore((s) => hornoId ? s.ultimoRespuestaAt[hornoId] ?? 0 : 0)
  const setEstado = useHornoStore((s) => s.setEstado)
  const pushTemp = useHornoStore((s) => s.pushTemp)
  const historialTemp = useHornoStore((s) => s.historialTemp)
  const puntosTeoricos = useHornoStore((s) => s.puntosTeoricos)
  const setProgramas = useHornoStore((s) => s.setProgramas)
  const setCurvaTeorica = useHornoStore((s) => s.setCurvaTeorica)
  const clearCurvaTeorica = useHornoStore((s) => s.clearCurvaTeorica)
  const resetHistorial = useHornoStore((s) => s.resetHistorial)
  const registrarRespuesta = useHornoStore((s) => s.registrarRespuesta)
  const loadCurvaFromStorage = useHornoStore((s) => s.loadCurvaFromStorage)
  const setHorno = useHornoStore((s) => s.setHorno)
  const tInicio = useHornoStore((s) => s.tInicio)
  const ultimoYMax = useHornoStore((s) => s.ultimoYMax)
  const snapshot = useHornoStore((s) => s.snapshot)
  const programaActivo = useHornoStore((s) => s.programaActivo)

  const estadoPrevioRef = useRef<string | null>(null)
  const [xAhora, setXAhora] = useState<number | undefined>(undefined)
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!horno) return
    const unsub = suscribirEstado(horno.hornoId, (data) => {
      setEstado(data)
      registrarRespuesta(horno.hornoId, 'mqtt')
      const activo = data.estado === 'ejecutando' || data.estado === 'rampa' || data.estado === 'meseta'
      if (activo) pushTemp(data.temperatura)
    })
    return unsub
  }, [horno, setEstado, pushTemp, registrarRespuesta])

  useEffect(() => {
    loadCurvaFromStorage()
  }, [loadCurvaFromStorage])

  useEffect(() => {
    if (!horno?.hornoId || !pass) return
    getConfig(horno.hornoId)
      .then(cfg => {
        setHorno(
          { ...horno, potencia: cfg.potencia, nombre: cfg.nombre ?? horno.nombre },
          pass
        )
      })
      .catch(e => console.error('[getConfig]', e))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horno?.hornoId, pass])

  useEffect(() => {
    if (!horno?.hornoId) return
    getEstado(horno.hornoId)
      .then((data: any) => {
        setEstado({
          temperatura: data.t ?? data.temperatura ?? 0,
          tempObj: data.to ?? data.tempObj ?? 0,
          etapa: data.ea ?? data.etapa ?? 1,
          etapaTotal: data.et ?? data.etapaTotal ?? 1,
          horas: data.h ?? data.horas ?? 0,
          minutos: data.m ?? data.minutos ?? 0,
          rele: data.r ?? data.rele ?? false,
          rampaLenta: data.rl ?? data.rampaLenta ?? false,
          rampaRapida: data.rr ?? data.rampaRapida ?? false,
          corteLuz: data.cl ?? data.corteLuz ?? false,
          estado: data.e ?? data.estado ?? 'idle',
        })
      })
      .catch(e => console.error('[bootstrap estado]', e))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horno?.hornoId])

  useEffect(() => {
    const estadoActual = estado?.estado
    const activo = estadoActual === 'ejecutando' || estadoActual === 'rampa' || estadoActual === 'meseta'
    if (!tInicio || !activo) {
      setXAhora(undefined)
      return
    }
    const actualizar = () => {
      const min = (Date.now() - tInicio) / 60000
      setXAhora(min)
    }
    actualizar()
    const id = setInterval(actualizar, 5000)
    return () => clearInterval(id)
  }, [tInicio, estado?.estado])

  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 2000)
    return () => clearInterval(id)
  }, [])

  async function parar() {
    if (!horno) return
    if (!confirm('¿Parar horneado?')) return
    const mqttOk = publicarComando(horno.hornoId, 'detener')
    if (!mqttOk) {
      try {
        await postComando(horno.hornoId, 'detener')
      } catch (e) {
        alert('Error enviando comando')
      }
    }
  }

  async function calcularYGuardarCurva(esNuevo: boolean) {
    if (!horno?.hornoId || !estado) return
    try {
      const progs = await fetchProgramasOnce(horno.hornoId)
      setProgramas(progs)
      const match = matchPrograma(
        progs,
        estado.etapaTotal,
        estado.etapa,
        estado.tempObj
      )
      if (!match) return
      const tInicioReal = Date.now()
      if (esNuevo) {
        resetHistorial()
        const tempInicioReal = estado.temperatura
        const puntos = calcularCurvaTeorica(match.pasos, tempInicioReal, tInicioReal)
        setCurvaTeorica(match, puntos, tInicioReal, tempInicioReal)
      } else {
        const t0Virtual = calcularT0Virtual(match.pasos, estado.temperatura, tInicioReal, 20)
        const puntos = calcularCurvaTeorica(match.pasos, 20, t0Virtual)
        setCurvaTeorica(match, puntos, t0Virtual, 20)
      }
    } catch (e) {
      console.error('[CURVA_TEORICA] error', e)
    }
  }

  useEffect(() => {
    const estadoActual = estado?.estado ?? null
    const prev = estadoPrevioRef.current

    const actualActivo = estadoActual === 'ejecutando' ||
                         estadoActual === 'rampa' ||
                         estadoActual === 'meseta'
    const prevEraActivo = prev === 'ejecutando' || prev === 'rampa' || prev === 'meseta'
    const actualInactivo = estadoActual === 'idle' || estadoActual === 'finalizado'

    if (prev === null && actualActivo) {
      if (puntosTeoricos.length > 0) {
        estadoPrevioRef.current = estadoActual
        return
      }
      calcularYGuardarCurva(false)
    } else if ((prev === 'idle' || prev === 'finalizado') && actualActivo) {
      if (puntosTeoricos.length > 0) {
        estadoPrevioRef.current = estadoActual
        return
      }
      calcularYGuardarCurva(true)
    } else if (prevEraActivo && actualInactivo) {
      clearCurvaTeorica()
    } else if (prev === null && actualInactivo) {
      // App recargó con el horno ya detenido: guardar snapshot de la última horneada y limpiar
      clearCurvaTeorica()
    }

    estadoPrevioRef.current = estadoActual
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado?.estado])

  if (!horno) return null

  const temp = estado?.temperatura ?? 0
  const tempObj = estado?.tempObj ?? 0
  const estadoTxt = estado?.estado ?? 'sin datos'
  const enProceso =
    estadoTxt === 'ejecutando' ||
    estadoTxt === 'rampa' ||
    estadoTxt === 'meseta'

  const finalizadoOK =
    estadoTxt === 'finalizado' ||
    estadoTxt === 'alarma_exceso' ||
    estadoTxt === 'alarma_critica'

  const VENTANA_MQTT = 60_000
  const VENTANA_LOCAL = 30_000
  const mqttHornoOnline = ultimoVia === 'mqtt' && (Date.now() - ultimoAt) < VENTANA_MQTT
  const lanReciente = ultimoVia === 'http' && (Date.now() - ultimoAt) < VENTANA_LOCAL
  const estadoConexion: 'online' | 'local' | 'offline' =
    mqttHornoOnline ? 'online'
    : lanReciente ? 'local'
    : 'offline'

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-6 pb-24">
      <div className="max-w-md mx-auto">
      <SelectorHorno />
      <header className="mb-6">
        <p className="text-xs text-neutral-400 tracking-widest uppercase">ceramientas</p>
        <h1 className="text-2xl font-bold text-white mt-1">{horno.nombre}</h1>
        {horno.potencia && (
          <p className="text-sm text-neutral-400 mt-1">{horno.potencia} W</p>
        )}
      </header>

      <div className="mb-6 bg-neutral-900 border border-neutral-800 rounded-2xl px-4 py-3">
        <div className="flex justify-around items-center">
          <LedEstado
            activo={estadoConexion !== 'offline'}
            label={estadoConexion === 'online' ? 'Online' : estadoConexion === 'local' ? 'Local' : 'Offline'}
            color={estadoConexion === 'online' ? 'bg-green-500' : estadoConexion === 'local' ? 'bg-blue-400' : 'bg-neutral-600'}
          />
          <LedEstado
            activo={enProceso || finalizadoOK}
            label={enProceso ? 'Horneando' : finalizadoOK ? 'Finalizado' : 'Detenido'}
            color={enProceso ? 'bg-orange-500' : finalizadoOK ? 'bg-green-500' : 'bg-neutral-600'}
          />
          <LedEstado
            activo={estado?.rele ?? false}
            label={estado?.rele ? 'Resist. ON' : 'Resist. OFF'}
            color={estado?.rele ? 'bg-orange-500' : 'bg-neutral-600'}
          />
        </div>
      </div>

      <div className="bg-neutral-900 rounded-2xl mb-6 border border-neutral-800 overflow-hidden">
        <div className="p-6 text-center">
          <p className="text-6xl font-bold">{temp}<span className="text-2xl text-neutral-400 align-top">°C</span></p>
          {tempObj > 0 && (
            <p className="text-sm text-neutral-400 mt-2">objetivo: {tempObj}°C</p>
          )}
        </div>

        {enProceso && (
          <>
            <div className="px-6 pb-2">
              <div className="w-full bg-neutral-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full bg-orange-500 rounded-full transition-all"
                  style={{ width: `${Math.min(100, (temp / (tempObj || 100)) * 100)}%` }}
                />
              </div>
              <p className="text-center text-xs text-neutral-400 mt-2">
                Etapa {estado?.etapa ?? 0} de {estado?.etapaTotal ?? 0}
                {' — '}
                {estadoTxt === 'meseta' ? `Meseta a ${estado?.tempObj ?? 0}°C` : `Rampa hasta ${estado?.tempObj ?? 0}°C`}
              </p>
            </div>

            <div className="border-t border-neutral-800 grid grid-cols-3 divide-x divide-neutral-800">
              <div className="py-3 text-center">
                <p className="text-xs text-neutral-500 uppercase tracking-wider">Programa</p>
                <p className="text-sm font-semibold mt-1 truncate px-2">{programaActivo?.nombre ?? '—'}</p>
              </div>
              <div className="py-3 text-center">
                <p className="text-xs text-neutral-500 uppercase tracking-wider">Tiempo</p>
                <p className="text-sm font-semibold mt-1">{estado?.horas ?? 0}h {estado?.minutos ?? 0}min</p>
              </div>
              <div className="py-3 text-center">
                <p className="text-xs text-neutral-500 uppercase tracking-wider">Temp final</p>
                <p className="text-sm font-semibold mt-1 text-orange-400">{programaActivo?.tempFinal ?? '—'}°C</p>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="bg-neutral-900 rounded-2xl p-4 border border-neutral-800 mb-6">
        <CurvaGrafico
          puntos={historialTemp}
          puntosTeoricos={puntosTeoricos}
          xAhora={xAhora}
          ultimoYMax={ultimoYMax}
          snapshot={snapshot}
        />
      </div>

      {estado?.corteLuz && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg p-4 mb-4">
          <p className="text-red-400 font-semibold">⚡ Corte de luz detectado</p>
        </div>
      )}

      {estado?.rampaRapida && (
        <div className="bg-yellow-900/30 border border-yellow-800 rounded-lg p-4 mb-4">
          <p className="text-yellow-400 font-semibold">⚠ Rampa rápida (posible contacto pegado)</p>
        </div>
      )}

      {enProceso && (
        <div className="flex justify-center mb-4">
          <button
            onClick={parar}
            className="px-12 py-3 bg-red-600 hover:bg-red-700 rounded-lg font-bold tracking-wider transition"
          >
            PARAR
          </button>
        </div>
      )}

      </div>
    </div>
  )
}
