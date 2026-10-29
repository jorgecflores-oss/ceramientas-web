import { useHornoStore, anclaCurva, anclaGuardada, UNIX_MINIMO } from '../store/hornoStore'
import type { Snapshot } from '../store/hornoStore'
import { paginarCurvaCompleta, getEventosCompletos } from '../services/hornoService'
import type { EventoFirmware, RespEventos } from '../services/hornoService'
import { STORAGE_KEYS } from './constants'

// Tope de espera de cada consulta al controlador al exportar (curva y eventos por separado).
const TIMEOUT_MS = 5000
// Hueco entre puntos reales a partir del cual se avisa
const HUECO_MIN = 3

type EstadoCompletar = 'ok' | 'sin_respuesta' | 'vacio' | 'otra_horneada' | 'no_verificable'

const MOTIVO_NO_COMPLETA: Record<Exclude<EstadoCompletar, 'ok'>, string> = {
  sin_respuesta: 'el controlador no respondio en 5 s',
  vacio: 'el controlador no tiene curva en RAM (se reinicio o ya no guarda esta horneada)',
  otra_horneada: 'el controlador ya tiene otra horneada en su curva',
  no_verificable: 'no se pudo verificar que la curva del controlador sea la misma horneada (sin fecha de inicio valida)',
}

export interface ExtraExport {
  // Lineas AVISO ya armadas (completado, motivo, datos incompletos, huecos, minuto de horneada)
  avisos: string[]
  // true = los datos pueden terminar antes que la horneada: ningun tramo se declara "no alcanzada"
  datosIncompletos: boolean
  // null = /eventos no disponible (firmware viejo, sin respuesta o horneada distinta)
  eventos: EventoFirmware[] | null
  eventosInfo: { horaValida: boolean; horaFuente: string; logOk: boolean } | null
  // Origen (ms) del reloj de horneada del equipo: t0/epoch de /curva. null = desconocido.
  ancla: number | null
  // Minutos que hay entre ese origen y el primer dato (DATOS cuenta desde el primer dato)
  offsetMin: number
}

// Ordena por tiempo, deja un punto por minuto repetido (el ultimo registrado) y descarta no finitos.
// La curva del firmware sella minutos enteros: varias muestras comparten t.
export function limpiarPuntos(pts: { t: number; temp: number }[]): { t: number; temp: number }[] {
  const ordenados = pts
    .filter(p => Number.isFinite(p.t) && Number.isFinite(p.temp))
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (a.p.t - b.p.t) || (a.i - b.i))
    .map(x => x.p)
  const salida: { t: number; temp: number }[] = []
  for (const p of ordenados) {
    if (salida.length > 0 && salida[salida.length - 1].t === p.t) salida[salida.length - 1] = p
    else salida.push(p)
  }
  return salida
}

function conTimeout<T>(p: Promise<T>, ms: number, cancelar: { v: boolean }): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const tope = new Promise<'timeout'>(res => {
    timer = setTimeout(() => { cancelar.v = true; res('timeout') }, ms)
  })
  return Promise.race([p, tope]).finally(() => { if (timer !== undefined) clearTimeout(timer) })
}

interface ResultadoCompletar {
  estado: EstadoCompletar
  snap: Snapshot
  agregados: number
}

