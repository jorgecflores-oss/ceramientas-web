import { useEffect } from 'react'
import { useHornoStore } from '../store/hornoStore'
import { suscribirEstado, publicarComando, estaConectado } from '../services/mqttService'
import { postComando } from '../services/hornoService'

export function HornoPage() {
  const horno = useHornoStore((s) => s.hornoActivo)
  const pass = useHornoStore((s) => s.password)
  const estado = useHornoStore((s) => s.estado)
  const mqttConectado = useHornoStore((s) => s.mqttConectado)
  const setEstado = useHornoStore((s) => s.setEstado)
  const pushTemp = useHornoStore((s) => s.pushTemp)
  const clearHorno = useHornoStore((s) => s.clearHorno)

  useEffect(() => {
    if (!horno) return
    const unsub = suscribirEstado(horno.hornoId, (data) => {
      setEstado(data)
      pushTemp(data.temperatura)
    })
    return unsub
  }, [horno, setEstado, pushTemp])

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

  if (!horno) return null

  const temp = estado?.temperatura ?? 0
  const tempObj = estado?.tempObj ?? 0
  const estadoTxt = estado?.estado ?? 'sin datos'
  const enProceso = estadoTxt === 'ejecutando'

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-6">
      <header className="mb-8">
        <p className="text-xs text-neutral-400 tracking-widest uppercase">ceramientas</p>
        <h1 className="text-2xl font-bold tracking-widest mt-1">HORNO</h1>
        <p className="text-sm text-neutral-400 mt-1">{horno.nombre}</p>
      </header>

      <div className="flex items-center gap-2 mb-6">
        <div className={`w-2 h-2 rounded-full ${mqttConectado ? 'bg-green-500' : 'bg-neutral-600'}`} />
        <span className="text-xs text-neutral-400">
          {mqttConectado ? 'Online MQTT' : 'Offline'}
        </span>
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
  )
}