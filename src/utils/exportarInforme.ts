import type { Snapshot } from '../store/hornoStore'

function fechaISO(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function slug(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'sin_nombre'
}

function descargarTexto(nombreArchivo: string, contenido: string) {
  const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function interpolarTeorica(puntos: { t: number; temp: number }[], t: number): number | null {
  if (puntos.length === 0) return null
  if (t <= puntos[0].t) return puntos[0].temp
  if (t >= puntos[puntos.length - 1].t) return puntos[puntos.length - 1].temp
  for (let i = 1; i < puntos.length; i++) {
    if (puntos[i].t >= t) {
      const ratio = (t - puntos[i - 1].t) / (puntos[i].t - puntos[i - 1].t)
      return puntos[i - 1].temp + ratio * (puntos[i].temp - puntos[i - 1].temp)
    }
  }
  return puntos[puntos.length - 1].temp
}

export function exportarInformeHorneada(snapshot: Snapshot) {
  const prog = snapshot.programa
  const fecha = fechaISO(snapshot.tInicio)
  const nombreArchivo = `horneada_${fecha}_${slug(prog?.nombre ?? 'programa')}.txt`

  const prompt = `Datos de una horneada de ceramica: programa teorico (rampas y temperaturas
objetivo) y curva real registrada por el controlador. Grafica ambas curvas
en el mismo eje de tiempo. Analisis breve: que tan bien se ajusto el horno
al programa, donde hubo mayor desvio, si algo llama la atencion.
Exporta el resultado final (grafico y analisis) como PDF, tamano A4.`

  let tablaPrograma = 'PROGRAMA: (sin datos)\n'
  if (prog) {
    tablaPrograma = `PROGRAMA: ${prog.nombre}\n`
    tablaPrograma += 'Paso | Velocidad (C/min) | Temp objetivo (C) | Meseta (min)\n'
    prog.pasos.forEach((p, i) => {
      tablaPrograma += `${i + 1} | ${(p.velocidad / 10).toFixed(1)} | ${p.temperatura} | ${p.tiempo}\n`
    })
  }

  let tablaDatos = 'DATOS (minuto, temp teorica C, temp real C)\n'
  for (const pr of snapshot.historialTemp) {
    const minuto = ((pr.t - snapshot.tInicio) / 60000).toFixed(2)
    const teo = interpolarTeorica(snapshot.puntosTeoricos, pr.t)
    tablaDatos += `${minuto}, ${teo !== null ? teo.toFixed(1) : ''}, ${pr.temp}\n`
  }

  const contenido = `[PROMPT - pegar este archivo completo en cualquier chat de IA]\n${prompt}\n\n${tablaPrograma}\n${tablaDatos}`
  descargarTexto(nombreArchivo, contenido)
}

function calcularRangosRampa(puntos: { t: number; temp: number }[]) {
  const BANDA = 100
  const acumulado = new Map<number, { min: number; max: number; suma: number; n: number }>()
  for (let i = 1; i < puntos.length; i++) {
    const a = puntos[i - 1]
    const b = puntos[i]
    const dtMin = (b.t - a.t) / 60000
    if (dtMin <= 0) continue
    const rampa = (b.temp - a.temp) / dtMin
    const banda = Math.floor(a.temp / BANDA) * BANDA
    const actual = acumulado.get(banda) ?? { min: Infinity, max: -Infinity, suma: 0, n: 0 }
    actual.min = Math.min(actual.min, rampa)
    actual.max = Math.max(actual.max, rampa)
    actual.suma += rampa
    actual.n += 1
    acumulado.set(banda, actual)
  }
  return [...acumulado.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([desde, v]) => ({ desde, hasta: desde + BANDA, min: v.min, max: v.max, promedio: v.suma / v.n }))
}

export function exportarCurvaHorno(snapshot: Snapshot) {
  const fecha = fechaISO(snapshot.tInicio)
  const nombreArchivo = `curva_horno_${fecha}.txt`

  const prompt = `Relevamiento de un horno ceramico corriendo libre (sin control de rampa),
hasta corte de seguridad o cancelacion manual. No hay curva teorica - el
objetivo es conocer la capacidad real de este horno. Grafica la curva,
usa la tabla de rangos para sugerir que rampas son razonables programar
en cada tramo sin disparar falsas alarmas de rampa lenta.
Exporta el resultado final (grafico y analisis) como PDF, tamano A4.`

  const bandas = calcularRangosRampa(snapshot.historialTemp)
  let tablaRangos = 'RANGOS DE TEMPERATURA - rampa observada (C/min)\n'
  tablaRangos += 'Rango (C) | Minima | Maxima | Promedio\n'
  for (const b of bandas) {
    tablaRangos += `${b.desde}-${b.hasta} | ${b.min.toFixed(1)} | ${b.max.toFixed(1)} | ${b.promedio.toFixed(1)}\n`
  }

  let tablaDatos = 'DATOS (minuto, temp real C)\n'
  for (const p of snapshot.historialTemp) {
    const minuto = ((p.t - snapshot.tInicio) / 60000).toFixed(2)
    tablaDatos += `${minuto}, ${p.temp}\n`
  }

  const contenido = `[PROMPT - pegar este archivo completo en cualquier chat de IA]\n${prompt}\n\n${tablaRangos}\n${tablaDatos}`
  descargarTexto(nombreArchivo, contenido)
}
