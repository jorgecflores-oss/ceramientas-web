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

// Resumen por etapa: cada rampa se mide desde su arranque REAL (cruce de la etapa
// anterior + su meseta), no desde el teorico. Asi el atraso de una etapa no se
// arrastra a las siguientes.
function calcularResumenEtapas(
  pasos: Paso[],
  historial: { t: number; temp: number }[],
  tempInicio: number,
  tInicio: number
) {
  const resumen: {
    paso: number
    desde: number
    objetivo: number
    velProgramada: number
    tieneRampa: boolean
    rampaRealCMin: number | null
    pct: number | null
    atrasoMin: number | null
    estado: string
    velSugerida: number | null
  }[] = []
  let tempActual = tempInicio
  let inicioRealMs: number | null = tInicio > 0 ? tInicio : null
  let idx = 0
  for (const paso of pasos) {
    idx++
    if (!pasoActivo(paso)) continue
    const velocidad = paso.velocidad / 10
    const velAbs = Math.abs(velocidad)
    const delta = paso.temperatura - tempActual
    const tieneRampa = velAbs > 0 && Math.abs(delta) > 0.5

    let rampaRealCMin: number | null = null
    let pct: number | null = null
    let atrasoMin: number | null = null
    let estado = 'sin rampa'
    let velSugerida: number | null = null

    if (!tieneRampa) {
      // Meseta pura o sin velocidad: solo corre el reloj de la meseta
      if (inicioRealMs !== null) inicioRealMs += paso.tiempo * 60000
    } else if (inicioRealMs === null) {
      estado = 'sin datos'
    } else {
      const desdeMs = inicioRealMs
      const ascendente = delta >= 0
      const cruce = historial.find(p =>
        p.t >= desdeMs && (ascendente ? p.temp >= paso.temperatura : p.temp <= paso.temperatura)
      )
      if (cruce) {
        const minReal = (cruce.t - desdeMs) / 60000
        rampaRealCMin = minReal <= 0.01 ? null : Math.abs(delta) / minReal
        atrasoMin = minReal - Math.abs(delta) / velAbs
        inicioRealMs = cruce.t + paso.tiempo * 60000
        if (rampaRealCMin !== null) {
          pct = rampaRealCMin / velAbs * 100
          if (pct < 95) estado = atrasoMin > 10 ? 'atrasada (riesgo alarma)' : 'atrasada'
          else if (pct > 105) estado = 'adelantada'
          else estado = 'cumple'
        } else {
          estado = 'sin datos'
        }
      } else {
        // No llego al objetivo: rampa promedio hasta el ultimo punto registrado
        estado = 'no alcanzada'
        const posteriores = historial.filter(p => p.t >= desdeMs)
        const ultimo = posteriores[posteriores.length - 1]
        if (ultimo) {
          const min = (ultimo.t - desdeMs) / 60000
          if (min >= 1) {
            rampaRealCMin = Math.abs(ultimo.temp - tempActual) / min
            pct = rampaRealCMin / velAbs * 100
          }
        }
        inicioRealMs = null  // los pasos siguientes quedan sin datos
      }
      if (estado.startsWith('atrasada') && rampaRealCMin !== null) {
        // Mismo signo que la programada (rampa de enfriamiento = negativa)
        velSugerida = Math.sign(velocidad) * Math.max(0.1, Math.floor(rampaRealCMin * 0.9 * 10) / 10)
      }
    }

    resumen.push({
      paso: idx,
      desde: Math.round(tempActual),
      objetivo: paso.temperatura,
      velProgramada: velocidad,
      tieneRampa,
      rampaRealCMin,
      pct,
      atrasoMin,
      estado,
      velSugerida,
    })

    tempActual = paso.temperatura
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

Como leer RESUMEN POR ETAPA: cada etapa se mide desde que arranco de verdad
(cuando la anterior llego a su temperatura y termino su meseta), asi el
atraso de una etapa no se arrastra a las siguientes. "Real" es la rampa
promedio que logro el horno en ese tramo; "% de lo programado" compara esa
rampa con la programada. "Velocidad sugerida" es 90% de la rampa real (un
margen para no disparar la alarma); "mantener" = no hace falta cambiarla.

Genera un archivo PDF, tamano A4, uniendo todo esto en un solo informe.
IMPORTANTE: el informe tiene que incluir texto de analisis escrito, en
prosa, no solo las tablas sueltas - las tablas solas no alcanzan.

Contenido del PDF:
- El programa completo en una tabla clara (todos los pasos, igual que se
  ve en la pantalla Programas de la app).
- El grafico con ambas curvas (teorica y real) superpuestas en el mismo
  eje de tiempo.
- La tabla RESUMEN POR ETAPA (datos mas abajo).
- La tabla RANGOS DE TEMPERATURA (datos mas abajo): rampa real
  observada (C/min) cada 100C, capacidad real del horno tramo a tramo.
- Una tabla PROGRAMA SUGERIDO: los mismos pasos, con las mismas
  temperaturas objetivo y mesetas; solo cambia la velocidad, usando la
  velocidad sugerida donde la haya (donde dice "mantener", la misma
  velocidad programada).
- La linea DURACION TOTAL DEL PROGRAMA (programada vs con velocidades
  sugeridas).
- Despues de las tablas, un ANALISIS ESCRITO EN PROSA (texto corrido,
  no una lista):
  - Tramo por tramo: un parrafo corto por cada etapa con rampa, que diga
    la rampa real vs la programada, si cumplio, y que conviene cambiar.
    Usa la tabla RANGOS DE TEMPERATURA para decir si la rampa del horno
    cae en ciertos rangos (por ejemplo, si pierde capacidad arriba de
    cierta temperatura).
  - Si una etapa figura "no alcanzada", deci que el horno no llego a esa
    temperatura con ese programa y sugeri una velocidad menor o mesetas
    mas largas. No inventes datos que no esten en las tablas.
  - Cierre con una recomendacion concreta de como modificar el programa,
    con los valores en C/min, y cuanto cambia la duracion total.`

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

  let tablaResumen = 'RESUMEN POR ETAPA (rampa real vs programada, C/min)\n'
  tablaResumen += 'Paso | Tramo (C) | Programada(C/min) | Real(C/min) | % de lo programado | Estado | Velocidad sugerida(C/min)\n'
  if (prog) {
    const resumen = calcularResumenEtapas(prog.pasos, snapshot.historialTemp, snapshot.puntosTeoricos[0]?.temp ?? 0, snapshot.tInicio)
    let totalProgramadoMin = 0
    let totalSugeridoMin = 0
    for (const r of resumen) {
      const real = r.rampaRealCMin !== null ? r.rampaRealCMin.toFixed(1) : 's/d'
      const pct = r.pct !== null ? `${Math.round(r.pct)}%` : 's/d'
      const sug = r.velSugerida !== null ? r.velSugerida.toFixed(1) : 'mantener'
      tablaResumen += `${r.paso} | ${r.desde}->${r.objetivo} | ${r.velProgramada.toFixed(1)} | ${real} | ${pct} | ${r.estado} | ${sug}\n`

      // Duracion: rampa (|delta T| / velocidad) + meseta del paso
      const meseta = prog.pasos[r.paso - 1]?.tiempo ?? 0
      const deltaAbs = Math.abs(r.objetivo - r.desde)
      const velProgAbs = Math.abs(r.velProgramada)
      const velSugAbs = r.velSugerida !== null ? Math.abs(r.velSugerida) : velProgAbs
      totalProgramadoMin += (r.tieneRampa ? deltaAbs / velProgAbs : 0) + meseta
      totalSugeridoMin += (r.tieneRampa ? deltaAbs / velSugAbs : 0) + meseta
    }
    tablaResumen += 'Nota: la alarma de rampa lenta dispara si una etapa tarda 15 min mas que su duracion teorica (=|delta T|/velocidad programada). "riesgo alarma" = atraso mayor a 10 min.\n'
    const totProg = Math.round(totalProgramadoMin)
    const totSug = Math.round(totalSugeridoMin)
    const dif = totSug - totProg
    tablaResumen += `DURACION TOTAL DEL PROGRAMA: programada ${totProg} min | con velocidades sugeridas ${totSug} min | diferencia ${dif >= 0 ? '+' : ''}${dif} min\n`
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
