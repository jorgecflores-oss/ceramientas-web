import { useCallback, useEffect, useRef, useState } from 'react'
import { useHornoStore } from '../store/hornoStore'
import { suscribirEstado, suscribirNotif, publicarComando } from '../services/mqttService'
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
  const programas = useHornoStore((s) => s.programas)

  const estadoPrevioRef      = useRef<string | null>(null)
  const corteLuzCooldownRef  = useRef(0)
  const rampaRapidaShownRef  = useRef(false)
  const toastIdRef           = useRef(0)

  const [xAhora, setXAhora] = useState<number | undefined>(undefined)
  const [, setTick] = useState(0)
  const [modalCorteLuz, setModalCorteLuz]     = useState(false)
  const [modalRampaRapida, setModalRampaRapida] = useState(false)
  const [toasts, setToasts] = useState<{ id: number; msg: string; tipo: 'info' | 'warn' | 'error' }[]>([])

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

  const mostrarToast = useCallback((msg: string, tipo: 'info' | 'warn' | 'error' = 'info') => {
    const id = ++toastIdRef.current
    setToasts(prev => [...prev, { id, msg, tipo }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000)
  }, [])

  // Corte de luz detectado por campo cl del estado
  useEffect(() => {
    if (!estado?.corteLuz) return
    const now = Date.now()
    if (now - corteLuzCooldownRef.current < 30000) return
    corteLuzCooldownRef.current = now
    setModalCorteLuz(true)
  }, [estado?.corteLuz])

  // Rampa rápida detectada por campo rr del estado
  useEffect(() => {
    if (!estado?.rampaRapida) { rampaRapidaShownRef.current = false; return }
    if (rampaRapidaShownRef.current) return
    rampaRapidaShownRef.current = true
    setModalRampaRapida(true)
  }, [estado?.rampaRapida])

  // Notificaciones tipadas del firmware via topic /notif
  useEffect(() => {
    if (!horno) return
    const unsub = suscribirNotif(horno.hornoId, (notif) => {
      const now = Date.now()
      if (notif.tipo === 'corte_luz') {
        if (now - corteLuzCooldownRef.current < 30000) return
        corteLuzCooldownRef.current = now
        setModalCorteLuz(true)
      } else if (notif.tipo === 'rampa_rapida') {
        if (rampaRapidaShownRef.current) return
        rampaRapidaShownRef.current = true
        setModalRampaRapida(true)
      } else if (notif.tipo === 'etapa') {
        const msg = notif.msg?.replace(/(\d+)C$/, '$1°C') ?? 'Nueva etapa iniciada'
        mostrarToast(`${horno.nombre}: ${msg}`, 'info')
      } else if (notif.tipo === 'meseta') {
        const msg = notif.msg?.replace(/(\d+)C\b/, '$1°C') ?? 'Meseta alcanzada'
        mostrarToast(`${horno.nombre}: ${msg}`, 'info')
      } else if (notif.tipo === 'fin') {
        mostrarToast(`${horno.nombre}: ${notif.msg ?? 'Horneado finalizado'}`, 'info')
      } else if (notif.tipo === 'alarma_critica') {
        mostrarToast(`${horno.nombre}: ${notif.msg ?? '¡ALARMA! Temperatura máxima superada'}`, 'error')
      } else if (notif.tipo === 'alarma_exceso') {
        mostrarToast(`${horno.nombre}: ${notif.msg ?? 'Exceso de temperatura final'}`, 'warn')
      } else if (notif.tipo === 'rampa_lenta') {
        mostrarToast(`${horno.nombre}: ${notif.msg ?? 'La rampa progresa muy lentamente'}`, 'warn')
      }
    })
    return unsub
  }, [horno, mostrarToast])

  async function enviarCmd(cmd: string) {
    if (!horno) return
    const mqttOk = publicarComando(horno.hornoId, cmd)
    if (!mqttOk) {
      try { await postComando(horno.hornoId, cmd) } catch { /* sin conexión */ }
    }
  }

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
    const hornoId     = horno.hornoId
    const tCapture    = Date.now()
    const tempCapture = estado.temperatura
    const etapaTotal  = estado.etapaTotal
    const etapa       = estado.etapa
    let tempObj       = estado.tempObj

    if (tempObj <= 0) {
      await new Promise(resolve => setTimeout(resolve, 2500))
      const fresco = useHornoStore.getState().estado
      if (fresco) tempObj = fresco.tempObj
    }

    const aplicarCurva = (progs: typeof programas) => {
      const match = matchPrograma(progs, etapaTotal, etapa, tempObj)
      if (!match) return
      if (esNuevo) {
        const puntos = calcularCurvaTeorica(match.pasos, tempCapture, tCapture)
        setCurvaTeorica(match, puntos, tCapture, tempCapture)
      } else {
        const t0Virtual = calcularT0Virtual(match.pasos, tempCapture, tCapture, 20)
        const puntos = calcularCurvaTeorica(match.pasos, 20, t0Virtual)
        setCurvaTeorica(match, puntos, t0Virtual, 20)
      }
    }

    if (esNuevo) {
      resetHistorial()
      clearCurvaTeorica()
      useHornoStore.getState().limpiarSnapshot(hornoId)
    }

    // Inmediato: usar cache en memoria, sin I/O
    aplicarCurva(programas)

    // Fresco: actualizar si los programas cambiaron (ej: tempFinal editado)
    try {
      const progs = await fetchProgramasOnce(hornoId)
      setProgramas(progs)
      aplicarCurva(progs)
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
      // Siempre recalcular al arrancar: la curva almacenada puede ser de otro programa.
      calcularYGuardarCurva(false)
    } else if ((prev === 'idle' || prev === 'finalizado') && actualActivo) {
      calcularYGuardarCurva(true)
    } else if (prevEraActivo && actualInactivo) {
      clearCurvaTeorica()
      useHornoStore.getState().flushHistorial()
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
    <>
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
        <div className="bg-red-900/30 border border-red-800 rounded-lg p-4 mb-4 flex items-center justify-between">
          <p className="text-red-400 font-semibold">⚡ Corte de luz detectado</p>
          <button
            onClick={() => { corteLuzCooldownRef.current = 0; setModalCorteLuz(true) }}
            className="text-xs text-red-400 border border-red-800 rounded px-2 py-1 hover:bg-red-900/50"
          >
            Ver opciones
          </button>
        </div>
      )}

      {estado?.rampaRapida && (
        <div className="bg-yellow-900/30 border border-yellow-800 rounded-lg p-4 mb-4 flex items-center justify-between">
          <p className="text-yellow-400 font-semibold">⚠ Rampa rápida</p>
          <button
            onClick={() => { rampaRapidaShownRef.current = false; setModalRampaRapida(true) }}
            className="text-xs text-yellow-400 border border-yellow-800 rounded px-2 py-1 hover:bg-yellow-900/50"
          >
            Ver alerta
          </button>
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

    {/* Toast stack — eventos del firmware */}
    {toasts.length > 0 && (
      <div className="fixed top-4 left-0 right-0 z-50 flex flex-col items-center gap-2 px-4 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className={`rounded-xl px-4 py-3 text-sm font-semibold shadow-lg w-full max-w-sm text-center pointer-events-auto
            ${t.tipo === 'error' ? 'bg-red-900/95 text-red-100 border border-red-700' :
              t.tipo === 'warn'  ? 'bg-yellow-900/95 text-yellow-100 border border-yellow-700' :
                                   'bg-neutral-800/95 text-white border border-neutral-600'}`}>
            {t.msg}
          </div>
        ))}
      </div>
    )}

    {/* Modal — Corte de luz */}
    {modalCorteLuz && (
      <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
        <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 w-full max-w-sm">
          <h2 className="text-xl font-bold text-white mb-2">⚡ Corte de luz — {horno.nombre}</h2>
          <p className="text-neutral-400 text-sm mb-1">Suministro reestablecido.</p>
          {(estado?.temperatura ?? 0) > 0 && (
            <p className="text-sm mb-4">
              Temperatura del horno:{' '}
              <span className="text-orange-400 font-bold">{Math.round(estado!.temperatura)}°C</span>
            </p>
          )}
          <p className="text-neutral-300 text-sm mb-6">¿Continuamos la horneada?</p>
          <div className="flex gap-3">
            <button
              onClick={() => { setModalCorteLuz(false); enviarCmd('detener') }}
              className="flex-1 py-3 border border-neutral-600 rounded-xl text-neutral-300 font-semibold hover:bg-neutral-800 transition"
            >
              Cancelar
            </button>
            <button
              onClick={() => { setModalCorteLuz(false); enviarCmd('continuar') }}
              className="flex-1 py-3 bg-orange-600 hover:bg-orange-700 rounded-xl text-white font-bold transition"
            >
              Continuar
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Modal — Rampa rápida */}
    {modalRampaRapida && (
      <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
        <div className="bg-neutral-900 border border-red-800 rounded-2xl p-6 w-full max-w-sm">
          <h2 className="text-xl font-bold text-red-400 mb-2">⚡ Rampa acelerada — {horno.nombre}</h2>
          <p className="text-neutral-400 text-sm mb-2">
            La temperatura sube <span className="text-red-400 font-bold">más rápido de lo programado</span>.
          </p>
          {(estado?.temperatura ?? 0) > 0 && (
            <p className="text-sm mb-2">
              Temperatura actual:{' '}
              <span className="text-orange-400 font-bold">{Math.round(estado!.temperatura)}°C</span>
            </p>
          )}
          <p className="text-neutral-400 text-sm mb-1">
            Posible <span className="text-red-400 font-bold">contacto pegado</span> en el SSR o contactor.
          </p>
          <p className="text-white font-bold text-sm mb-6">Desconectá la alimentación del horno ahora.</p>
          <div className="flex gap-3">
            <button
              onClick={() => { setModalRampaRapida(false); enviarCmd('detener') }}
              className="flex-1 py-3 border border-neutral-600 rounded-xl text-neutral-300 font-semibold hover:bg-neutral-800 transition"
            >
              Detener proceso
            </button>
            <button
              onClick={() => { setModalRampaRapida(false); enviarCmd('cancelar_alarma') }}
              className="flex-1 py-3 bg-red-700 hover:bg-red-800 rounded-xl text-white font-bold transition"
            >
              Ya desconecté
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
