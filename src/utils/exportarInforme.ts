import type { Paso } from '../types/horno'
import type { Snapshot } from '../store/hornoStore'
import { getHistorial } from '../services/historialService'
import { getProgramas } from '../services/hornoService'
import { calcularCurvaTeorica } from './curvaTeorica'

// Snapshot con programa recuperado del equipo (no del arranque real)
// pasoInicial/anclaT/anclaTemp: la curva del equipo arranca a mitad del programa
export type SnapshotInforme = Snapshot & {
  programaDesdeHistorial?: boolean
  programaOrigenSinFecha?: boolean
  pasoInicial?: number
  anclaT?: number
  anclaTemp?: number
}

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
  tInicio: number,
  pasoInicial = 0
) {
  const resumen: {
    paso: number
    desde: number | null
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
  let objetivoPrevio: number | null = null  // solo para mostrar el tramo de pasos previos
  for (const paso of pasos) {
    idx++
    if (!pasoActivo(paso)) continue
    if (idx - 1 < pasoInicial) {
      // Paso anterior al primer dato real: sin medicion, no mueve tempActual ni inicioRealMs
      resumen.push({
        paso: idx,
        desde: objetivoPrevio,
        objetivo: paso.temperatura,
        velProgramada: paso.velocidad / 10,
        tieneRampa: false,
        rampaRealCMin: null,
        pct: null,
        atrasoMin: null,
        estado: 'previa a la ventana',
        velSugerida: null,
      })
      objetivoPrevio = paso.temperatura
      continue
    }
    const velocidad = paso.velocidad / 10
    const velAbs = Math.abs(velocidad)
    const delta = paso.temperatura - tempActual
    const tieneRampa = velAbs > 0 && Math.abs(delta) > 0.5

    let rampaRealCMin: number | null = null
    let pct: number | null = null
    let atrasoMin: number | null = null
    let estado = 'sin rampa'
    let velSugerida: number | null = null
    let minNoAlcanzada = 0

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
          minNoAlcanzada = min
          if (min >= 1) {
            rampaRealCMin = Math.abs(ultimo.temp - tempActual) / min
            pct = rampaRealCMin / velAbs * 100
          }
        }
        inicioRealMs = null  // los pasos siguientes quedan sin datos
      }
      const noAlcanzadaLenta = estado === 'no alcanzada' && minNoAlcanzada >= 10 && pct !== null && pct < 95
      if ((estado.startsWith('atrasada') || noAlcanzadaLenta) && rampaRealCMin !== null) {
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
    objetivoPrevio = paso.temperatura
  }
  return resumen
}

// La curva del equipo (/curva) puede cubrir solo los ultimos minutos: el primer
// punto real cae a mitad del programa. Se busca el primer paso con rampa que T0
// todavia no alcanzo y se ancla ahi la teorica. null = arranca en el paso 1.
function alinearInicioPrograma(
  pasos: Paso[],
  historial: { t: number; temp: number }[]
): { pasoInicial: number; anclaT: number; anclaTemp: number } | null {
  const primero = historial[0]
  const T0 = primero.temp
  const primerActivo = pasos.findIndex(pasoActivo)
  const k = pasos.findIndex(p => pasoActivo(p) && p.velocidad !== 0 &&
    ((p.velocidad > 0 && T0 < p.temperatura) || (p.velocidad < 0 && T0 > p.temperatura)))
  if (k < 0 || k === primerActivo) return null
  const objetivo = pasos[k].temperatura
  if (Math.abs(objetivo - T0) < 15) {
    // Casi en el objetivo: anclar en el cruce y arrancar desde el paso siguiente
    const sube = pasos[k].velocidad > 0
    const cruce = historial.find(p => sube ? p.temp >= objetivo : p.temp <= objetivo)
    const haySiguiente = pasos.slice(k + 1).some(pasoActivo)
    if (cruce && haySiguiente) return { pasoInicial: k + 1, anclaT: cruce.t, anclaTemp: objetivo }
  }
  return { pasoInicial: k, anclaT: primero.t, anclaTemp: T0 }
}

// Motivo por el que fallo el ultimo intento de recuperar el programa ('' = no fallo
// o no se intento). exportarCurvaHorno lo muestra como AVISO.
export let ultimoMotivoRecuperacion = ''

function fallaRecuperacion(motivo: string): null {
  // ASCII: el motivo va al archivo exportado (mensajes de error pueden traer tildes)
  ultimoMotivoRecuperacion = motivo.normalize('NFD').replace(/[^\x20-\x7e]/g, '')
  console.warn('[INFORME_RECUPERAR]', ultimoMotivoRecuperacion)
  return null
}

