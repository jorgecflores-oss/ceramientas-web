// Estado de conexión con el horno (LED Online / Local / Offline). Lo comparten
// HornoPage (LED) y ProgramasPage (confirmación al ejecutar sin respuesta reciente).
export const VENTANA_MQTT = 60_000
export const VENTANA_LOCAL = 30_000

export type EstadoConexion = 'online' | 'local' | 'offline'

export function calcularEstadoConexion(
  via: 'http' | 'mqtt' | null,
  ultimoAt: number,
  ahora: number = Date.now()
): EstadoConexion {
  if (via === 'mqtt' && ahora - ultimoAt < VENTANA_MQTT) return 'online'
  if (via === 'http' && ahora - ultimoAt < VENTANA_LOCAL) return 'local'
  return 'offline'
}