// Pide al controlador la curva completa y la fusiona con las mismas acciones del store que usa la
// app abierta (rebasarCurva + reemplazarCurvaCompleta: conserva lo previo al buffer del equipo, mantiene
// ancla y rebase). Solo si la curva del equipo es de la misma horneada (mismo epoch): si no, no toca nada.
async function completarCurva(hornoId: string, snap: Snapshot, cancelar: { v: boolean }): Promise<ResultadoCompletar> {
  const sin = (estado: EstadoCompletar): ResultadoCompletar => ({ estado, snap, agregados: 0 })
  let pag: Awaited<ReturnType<typeof paginarCurvaCompleta>>
  try {
    pag = await paginarCurvaCompleta(hornoId, cancelar)
  } catch {
    return sin('sin_respuesta')
  }
  if (cancelar.v) return sin('sin_respuesta')
  const store = useHornoStore.getState()
  const epochStore = store.curvaEpochMap[hornoId] ?? null
  if (pag.epoch <= UNIX_MINIMO || epochStore === null) return sin('no_verificable')
  if (epochStore !== pag.epoch) return sin('otra_horneada')
  if (pag.pts.length === 0) return sin('vacio')

  const respAncla = { epoch: pag.epoch, t0: pag.t0 }
  const anclaAntes = anclaGuardada(store.tIniciosMap[hornoId], hornoId, pag.epoch)
  const rebasado = store.rebasarCurva(hornoId, respAncla, pag.pts[0].m)
  const anclaReal = anclaCurva(respAncla) ?? anclaAntes ?? snap.tInicio
  useHornoStore.getState().reemplazarCurvaCompleta(hornoId, pag.epoch, pag.desde, anclaReal, pag.pts, pag.f)

  const s2 = useHornoStore.getState()
  let hist = s2.historialTemps[hornoId] ?? []
  if (hist.length === 0) return sin('vacio')
  const anclaDespues = s2.tIniciosMap[hornoId] ?? anclaReal
  // Si el rebase movio el origen del reloj, la teorica del snapshot (anclada al origen viejo) se corre igual
  const delta = rebasado && anclaAntes !== null ? anclaDespues - anclaAntes : 0
  const previos = snap.historialTemp.map(p => ({ t: p.t + delta, temp: p.temp }))
  // Red de seguridad: si el store perdio el tramo inicial que el snapshot si tenia, se antepone
  if (previos.length > 0 && previos[0].t < hist[0].t - 60000) {
    hist = [...previos.filter(p => p.t < hist[0].t), ...hist]
  }
  const ultimoT = hist[hist.length - 1].t
  const tInicio = hist[0].t
  const nuevo: Snapshot = {
    ...snap,
    historialTemp: hist,
    puntosTeoricos: delta !== 0 ? snap.puntosTeoricos.map(p => ({ ...p, t: p.t + delta })) : snap.puntosTeoricos,
    tInicio,
    xAhoraFinal: (ultimoT - tInicio) / 60000,
  }
  // La pantalla muestra la curva completa (con programa y teorica intactos)
  try { localStorage.setItem(STORAGE_KEYS.SNAPSHOT(hornoId), JSON.stringify(nuevo)) } catch { /* sin storage: queda en memoria */ }
  useHornoStore.setState(s => ({
    snapshots: { ...s.snapshots, [hornoId]: nuevo },
    ...(s.hornoActivoId === hornoId ? { snapshot: nuevo } : {}),
  }))
  return { estado: 'ok', snap: nuevo, agregados: Math.max(0, hist.length - snap.historialTemp.length) }
}

// Eventos: ordenados por seq (orden en que se registraron) y sin repetidos identicos.
function normalizarEventos(ev: EventoFirmware[]): EventoFirmware[] {
  const ordenados = [...ev].sort((a, b) => a.q - b.q)
  const vistos = new Set<string>()
  const salida: EventoFirmware[] = []
  for (const e of ordenados) {
    const clave = `${e.tp}|${e.m}|${e.e}|${e.t}|${e.et}|${e.x ?? ''}`
    if (vistos.has(clave)) continue
    vistos.add(clave)
    salida.push(e)
  }
  return salida
}

const dos = (n: number) => String(n).padStart(2, '0')

export function fmtHora(epochSeg: number): string {
  const d = new Date(epochSeg * 1000)
  return `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()} ${dos(d.getHours())}:${dos(d.getMinutes())}`
}