const mensajeError = (e: unknown) => e instanceof Error ? e.message : String(e)

// Tras resetear la app el snapshot queda 'directa' sin programa. Se busca la
// horneada en el historial del equipo por fecha y se toma el programa por nombre.
export async function resolverProgramaDesdeHistorial(hornoId: string, snap: Snapshot): Promise<SnapshotInforme | null> {
  ultimoMotivoRecuperacion = ''
  try {
    if (snap.modo === 'programa') return fallaRecuperacion('chequeo modo: el snapshot ya tiene programa')
    if (snap.historialTemp.length === 0) return fallaRecuperacion('chequeo curva: el snapshot no tiene puntos reales')
    const MARGEN_MS = 30 * 60000
    const lastT = snap.historialTemp[snap.historialTemp.length - 1].t
    let lista: Awaited<ReturnType<typeof getHistorial>>
    try {
      lista = await getHistorial(hornoId)
    } catch (e) {
      return fallaRecuperacion(`sin historial del equipo, error al pedirlo: ${mensajeError(e)}`)
    }
    if (lista.length === 0) return fallaRecuperacion('el historial del equipo esta vacio')
    // Fecha valida: timestamp no nulo y posterior a 2020 (sin NTP el equipo guarda 0 o epoch chico)
    const fechaValida = (ts: number) => !!ts && ts >= 1577836800
    const candidatas = lista.filter(h => {
      const ms = h.timestamp * 1000
      return fechaValida(h.timestamp) && ms >= snap.tInicio - MARGEN_MS && ms <= lastT + MARGEN_MS
    })
    let entrada: (typeof lista)[number]
    let sinFecha = false
    if (candidatas.length > 0) {
      entrada = candidatas.reduce((a, b) =>
        Math.abs(b.timestamp * 1000 - snap.tInicio) < Math.abs(a.timestamp * 1000 - snap.tInicio) ? b : a
      )
    } else {
      // Sin fecha: solo si la mas reciente (indice 0) no tiene fecha valida; las viejas no importan
      if (fechaValida(lista[0].timestamp)) {
        const haySinFecha = lista.some(h => !fechaValida(h.timestamp))
        return fallaRecuperacion(haySinFecha
          ? 'la entrada sin fecha no es la mas reciente (la mas reciente tiene fecha y cae fuera de la ventana de +-30 min)'
          : 'sin entrada candidata: ninguna entrada con fecha valida cae dentro de la ventana de +-30 min de la curva')
      }
      entrada = lista[0]
      sinFecha = true
    }
    const nombre = entrada.programa.trim().toLowerCase()
    if (!nombre) return fallaRecuperacion('chequeo nombre: la entrada del historial no tiene nombre de programa')
    const maxReal = Math.max(...snap.historialTemp.map(p => p.temp))
    // La entrada cubre la horneada completa; la curva puede ser solo un tramo
    if (sinFecha && !(entrada.tempMax >= maxReal - 10)) {
      return fallaRecuperacion(`fallo validacion de temperatura: tempMax de la entrada ${Math.round(entrada.tempMax)} C, maximo real ${Math.round(maxReal)} C`)
    }
    let programas: Awaited<ReturnType<typeof getProgramas>>
    try {
      programas = await getProgramas(hornoId)
    } catch (e) {
      return fallaRecuperacion(`error al pedir los programas del equipo: ${mensajeError(e)}`)
    }
    const prog = programas.find(p => (p.nombre ?? '').trim().toLowerCase() === nombre)
    if (!prog) return fallaRecuperacion(`ningun programa del equipo se llama "${entrada.programa.trim()}"`)
    if (!prog.pasos.some(pasoActivo)) return fallaRecuperacion(`el programa "${prog.nombre}" no tiene pasos utiles`)
    if (sinFecha && !prog.pasos.some(p => p.temperatura >= maxReal - 20)) {
      return fallaRecuperacion(`fallo validacion de temperatura: ningun paso de "${prog.nombre}" llega a ${Math.round(maxReal - 20)} C (maximo real ${Math.round(maxReal)} C)`)
    }
    const tempInicio = snap.historialTemp[0].temp
    const alineado = alinearInicioPrograma(prog.pasos, snap.historialTemp)
    const puntos = alineado
      ? calcularCurvaTeorica(prog.pasos.slice(alineado.pasoInicial), alineado.anclaTemp, alineado.anclaT)
      : calcularCurvaTeorica(prog.pasos, tempInicio, snap.tInicio)
    return {
      ...snap, modo: 'programa', programa: prog, puntosTeoricos: puntos, programaDesdeHistorial: true,
      ...(sinFecha ? { programaOrigenSinFecha: true } : {}),
      ...(alineado ?? {}),
    }
  } catch (e) {
    return fallaRecuperacion(`error inesperado: ${mensajeError(e)}`)
  }
}

