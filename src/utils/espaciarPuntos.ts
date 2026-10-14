const MINUTO_MS = 60000
// Espaciado de la última corrida cuando no hay una anterior de donde copiarlo
const ESPACIADO_DEFECTO_MS = 10000

// El firmware sella cada punto de /curva en minutos enteros, así que varias muestras
// llegan con el mismo `t`. Para dibujar: repartir parejo dentro de su minuto las
// corridas consecutivas con igual `t`. Solo para mostrar — los datos guardados quedan crudos.
export function espaciarMismoMinuto(
  pts: { t: number; temp: number }[]
): { t: number; temp: number }[] {
  if (!pts || pts.length < 2) return pts
  // Red de seguridad: ante cualquier error se dibujan los puntos crudos
  try {
    const salida: { t: number; temp: number }[] = []
    let espaciadoAnterior: number | null = null
    let i = 0
    while (i < pts.length) {
      let fin = i + 1
      while (fin < pts.length && pts[fin].t === pts[i].t) fin++
      const n = fin - i
      const t = pts[i].t
      let espaciado: number
      if (fin < pts.length) {
        // Corrida completa: ocupa su minuto, sin pasar el `t` de la corrida siguiente
        const ventana = Math.max(0, Math.min(MINUTO_MS, pts[fin].t - t))
        espaciado = ventana / n
      } else {
        // Última corrida (puede seguir creciendo): mismo ritmo que la anterior,
        // sin llegar a sumar un minuto entero
        espaciado = espaciadoAnterior ?? ESPACIADO_DEFECTO_MS
        if ((n - 1) * espaciado >= MINUTO_MS) espaciado = MINUTO_MS / n
      }
      for (let k = 0; k < n; k++) {
        salida.push(k === 0 ? pts[i] : { t: t + k * espaciado, temp: pts[i + k].temp })
      }
      espaciadoAnterior = espaciado
      i = fin
    }
    return salida
  } catch (e) {
    console.error('[espaciarMismoMinuto]', e)
    return pts
  }
}