export async function prepararExportacion(hornoId: string, snapOriginal: Snapshot): Promise<{ snap: Snapshot; extra: ExtraExport }> {
  const avisos: string[] = []

  // 1. Completar la curva desde la RAM del controlador (tope 5 s)
  const cancelarC = { v: false }
  let comp: ResultadoCompletar
  try {
    const r = await conTimeout(completarCurva(hornoId, snapOriginal, cancelarC), TIMEOUT_MS, cancelarC)
    comp = r === 'timeout' ? { estado: 'sin_respuesta', snap: snapOriginal, agregados: 0 } : r
  } catch {
    comp = { estado: 'sin_respuesta', snap: snapOriginal, agregados: 0 }
  }
  const completoOk = comp.estado === 'ok'
  const snap: Snapshot = { ...comp.snap, historialTemp: limpiarPuntos(comp.snap.historialTemp) }
  const datos = snap.historialTemp
  const datosIncompletos = !completoOk && comp.snap.terminada !== true

  // 2. Eventos de la horneada (tope 5 s). No se piden si el controlador no respondio (offline) ni si
  // ya tiene otra horneada: sus eventos serian de esa otra.
  let resp: RespEventos | null = null
  if (comp.estado !== 'sin_respuesta' && comp.estado !== 'otra_horneada') {
    const cancelarE = { v: false }
    try {
      const r = await conTimeout(getEventosCompletos(hornoId, cancelarE), TIMEOUT_MS, cancelarE)
      resp = r === 'timeout' ? null : r
    } catch {
      resp = null
    }
  }
  const eventos = resp ? normalizarEventos(resp.ev) : null

  // 3. Origen del reloj de horneada (para ubicar eventos y escribir "Minuto 0")
  const s = useHornoStore.getState()
  let ancla: number | null = null
  if (comp.estado !== 'otra_horneada') {
    const epochStore = s.curvaEpochMap[hornoId] ?? null
    const candidato = completoOk
      ? (s.tIniciosMap[hornoId] ?? null)
      : (epochStore !== null ? anclaGuardada(s.tIniciosMap[hornoId], hornoId, epochStore) : null)
    // Descarta un origen que no corresponde a estos datos (p. ej. de otra horneada posterior)
    if (candidato !== null && datos.length > 0 && candidato <= datos[0].t + 60000 && datos[0].t - candidato < 24 * 3600000) ancla = candidato
  }
  const offsetMin = ancla !== null && datos.length > 0 ? Math.max(0, (datos[0].t - ancla) / 60000) : 0

  // 4. Avisos
  if (!completoOk) {
    avisos.push(`AVISO: no se pudo completar la curva desde el controlador (${MOTIVO_NO_COMPLETA[comp.estado as Exclude<EstadoCompletar, 'ok'>]}). Se exportan los datos guardados en la app.`)
  }
  if (completoOk && comp.agregados > 0) {
    avisos.push(`AVISO: ${comp.agregados} puntos completados desde el controlador.`)
  }
  if (datosIncompletos && datos.length > 0) {
    const ult = datos[datos.length - 1]
    avisos.push(`AVISO: datos incompletos. Datos terminan en minuto ${((ult.t - snap.tInicio) / 60000).toFixed(1)}, ${Math.round(ult.temp)} grados. Horneada pudo seguir. No declarar etapa no alcanzada.`)
  }
  if (eventos === null) {
    avisos.push('AVISO: Eventos no disponibles.')
  } else if (resp && !resp.log_ok) {
    avisos.push('AVISO: el registro de eventos del controlador informa fallas (log_ok falso): puede estar incompleto.')
  }
  if (resp && (resp.perdidos ?? 0) > 0) {
    avisos.push(`AVISO: el controlador descarto ${resp.perdidos} eventos por saturacion de su cola.`)
  }

  // Huecos entre puntos reales
  let hayHueco = false
  for (let i = 1; i < datos.length; i++) {
    const durMin = (datos[i].t - datos[i - 1].t) / 60000
    if (durMin <= HUECO_MIN) continue
    hayHueco = true
    const desdeMin = (datos[i - 1].t - snap.tInicio) / 60000
    const hastaMin = (datos[i].t - snap.tInicio) / 60000
    let texto = `AVISO: hueco de ${Math.round(durMin)} min sin datos entre el minuto ${desdeMin.toFixed(1)} y el minuto ${hastaMin.toFixed(1)}.`
    if (eventos && ancla !== null) {
      // m es minuto del reloj de horneada del equipo; DATOS cuenta desde el primer dato
      const dentro = eventos.filter(e => e.m >= 0 && e.m >= desdeMin + offsetMin - 1 && e.m <= hastaMin + offsetMin + 1
        && (e.tp === 'corte_luz' || e.tp === 'reinicio' || e.tp === 'arranque_fresco' || e.tp === 'nvs_reparada'))
      if (dentro.length > 0) {
        texto += ` En ese tramo hay eventos: ${dentro.map(e => `${e.tp} (minuto de horneada ${e.m})`).join(', ')}.`
      }
    }
    avisos.push(texto)
  }
  if (hayHueco && eventos && ancla === null && eventos.some(e => e.tp === 'corte_luz' || e.tp === 'reinicio')) {
    avisos.push('AVISO: hay cortes o reinicios en EVENTOS; no se pudo ubicar en que hueco cayeron.')
  }

  // Minuto 0 en hora real: el reloj de horneada no cuenta el tiempo apagado
  const huboCorte = hayHueco || (eventos?.some(e => e.tp === 'corte_luz' || e.tp === 'reinicio') ?? false)
  if (huboCorte) {
    avisos.push('AVISO: Minuto de horneada no incluye tiempo apagado. Usar la hora de cada evento.')
  }

  return {
    snap,
    extra: {
      avisos,
      datosIncompletos,
      eventos,
      eventosInfo: resp ? { horaValida: resp.hora_valida, horaFuente: resp.hora_fuente, logOk: resp.log_ok } : null,
      ancla,
      offsetMin,
    },
  }
}