export function exportarInformeHorneada(snapshot: SnapshotInforme) {
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

Si hay AVISOs (sobre el programa o sobre la ventana de datos), mencionarlos
al inicio del analisis. Los pasos "previa a la ventana" no tienen datos: no
los analices; en PROGRAMA SUGERIDO llevan la velocidad programada.

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
- La linea DURACION TOTAL DEL PROGRAMA, o DURACION RESTANTE si los datos
  arrancan a mitad del programa (programada vs con velocidades sugeridas).
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
    if (snapshot.programaOrigenSinFecha) {
      tablaPrograma += 'AVISO: programa tomado de la entrada mas reciente del historial del equipo (sin fecha) por nombre. Si no corresponde a esta horneada o se edito despues, los pasos pueden diferir.\n'
    } else if (snapshot.programaDesdeHistorial) {
      tablaPrograma += 'AVISO: programa tomado del equipo por nombre segun el historial. Si se edito despues de la horneada, los pasos pueden diferir de los que se usaron realmente.\n'
    }
    const pIni = snapshot.pasoInicial ?? 0
    if (pIni > 0 && snapshot.historialTemp.length > 0) {
      const h = snapshot.historialTemp
      const minCubiertos = Math.round((h[h.length - 1].t - h[0].t) / 60000)
      tablaPrograma += `AVISO: la curva del equipo cubre solo ${minCubiertos} min desde ${Math.round(h[0].temp)} C. Pasos 1 a ${pIni} quedaron fuera de la ventana. El analisis cubre desde el paso ${pIni + 1}.\n`
    }
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
    const pIni = snapshot.pasoInicial ?? 0
    const resumen = calcularResumenEtapas(
      prog.pasos,
      snapshot.historialTemp,
      snapshot.anclaTemp ?? snapshot.puntosTeoricos[0]?.temp ?? 0,
      snapshot.anclaT ?? snapshot.tInicio,
      pIni
    )
    let totalProgramadoMin = 0
    let totalSugeridoMin = 0
    for (const r of resumen) {
      const real = r.rampaRealCMin !== null ? r.rampaRealCMin.toFixed(1) : 's/d'
      const pct = r.pct !== null ? `${Math.round(r.pct)}%` : 's/d'
      const sug = r.velSugerida !== null ? r.velSugerida.toFixed(1) : 'mantener'
      tablaResumen += `${r.paso} | ${r.desde ?? '?'}->${r.objetivo} | ${r.velProgramada.toFixed(1)} | ${real} | ${pct} | ${r.estado} | ${sug}\n`

      // Pasos previos a la ventana no suman a la duracion restante
      if (r.paso - 1 < pIni || r.desde === null) continue

      // Duracion: rampa (|delta T| / velocidad) + meseta del paso
      const meseta = prog.pasos[r.paso - 1]?.tiempo ?? 0
      const deltaAbs = Math.abs(r.objetivo - r.desde)
      const velProgAbs = Math.abs(r.velProgramada)
      const velSugAbs = r.velSugerida !== null ? Math.abs(r.velSugerida) : velProgAbs
      totalProgramadoMin += (r.tieneRampa ? deltaAbs / velProgAbs : 0) + meseta
      totalSugeridoMin += (r.tieneRampa ? deltaAbs / velSugAbs : 0) + meseta
    }
    tablaResumen += 'Nota: la alarma de rampa lenta dispara si una etapa tarda 15 min mas que su duracion teorica (=|delta T|/velocidad programada). "riesgo alarma" = atraso mayor a 10 min. En etapa no alcanzada la sugerida sale del tramo recorrido; la capacidad del horno suele bajar al subir la temperatura (ver RANGOS).\n'
    const totProg = Math.round(totalProgramadoMin)
    const totSug = Math.round(totalSugeridoMin)
    const dif = totSug - totProg
    const tituloDuracion = pIni > 0
      ? `DURACION RESTANTE DESDE EL PASO ${pIni + 1} (desde ${Math.round(snapshot.anclaTemp ?? 0)} C)`
      : 'DURACION TOTAL DEL PROGRAMA'
    tablaResumen += `${tituloDuracion}: programada ${totProg} min | con velocidades sugeridas ${totSug} min | diferencia ${dif >= 0 ? '+' : ''}${dif} min\n`
  }

  let tablaRangos = 'RANGOS DE TEMPERATURA - rampa observada (C/min): promedio por banda, minima y maxima en ventanas de 5 min\n'
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

