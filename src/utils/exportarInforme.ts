import type { Paso } from '../types/horno'
import type { Snapshot } from '../store/hornoStore'

const pasoActivo = (p: Paso) => p.velocidad !== 0 || p.temperatura !== 0 || p.tiempo !== 0

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

function calcularResumenEtapas(
  pasos: Paso[],
  historial: { t: number; temp: number }[],
  tempInicio: number,
  tInicio: number
) {
  const resumen: {
    paso: number
    objetivo: number
    velocidad: number
    duracionTeoricaMin: number
    duracionRealMin: number | null
    deltaMin: number | null
    margenAlarmaMin: number | null
  }[] = []
  let tempActual = tempInicio
  let tAcumTeoricoMin = 0
  let idx = 0
  for (const paso of pasos) {
    idx++
    if (!pasoActivo(paso)) continue
    const velocidad = paso.velocidad / 10
    const velAbs = Math.abs(velocidad)
    const delta = paso.temperatura - tempActual
    const duracionTeoricaMin = velAbs > 0 && Math.abs(delta) > 0.5 ? Math.abs(delta) / velAbs : 0
    const tInicioRampaMin = tAcumTeoricoMin
    tAcumTeoricoMin += duracionTeoricaMin

    let duracionRealMin: number | null = null
    if (duracionTeoricaMin > 0) {
      const ascendente = delta >= 0
      const cruce = historial.find(p =>
        ascendente ? p.temp >= paso.temperatura : p.temp <= paso.temperatura
      )
      if (cruce) duracionRealMin = (cruce.t - tInicio) / 60000 - tInicioRampaMin
    }

    resumen.push({
      paso: idx,
      objetivo: paso.temperatura,
      velocidad,
      duracionTeoricaMin,
      duracionRealMin,
      deltaMin: duracionRealMin !== null ? duracionRealMin - duracionTeoricaMin : null,
      margenAlarmaMin: duracionRealMin !== null ? 15 - (duracionRealMin - duracionTeoricaMin) : null,
    })

    tempActual = paso.temperatura
    if (paso.tiempo > 0) tAcumTeoricoMin += paso.tiempo
  }
  return resumen
}

export function exportarInformeHorneada(snapshot: Snapshot) {
  const prog = snapshot.programa
  const fecha = fechaISO(snapshot.tInicio)
  const nombreArchivo = `horneada_${fecha}_${slug(prog?.nombre ?? 'programa')}.txt`

  const prompt = `Datos de una horneada de ceramica: programa teorico (rampas y temperaturas
objetivo) y curva real registrada por el controlador.
Aunque haya pocos puntos (por ejemplo, una prueba corta), grafica igual con
los datos disponibles - no hace falta mas cantidad para que sea valido.

Contexto del sistema de alarmas del controlador: dispara alarma de "rampa
lenta" si una etapa tarda mas de 15 minutos por encima de su duracion
teorica (segun la velocidad programada). No hay alarma por adelantarse.

Genera un archivo PDF, tamano A4, uniendo todo esto en un solo informe:
- El programa completo en una tabla clara (todos los pasos, igual que se
  ve en la pantalla Programas de la app).
- El grafico con ambas curvas (teorica y real) superpuestas en el mismo
  eje de tiempo.
- La tabla RESUMEN POR ETAPA: que etapas se adelantaron, cuales se
  atrasaron, y si alguna estuvo cerca del umbral de alarma de 15 minutos
  (columna margen hasta alarma).
- La tabla RANGOS DE TEMPERATURA: rampa real observada (C/min) cada
  100C, para ver capacidad real del horno tramo a tramo, mas fino que
  por etapa de programa.
- Recomendacion concreta para la proxima horneada: si alguna velocidad
  de rampa programada conviene subir o bajar para ajustarse mejor a la
  capacidad real de este horno, con el valor sugerido en C/min.`

  let tablaPrograma = 'PROGRAMA: (sin datos)\n'
  if (prog) {
    tablaPrograma = `PROGRAMA: ${prog.nombre}\n`
    tablaPrograma += 'Paso | Velocidad (C/min) | Temp objetivo (C) | Meseta (min)\n'
    prog.pasos
      .filter(pasoActivo)
      .forEach((p, i) => {
        tablaPrograma += `${i + 1} | ${(p.velocidad / 10).toFixed(1)} | ${p.temperatura} | ${p.tiempo}\n`
      })
  }

  let tablaResumen = 'RESUMEN POR ETAPA (delta positivo = se atraso, negativo = se adelanto)\n'
  tablaResumen += 'Paso | Objetivo(C) | Vel.programada(C/min) | Duracion teorica(min) | Duracion real(min) | Delta(min) | Margen hasta alarma(min)\n'
  if (prog) {
    const resumen = calcularResumenEtapas(prog.pasos, snapshot.historialTemp, snapshot.puntosTeoricos[0]?.temp ?? 0, snapshot.tInicio)
    for (const r of resumen) {
      const dur = r.duracionRealMin !== null ? r.duracionRealMin.toFixed(1) : 's/d'
      const delta = r.deltaMin !== null ? `${r.deltaMin >= 0 ? '+' : ''}${r.deltaMin.toFixed(1)}` : 's/d'
      const margen = r.margenAlarmaMin !== null ? r.margenAlarmaMin.toFixed(1) : 's/d'
      tablaResumen += `${r.paso} | ${r.objetivo} | ${r.velocidad.toFixed(1)} | ${r.duracionTeoricaMin.toFixed(1)} | ${dur} | ${delta} | ${margen}\n`
    }
  }

  let tablaRangos = 'RANGOS DE TEMPERATURA - rampa observada (C/min)\n'
  tablaRangos += 'Rango (C) | Minima | Maxima | Promedio\n'
  for (const b of calcularRangosRampa(snapshot.historialTemp)) {
    tablaRangos += `${b.desde}-${b.hasta} | ${b.min.toFixed(1)} | ${b.max.toFixed(1)} | ${b.promedio.toFixed(1)}\n`
  }

  let tablaDatos = 'DATOS (minuto, temp teorica C, temp real C)\n'
  for (const pr of snapshot.historialTemp) {
    const minuto = ((pr.t - snapshot.tInicio) / 60000).toFixed(2)
    const teo = interpolarTeorica(snapshot.puntosTeoricos, pr.t)
    tablaDatos += `${minuto}, ${teo !== null ? teo.toFixed(1) : ''}, ${pr.temp}\n`
  }

  const contenido = `[PROMPT - pegar este archivo completo en cualquier chat de IA]\n${prompt}\n\n${tablaPrograma}\n${tablaResumen}\n${tablaRangos}\n${tablaDatos}`
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
objetivo es conocer la capacidad real de este horno.
Aunque haya pocos puntos (por ejemplo, una prueba corta), grafica igual con
los datos disponibles - no hace falta mas cantidad para que sea valido.
Genera un archivo PDF, tamano A4, con:
- El grafico de la curva real.
- La tabla de rangos de temperatura con rampa minima/maxima/promedio.
- Una sugerencia de que rampas son razonables programar en cada tramo sin
  disparar falsas alarmas de rampa lenta.`

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