function detalleEvento(e: EventoFirmware): string {
  switch (e.tp) {
    case 'reinicio': {
      const x = e.x ?? ''
      return `motivo ${x.replace(/\*$/, '') || 'desconocido'}${x.endsWith('*') ? '; habia horneada activa' : ''}`
    }
    case 'arranque_fresco':
      return `arranque nuevo de horneada; origen ${e.x ?? '?'}`
    case 'ejecutar_ignorado':
      return `comando ${e.x ?? 'ejecutar'} ignorado: ya habia una horneada en marcha`
    case 'nvs_reparada':
      return 'memoria NVS reparada (programas e historial del equipo se borraron)'
    case 'corte_luz': {
      const tipo = e.x === 'M' ? 'reanudacion con diferencia de temperatura chica'
        : e.x === 'R' ? 'reanudacion con diferencia de temperatura grande'
        : e.x === 'Z' ? 'reanudacion indicada por el maestro (multizona)'
        : 'reanudacion sin dato de comparacion'
      const dt = e.dt !== undefined ? `; dT ${e.dt > 0 ? '+' : ''}${e.dt} C` : ''
      const ap = e.ap !== undefined ? `; ${Math.round(e.ap / 60)} min desde el ultimo guardado del equipo (+-3 min)` : ''
      return tipo + dt + ap
    }
    default:
      return e.x ?? ''
  }
}

// Bloque EVENTOS (antes de DATOS). Hora de cada evento = su epoch, nunca minuto + minuto 0.
export function bloqueEventos(extra: ExtraExport): string {
  if (extra.eventos === null) return ''
  let txt = 'EVENTOS DE LA HORNEADA (hora, minuto, tipo, temperatura, etapa, detalle)\n'
  if (extra.eventosInfo) {
    txt += `Hora del equipo: ${extra.eventosInfo.horaValida ? `valida (${extra.eventosInfo.horaFuente})` : 'sin hora valida: los eventos sin hora figuran como "sin hora"'}\n`
  }
  if (extra.eventos.length === 0) {
    txt += '(sin eventos registrados)\n'
  }
  for (const e of extra.eventos) {
    const hora = e.e > 0 ? fmtHora(e.e) : 'sin hora'
    const min = e.m >= 0 ? String(e.m) : '-'
    const temp = e.t === null ? '-' : String(e.t)
    const etapa = e.et > 0 ? String(e.et) : '-'
    txt += `${hora}, ${min}, ${e.tp}, ${temp}, ${etapa}, ${detalleEvento(e)}\n`
  }
  return txt
}

// "Minuto 0 = dd/mm/aaaa hh:mm" con t0 o epoch de /curva. Aclara el desfase de DATOS si no arranca en 0.
export function lineaMinuto0(extra: ExtraExport): string {
  if (extra.ancla === null || extra.ancla <= UNIX_MINIMO * 1000) return ''
  let txt = `Minuto 0 = ${fmtHora(extra.ancla / 1000)} (inicio del reloj de horneada del equipo)\n`
  if (extra.offsetMin > 0.5) {
    txt += `DATOS cuenta los minutos desde el primer dato registrado, que cae en el minuto ${extra.offsetMin.toFixed(1)} del reloj de horneada (los minutos de EVENTOS son del reloj de horneada).\n`
  }
  return txt
}