// Rampa por banda de 100 C. No usa pares consecutivos: el historial puede traer
// varias muestras con el mismo t (sello de minuto entero), y dividir por esos
// dt subestima la rampa. Promedio = primer y ultimo punto de la banda; min/max =
// ventanas de 5 min, asignadas a la banda del punto donde arranca la ventana.
function calcularRangosRampa(puntos: { t: number; temp: number }[]) {
  const BANDA = 100
  const MIN_MS = 60000
  const VENTANA_MS = 5 * MIN_MS
  const orden = [...puntos].sort((a, b) => a.t - b.t)
  const bandaDe = (temp: number) => Math.floor(temp / BANDA) * BANDA

  // Promedio por banda: (tempUltima - tempPrimera) / (tUltimo - tPrimero)
  const extremos = new Map<number, { primero: { t: number; temp: number }; ultimo: { t: number; temp: number } }>()
  for (const p of orden) {
    const banda = bandaDe(p.temp)
    const e = extremos.get(banda)
    if (!e) extremos.set(banda, { primero: p, ultimo: p })
    else e.ultimo = p
  }

  // Ventanas de 5 min: min y max por banda de arranque
  const ventanas = new Map<number, { min: number; max: number }>()
  let j = 0
  for (let i = 0; i < orden.length; i++) {
    if (j < i) j = i
    while (j < orden.length && orden[j].t - orden[i].t < VENTANA_MS) j++
    if (j >= orden.length) break  // desde aca ninguna ventana completa de 5 min
    const rampa = (orden[j].temp - orden[i].temp) / ((orden[j].t - orden[i].t) / MIN_MS)
    const banda = bandaDe(orden[i].temp)
    const v = ventanas.get(banda)
    if (!v) ventanas.set(banda, { min: rampa, max: rampa })
    else { v.min = Math.min(v.min, rampa); v.max = Math.max(v.max, rampa) }
  }

  const salida: { desde: number; hasta: number; min: number; max: number; promedio: number }[] = []
  for (const [desde, e] of extremos) {
    const dtMs = e.ultimo.t - e.primero.t
    if (e.primero === e.ultimo || dtMs < MIN_MS) continue  // menos de 2 puntos o menos de 1 min: sin dato
    const promedio = (e.ultimo.temp - e.primero.temp) / (dtMs / MIN_MS)
    const v = ventanas.get(desde)
    salida.push({ desde, hasta: desde + BANDA, min: v ? v.min : promedio, max: v ? v.max : promedio, promedio })
  }
  return salida.sort((a, b) => a.desde - b.desde)
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
  disparar falsas alarmas de rampa lenta.
  Sugerir velocidades iguales o menores al 90 por ciento del promedio observado en cada tramo, para dejar margen contra falsas alarmas de rampa lenta.`

  const bandas = calcularRangosRampa(snapshot.historialTemp)
  let tablaRangos = 'RANGOS DE TEMPERATURA - rampa observada (C/min): promedio por banda, minima y maxima en ventanas de 5 min\n'
  tablaRangos += 'Rango (C) | Minima | Maxima | Promedio\n'
  for (const b of bandas) {
    tablaRangos += `${b.desde}-${b.hasta} | ${b.min.toFixed(1)} | ${b.max.toFixed(1)} | ${b.promedio.toFixed(1)}\n`
  }

  let tablaDatos = 'DATOS (minuto, temp real C)\n'
  for (const p of snapshot.historialTemp) {
    const minuto = ((p.t - snapshot.tInicio) / 60000).toFixed(2)
    tablaDatos += `${minuto}, ${p.temp}\n`
  }

  const aviso = ultimoMotivoRecuperacion
    ? `AVISO: no se pudo recuperar el programa del historial (motivo: ${ultimoMotivoRecuperacion}). El analisis es solo de capacidad del horno.\n\n`
    : ''
  const contenido = `[PROMPT - pegar este archivo completo en cualquier chat de IA]\n${prompt}\n\n${aviso}${tablaRangos}\n${tablaDatos}`
  descargarTexto(nombreArchivo, contenido)
}
