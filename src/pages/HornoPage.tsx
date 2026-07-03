import { useEffect, useRef, useState } from 'react'
import { useHornoStore } from '../store/hornoStore'
import { suscribirEstado, publicarComando } from '../services/mqttService'
import { postComando, fetchProgramasOnce } from '../services/hornoService'
import { CurvaGrafico } from '../components/CurvaGrafico'
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
  const mqttConectado = useHornoStore((s) => s.mqttConectado)
  const setEstado = useHornoStore((s) => s.setEstado)
  const pushTemp = useHornoStore((s) => s.pushTemp)
  const clearHorno = useHornoStore((s) => s.clearHorno)
  const historialTemp = useHornoStore((s) => s.historialTemp)
  const puntosTeoricos = useHornoStore((s) => s.puntosTeoricos)
  const setProgramas = useHornoStore((s) => s.setProgramas)
  const setCurvaTeorica = useHornoStore((s) => s.setCurvaTeorica)
  const clearCurvaTeorica = useHornoStore((s) => s.clearCurvaTeorica)
  const resetHistorial = useHornoStore((s) => s.resetHistorial)
  const loadCurvaFromStorage = useHornoStore((s) => s.loadCurvaFromStorage)
  const tInicio = useHornoStore((s) => s.tInicio)

  const estadoPrevioRef = useRef<string | null>(null)
  const [xAhora, setXAhora] = useState<number | undefined>(undefined)

  useEffect(() => {
    if (!horno) return
    const unsub = suscribirEstado(horno.hornoId, (data) => {
      setEstado(data)
      pushTemp(data.temperatura)
    })
    return unsub
  }, [horno, setEstado, pushTemp])

  useEffect(() => {
    loadCurvaFromStorage()
  }, [loadCurvaFromStorage])

  useEffect(() => {
    if (!tInicio) {
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
  }, [tInicio])

  async function parar() {
    if (!horno || !pass) return
    if (!confirm('¿Parar horneado?')) return
    const mqttOk = publicarComando(horno.hornoId, 'detener')
    if (!mqttOk && horno.ip) {
      try {
        await postComando(horno.ip, pass, 'detener')
      } catch (e) {
        alert('Error enviando comando')
      }
    }
  }

  async function calcularYGuardarCurva(esNuevo: boolean) {
    if (!horno?.ip || !pass || !estado) return
    try {
      const progs = await fetchProgramasOnce(horno.ip, pass, horno.hornoId)
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

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-6">
      <div className="max-w-md mx-auto">
      <header className="mb-8">
        <p className="text-xs text-neutral-400 tracking-widest uppercase">ceramientas</p>
        <h1 className="text-2xl font-bold tracking-widest mt-1">HORNO</h1>
        <p className="text-sm text-neutral-400 mt-1">{horno.nombre}</p>
      </header>

      <div className="flex justify-around items-center mb-6 px-2">
        <LedEstado
          activo={mqttConectado}
          label={mqttConectado ? 'Online' : 'Offline'}
          color={mqttConectado ? 'bg-green-500' : 'bg-neutral-600'}
        />
        <LedEstado
          activo={enProceso}
          label={enProceso ? 'Horneando' : 'Detenido'}
          color={enProceso ? 'bg-orange-500' : 'bg-neutral-600'}
        />
        <LedEstado
          activo={estado?.rele ?? false}
          label={estado?.rele ? 'Resist. ON' : 'Resist. OFF'}
          color={estado?.rele ? 'bg-orange-500' : 'bg-neutral-600'}
        />
      </div>

      <div className="bg-neutral-900 rounded-2xl p-8 mb-6 text-center border border-neutral-800">
        <p className="text-xs text-neutral-400 uppercase tracking-wider mb-2">Temperatura</p>
        <p className="text-6xl font-bold">{temp}<span className="text-2xl text-neutral-400">°C</span></p>
        {tempObj > 0 && (
          <p className="text-sm text-neutral-400 mt-2">Objetivo: {tempObj}°C</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-neutral-900 rounded-lg p-4 border border-neutral-800">
          <p className="text-xs text-neutral-400 uppercase">Estado</p>
          <p className="text-lg font-semibold mt-1">{estadoTxt}</p>
        </div>
        <div className="bg-neutral-900 rounded-lg p-4 border border-neutral-800">
          <p className="text-xs text-neutral-400 uppercase">Etapa</p>
          <p className="text-lg font-semibold mt-1">
            {estado?.etapa ?? 0}/{estado?.etapaTotal ?? 0}
          </p>
        </div>
        <div className="bg-neutral-900 rounded-lg p-4 border border-neutral-800">
          <p className="text-xs text-neutral-400 uppercase">Tiempo</p>
          <p className="text-lg font-semibold mt-1">
            {estado?.horas ?? 0}h {estado?.minutos ?? 0}m
          </p>
        </div>
        <div className="bg-neutral-900 rounded-lg p-4 border border-neutral-800">
          <p className="text-xs text-neutral-400 uppercase">Relé</p>
          <p className={`text-lg font-semibold mt-1 ${estado?.rele ? 'text-orange-500' : ''}`}>
            {estado?.rele ? 'ON' : 'OFF'}
          </p>
        </div>
      </div>

      <div className="bg-neutral-900 rounded-2xl p-4 border border-neutral-800 mb-6">
        <p className="text-xs text-neutral-400 uppercase tracking-wider mb-3">Curva</p>
        <CurvaGrafico
          puntos={historialTemp}
          tempObj={estado?.tempObj}
          puntosTeoricos={puntosTeoricos}
          xAhora={xAhora}
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
        <button
          onClick={parar}
          className="w-full py-4 bg-red-600 hover:bg-red-700 rounded-lg font-bold tracking-wider transition mb-4"
        >
          PARAR
        </button>
      )}

      <button
        onClick={clearHorno}
        className="w-full py-2 text-sm text-neutral-500 hover:text-neutral-300 transition"
      >
        Desvincular horno
      </button>
      </div>
    </div>
  )
}
