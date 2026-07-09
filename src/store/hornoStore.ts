import { create } from 'zustand'
import type { EstadoMQTT, Horno, Programa, PuntoCurva } from '../types/horno'
import { STORAGE_KEYS } from '../utils/constants'
import { calcularCurvaTeorica } from '../utils/curvaTeorica'

interface AnclaStorage {
  timestampInicio: number
  tempInicio: number
  programa: Programa
}

export interface Snapshot {
  puntosTeoricos: PuntoCurva[]
  historialTemp: { t: number; temp: number }[]
  tInicio: number
  xAhoraFinal: number
}

interface HornoState {
  // Multi-horno colecciones
  hornos: Horno[]
  hornoActivoId: string | null
  passwords: Record<string, string>
  estados: Record<string, EstadoMQTT | null>
  historialTemps: Record<string, { t: number; temp: number }[]>
  programasCache: Record<string, Programa[]>
  programasActivos: Record<string, Programa | null>
  puntosTeoricosMap: Record<string, PuntoCurva[]>
  tIniciosMap: Record<string, number | null>
  tempIniciosMap: Record<string, number | null>
  mqttConectado: boolean
  ultimoVia: Record<string, 'http' | 'mqtt' | null>
  ultimoRespuestaAt: Record<string, number>

  // Vista single-horno derivada (backward compat)
  hornoActivo: Horno | null
  password: string | null
  estado: EstadoMQTT | null
  historialTemp: { t: number; temp: number }[]
  programas: Programa[]
  programaActivo: Programa | null
  puntosTeoricos: PuntoCurva[]
  tInicio: number | null
  tempInicio: number | null
  ultimosYMax: Record<string, number>
  ultimoYMax: number | null
  snapshots: Record<string, Snapshot | null>
  snapshot: Snapshot | null

  // Acciones multi-horno
  agregarHorno: (h: Horno, pass: string) => void
  quitarHorno: (id: string) => void
  setHornoActivo: (id: string) => void

  // Acciones single-horno (backward compat, firmas idénticas)
  setHorno: (h: Horno, pass: string) => void
  clearHorno: () => void
  setEstado: (e: EstadoMQTT) => void
  setMqttConectado: (c: boolean) => void
  registrarRespuesta: (hornoId: string, via: 'http' | 'mqtt') => void
  pushTemp: (temp: number) => void
  resetHistorial: () => void
  setProgramas: (p: Programa[]) => void
  setCurvaTeorica: (programa: Programa, puntos: PuntoCurva[], tInicio: number, tempInicio: number) => void
  clearCurvaTeorica: () => void
  setUltimoYMax: (id: string, ymax: number) => void
  guardarSnapshot: () => void
  limpiarSnapshot: (id: string) => void
  loadCurvaFromStorage: () => void
  loadFromStorage: () => void
}

const MAX_HISTORIAL = 500
const debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {}

function removeKey<T>(record: Record<string, T>, id: string): Record<string, T> {
  const copy = { ...record }
  delete copy[id]
  return copy
}

function persistirLista(hornos: Horno[]) {
  try {
    localStorage.setItem(STORAGE_KEYS.HORNOS_LISTA, JSON.stringify(hornos))
  } catch (e) {
    console.error('[persistirLista]', e)
  }
}

interface MapsPartial {
  hornos: Horno[]
  hornoActivoId: string | null
  passwords: Record<string, string>
  estados: Record<string, EstadoMQTT | null>
  historialTemps: Record<string, { t: number; temp: number }[]>
  programasCache: Record<string, Programa[]>
  programasActivos: Record<string, Programa | null>
  puntosTeoricosMap: Record<string, PuntoCurva[]>
  tIniciosMap: Record<string, number | null>
  tempIniciosMap: Record<string, number | null>
  ultimosYMax: Record<string, number>
  snapshots: Record<string, Snapshot | null>
}

function derivar(s: MapsPartial) {
  const id = s.hornoActivoId
  const hornoActivo = id ? (s.hornos.find(h => h.hornoId === id) ?? null) : null
  return {
    hornoActivo,
    password: id ? (s.passwords[id] ?? null) : null,
    estado: id ? (s.estados[id] ?? null) : null,
    historialTemp: id ? (s.historialTemps[id] ?? []) : [],
    programas: id ? (s.programasCache[id] ?? []) : [],
    programaActivo: id ? (s.programasActivos[id] ?? null) : null,
    puntosTeoricos: id ? (s.puntosTeoricosMap[id] ?? []) : [],
    tInicio: id ? (s.tIniciosMap[id] ?? null) : null,
    tempInicio: id ? (s.tempIniciosMap[id] ?? null) : null,
    ultimoYMax: id ? (s.ultimosYMax[id] ?? null) : null,
    snapshot: id ? (s.snapshots[id] ?? null) : null,
  }
}

export const useHornoStore = create<HornoState>((set, get) => ({
  // Multi-horno colecciones
  hornos: [],
  hornoActivoId: null,
  passwords: {},
  estados: {},
  historialTemps: {},
  programasCache: {},
  programasActivos: {},
  puntosTeoricosMap: {},
  tIniciosMap: {},
  tempIniciosMap: {},
  mqttConectado: false,
  ultimoVia: {},
  ultimoRespuestaAt: {},

  // Vista derivada — se calculará al cargar desde storage; inicial vacía
  hornoActivo: null,
  password: null,
  estado: null,
  historialTemp: [],
  programas: [],
  programaActivo: null,
  puntosTeoricos: [],
  tInicio: null,
  tempInicio: null,
  ultimosYMax: {},
  ultimoYMax: null,
  snapshots: {},
  snapshot: null,

  // --- Multi-horno ---

  agregarHorno: (h, pass) => {
    const s = get()
    const yaExiste = s.hornos.some(x => x.hornoId === h.hornoId)
    const hornos = yaExiste
      ? s.hornos.map(x => (x.hornoId === h.hornoId ? h : x))
      : [...s.hornos, h]
    const passwords = { ...s.passwords, [h.hornoId]: pass }

    if (h.ip) localStorage.setItem(STORAGE_KEYS.IP_CACHE(h.hornoId), h.ip)
    if (h.potencia) localStorage.setItem(STORAGE_KEYS.POTENCIA(h.hornoId), String(h.potencia))
    localStorage.setItem(STORAGE_KEYS.PASS(h.hornoId), pass)
    persistirLista(hornos)

    const hornoActivoId = s.hornoActivoId ?? h.hornoId
    const maps: MapsPartial = { ...s, hornos, passwords, hornoActivoId }
    set({ hornos, passwords, hornoActivoId, ...derivar(maps) })
  },

  quitarHorno: (id) => {
    const s = get()
    const hornos = s.hornos.filter(h => h.hornoId !== id)
    const passwords = removeKey(s.passwords, id)
    const estados = removeKey(s.estados, id)
    const historialTemps = removeKey(s.historialTemps, id)
    const programasCache = removeKey(s.programasCache, id)
    const programasActivos = removeKey(s.programasActivos, id)
    const puntosTeoricosMap = removeKey(s.puntosTeoricosMap, id)
    const tIniciosMap = removeKey(s.tIniciosMap, id)
    const tempIniciosMap = removeKey(s.tempIniciosMap, id)

    localStorage.removeItem(STORAGE_KEYS.PASS(id))
    localStorage.removeItem(STORAGE_KEYS.IP_CACHE(id))
    localStorage.removeItem(STORAGE_KEYS.POTENCIA(id))
    localStorage.removeItem(STORAGE_KEYS.INICIO(id))
    localStorage.removeItem(STORAGE_KEYS.PROGRAMAS_CACHE(id))
    localStorage.removeItem(STORAGE_KEYS.CURVA(id))
    persistirLista(hornos)

    const hornoActivoId = s.hornoActivoId === id
      ? (hornos[0]?.hornoId ?? null)
      : s.hornoActivoId

    const ultimosYMax = removeKey(s.ultimosYMax, id)
    const snapshots = removeKey(s.snapshots, id)
    localStorage.removeItem(STORAGE_KEYS.SNAPSHOT(id))
    const maps: MapsPartial = {
      hornos, hornoActivoId, passwords, estados, historialTemps,
      programasCache, programasActivos, puntosTeoricosMap, tIniciosMap, tempIniciosMap,
      ultimosYMax, snapshots,
    }
    set({ ...maps, ...derivar(maps) })
  },

  setHornoActivo: (id) => {
    const s = get()
    const maps: MapsPartial = { ...s, hornoActivoId: id }
    set({ hornoActivoId: id, ...derivar(maps) })
  },

  // --- Single-horno backward compat ---

  setHorno: (h, pass) => {
    const s = get()
    const yaExiste = s.hornos.some(x => x.hornoId === h.hornoId)
    const hornos = yaExiste
      ? s.hornos.map(x => (x.hornoId === h.hornoId ? h : x))
      : [...s.hornos, h]
    const passwords = { ...s.passwords, [h.hornoId]: pass }

    localStorage.setItem(STORAGE_KEYS.PASS(h.hornoId), pass)
    localStorage.setItem(STORAGE_KEYS.HORNO_ID, h.hornoId)
    if (h.ip) localStorage.setItem(STORAGE_KEYS.IP_CACHE(h.hornoId), h.ip)
    if (h.potencia) localStorage.setItem(STORAGE_KEYS.POTENCIA(h.hornoId), String(h.potencia))
    persistirLista(hornos)

    const hornoActivoId = h.hornoId
    const maps: MapsPartial = { ...s, hornos, passwords, hornoActivoId }
    set({ hornos, passwords, hornoActivoId, ...derivar(maps) })
  },

  clearHorno: () => {
    const id = get().hornoActivoId
    if (id) {
      localStorage.removeItem(STORAGE_KEYS.PASS(id))
      localStorage.removeItem(STORAGE_KEYS.INICIO(id))
      localStorage.removeItem(STORAGE_KEYS.PROGRAMAS_CACHE(id))
      localStorage.removeItem(STORAGE_KEYS.CURVA(id))
    }
    localStorage.removeItem(STORAGE_KEYS.HORNO_ID)

    const s = get()
    const hornos = id ? s.hornos.filter(h => h.hornoId !== id) : s.hornos
    persistirLista(hornos)

    const passwords = id ? removeKey(s.passwords, id) : s.passwords
    const estados = id ? removeKey(s.estados, id) : s.estados
    const historialTemps = id ? removeKey(s.historialTemps, id) : s.historialTemps
    const programasCache = id ? removeKey(s.programasCache, id) : s.programasCache
    const programasActivos = id ? removeKey(s.programasActivos, id) : s.programasActivos
    const puntosTeoricosMap = id ? removeKey(s.puntosTeoricosMap, id) : s.puntosTeoricosMap
    const tIniciosMap = id ? removeKey(s.tIniciosMap, id) : s.tIniciosMap
    const tempIniciosMap = id ? removeKey(s.tempIniciosMap, id) : s.tempIniciosMap
    const ultimosYMax = id ? removeKey(s.ultimosYMax, id) : s.ultimosYMax
    const snapshots = id ? removeKey(s.snapshots, id) : s.snapshots
    if (id) localStorage.removeItem(STORAGE_KEYS.SNAPSHOT(id))

    const hornoActivoId = hornos[0]?.hornoId ?? null
    const maps: MapsPartial = {
      hornos, hornoActivoId, passwords, estados, historialTemps,
      programasCache, programasActivos, puntosTeoricosMap, tIniciosMap, tempIniciosMap,
      ultimosYMax, snapshots,
    }
    set({ ...maps, ...derivar(maps) })
  },

  setEstado: (e) => {
    const id = get().hornoActivoId
    if (!id) return
    const estados = { ...get().estados, [id]: e }
    set({ estados, estado: e })
  },

  setMqttConectado: (c) => set({ mqttConectado: c }),

  registrarRespuesta: (hornoId, via) => set(state => ({
    ultimoVia: { ...state.ultimoVia, [hornoId]: via },
    ultimoRespuestaAt: { ...state.ultimoRespuestaAt, [hornoId]: Date.now() },
  })),

  pushTemp: (temp) => {
    const id = get().hornoActivoId
    if (!id) return
    const prev = get().historialTemps[id] ?? []
    const nuevo = [...prev, { t: Date.now(), temp }]
    if (nuevo.length > MAX_HISTORIAL) nuevo.shift()
    const historialTemps = { ...get().historialTemps, [id]: nuevo }
    set({ historialTemps, historialTemp: nuevo })

    if (debounceTimers[id]) clearTimeout(debounceTimers[id])
    debounceTimers[id] = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEYS.CURVA(id), JSON.stringify(nuevo))
      } catch (e) {
        console.error('[pushTemp persist]', e)
      }
    }, 2000)
  },

  resetHistorial: () => {
    const id = get().hornoActivoId
    if (!id) return
    const historialTemps = { ...get().historialTemps, [id]: [] }
    set({ historialTemps, historialTemp: [] })
  },

  setProgramas: (p) => {
    const id = get().hornoActivoId
    if (!id) return
    localStorage.setItem(STORAGE_KEYS.PROGRAMAS_CACHE(id), JSON.stringify(p))
    const programasCache = { ...get().programasCache, [id]: p }
    set({ programasCache, programas: p })
  },

  setCurvaTeorica: (programa, puntos, tInicio, tempInicio) => {
    const id = get().hornoActivoId
    if (!id) return
    get().limpiarSnapshot(id)
    const ancla: AnclaStorage = { timestampInicio: tInicio, tempInicio, programa }
    localStorage.setItem(STORAGE_KEYS.INICIO(id), JSON.stringify(ancla))

    const yMaxTeorico = Math.ceil(Math.max(...puntos.map(p => p.temp)) + 40)
    localStorage.setItem(STORAGE_KEYS.ULTIMO_YMAX(id), String(yMaxTeorico))

    const s = get()
    const programasActivos = { ...s.programasActivos, [id]: programa }
    const puntosTeoricosMap = { ...s.puntosTeoricosMap, [id]: puntos }
    const tIniciosMap = { ...s.tIniciosMap, [id]: tInicio }
    const tempIniciosMap = { ...s.tempIniciosMap, [id]: tempInicio }
    const ultimosYMax = { ...s.ultimosYMax, [id]: yMaxTeorico }
    set({
      programasActivos, puntosTeoricosMap, tIniciosMap, tempIniciosMap, ultimosYMax,
      programaActivo: programa, puntosTeoricos: puntos, tInicio, tempInicio,
      ultimoYMax: yMaxTeorico,
    })
  },

  clearCurvaTeorica: () => {
    const id = get().hornoActivoId
    if (!id) return
    get().guardarSnapshot()
    localStorage.removeItem(STORAGE_KEYS.INICIO(id))

    const s = get()
    const programasActivos = { ...s.programasActivos, [id]: null }
    const puntosTeoricosMap = { ...s.puntosTeoricosMap, [id]: [] }
    const tIniciosMap = { ...s.tIniciosMap, [id]: null }
    const tempIniciosMap = { ...s.tempIniciosMap, [id]: null }
    set({
      programasActivos, puntosTeoricosMap, tIniciosMap, tempIniciosMap,
      programaActivo: null, puntosTeoricos: [], tInicio: null, tempInicio: null,
    })
  },

  setUltimoYMax: (id, ymax) => {
    localStorage.setItem(STORAGE_KEYS.ULTIMO_YMAX(id), String(ymax))
    const s = get()
    const ultimosYMax = { ...s.ultimosYMax, [id]: ymax }
    const ultimoYMax = s.hornoActivoId === id ? ymax : s.ultimoYMax
    set({ ultimosYMax, ultimoYMax })
  },

  guardarSnapshot: () => {
    const s = get()
    const id = s.hornoActivoId
    if (!id) return
    const tInicioActual = s.tIniciosMap[id] ?? null
    const puntosTeoricoActuales = s.puntosTeoricosMap[id] ?? []
    const histActual = s.historialTemps[id] ?? []
    if (!tInicioActual || puntosTeoricoActuales.length <= 1 || histActual.length === 0) return
    const lastDataT = histActual[histActual.length - 1].t
    const snap: Snapshot = {
      puntosTeoricos: puntosTeoricoActuales,
      historialTemp: histActual,
      tInicio: tInicioActual,
      xAhoraFinal: (lastDataT - tInicioActual) / 60000,
    }
    try { localStorage.setItem(STORAGE_KEYS.SNAPSHOT(id), JSON.stringify(snap)) } catch {}
    const snapshots = { ...s.snapshots, [id]: snap }
    set({ snapshots, snapshot: snap })
  },

  limpiarSnapshot: (id) => {
    localStorage.removeItem(STORAGE_KEYS.SNAPSHOT(id))
    const s = get()
    const snapshots = { ...s.snapshots, [id]: null }
    const snapshot = s.hornoActivoId === id ? null : s.snapshot
    set({ snapshots, snapshot })
  },

  loadCurvaFromStorage: () => {
    const id = get().hornoActivoId
    if (!id) return
    const raw = localStorage.getItem(STORAGE_KEYS.INICIO(id))
    if (!raw) return
    try {
      const ancla = JSON.parse(raw) as AnclaStorage
      const puntos = calcularCurvaTeorica(
        ancla.programa.pasos,
        ancla.tempInicio,
        ancla.timestampInicio
      )
      const s = get()
      const programasActivos = { ...s.programasActivos, [id]: ancla.programa }
      const puntosTeoricosMap = { ...s.puntosTeoricosMap, [id]: puntos }
      const tIniciosMap = { ...s.tIniciosMap, [id]: ancla.timestampInicio }
      const tempIniciosMap = { ...s.tempIniciosMap, [id]: ancla.tempInicio }
      set({
        programasActivos, puntosTeoricosMap, tIniciosMap, tempIniciosMap,
        programaActivo: ancla.programa,
        puntosTeoricos: puntos,
        tInicio: ancla.timestampInicio,
        tempInicio: ancla.tempInicio,
      })
      try {
        const rawCurva = localStorage.getItem(STORAGE_KEYS.CURVA(id))
        if (rawCurva) {
          const historial = JSON.parse(rawCurva) as { t: number; temp: number }[]
          const historialTemps = { ...get().historialTemps, [id]: historial }
          set({ historialTemps, historialTemp: historial })
        }
      } catch (e) {
        console.error('[loadCurvaFromStorage curva real]', e)
      }
    } catch (e) {
      console.error('[loadCurvaFromStorage]', e)
    }
  },

  loadFromStorage: () => {
    // Intentar cargar lista multi-horno primero
    const listaRaw = localStorage.getItem(STORAGE_KEYS.HORNOS_LISTA)
    if (listaRaw) {
      try {
        const hornos = JSON.parse(listaRaw) as Horno[]
        if (hornos.length === 0) return

        const passwords: Record<string, string> = {}
        for (const h of hornos) {
          const p = localStorage.getItem(STORAGE_KEYS.PASS(h.hornoId))
          if (p) passwords[h.hornoId] = p
          const ip = localStorage.getItem(STORAGE_KEYS.IP_CACHE(h.hornoId))
          if (ip) h.ip = ip
          const pot = localStorage.getItem(STORAGE_KEYS.POTENCIA(h.hornoId))
          if (pot) h.potencia = Number(pot)
        }

        const programasCache: Record<string, Programa[]> = {}
        const programasActivos: Record<string, Programa | null> = {}
        const tIniciosMap: Record<string, number | null> = {}
        const tempIniciosMap: Record<string, number | null> = {}
        const historialTemps: Record<string, { t: number; temp: number }[]> = {}
        const puntosTeoricosMap: Record<string, PuntoCurva[]> = {}
        const ultimosYMax: Record<string, number> = {}
        const snapshots: Record<string, Snapshot | null> = {}

        for (const h of hornos) {
          const id = h.hornoId

          const ymaxRaw = localStorage.getItem(STORAGE_KEYS.ULTIMO_YMAX(id))
          if (ymaxRaw) ultimosYMax[id] = Number(ymaxRaw)

          const snapRaw = localStorage.getItem(STORAGE_KEYS.SNAPSHOT(id))
          if (snapRaw) {
            try { snapshots[id] = JSON.parse(snapRaw) as Snapshot } catch {}
          }

          const progRaw = localStorage.getItem(STORAGE_KEYS.PROGRAMAS_CACHE(id))
          if (progRaw) {
            try { programasCache[id] = JSON.parse(progRaw) as Programa[] } catch {}
          }

          const curvaRaw = localStorage.getItem(STORAGE_KEYS.CURVA(id))
          if (curvaRaw) {
            try { historialTemps[id] = JSON.parse(curvaRaw) as { t: number; temp: number }[] } catch {}
          }

          const inicioRaw = localStorage.getItem(STORAGE_KEYS.INICIO(id))
          if (inicioRaw) {
            try {
              const ancla = JSON.parse(inicioRaw) as AnclaStorage
              programasActivos[id] = ancla.programa
              tIniciosMap[id] = ancla.timestampInicio
              tempIniciosMap[id] = ancla.tempInicio
              puntosTeoricosMap[id] = calcularCurvaTeorica(
                ancla.programa.pasos,
                ancla.tempInicio,
                ancla.timestampInicio
              )
            } catch {}
          }
        }

        // Horno activo: preferir el que estaba activo antes (HORNO_ID legacy)
        const lastId = localStorage.getItem(STORAGE_KEYS.HORNO_ID)
        const hornoActivoId = (lastId && hornos.some(h => h.hornoId === lastId))
          ? lastId
          : hornos[0].hornoId

        const maps: MapsPartial = {
          hornos, hornoActivoId, passwords, estados: {},
          historialTemps, programasCache, programasActivos,
          puntosTeoricosMap, tIniciosMap, tempIniciosMap,
          ultimosYMax, snapshots,
        }
        set({ ...maps, ...derivar(maps) })
        return
      } catch (e) {
        console.error('[loadFromStorage lista]', e)
      }
    }

    // Migración desde storage single-horno legacy
    const id = localStorage.getItem(STORAGE_KEYS.HORNO_ID)
    if (!id) return
    const pass = localStorage.getItem(STORAGE_KEYS.PASS(id))
    if (!pass) return
    const ip = localStorage.getItem(STORAGE_KEYS.IP_CACHE(id)) ?? undefined
    const pot = localStorage.getItem(STORAGE_KEYS.POTENCIA(id))

    const horno: Horno = {
      hornoId: id,
      nombre: `Horno ${id.slice(-6)}`,
      ip,
      potencia: pot ? Number(pot) : undefined,
    }
    const hornos = [horno]
    persistirLista(hornos)

    const passwords = { [id]: pass }
    const programasCache: Record<string, Programa[]> = {}
    const programasActivos: Record<string, Programa | null> = {}
    const tIniciosMap: Record<string, number | null> = {}
    const tempIniciosMap: Record<string, number | null> = {}
    const historialTemps: Record<string, { t: number; temp: number }[]> = {}
    const puntosTeoricosMap: Record<string, PuntoCurva[]> = {}
    const ultimosYMax: Record<string, number> = {}
    const snapshots: Record<string, Snapshot | null> = {}

    const ymaxRaw = localStorage.getItem(STORAGE_KEYS.ULTIMO_YMAX(id))
    if (ymaxRaw) ultimosYMax[id] = Number(ymaxRaw)

    const snapRaw = localStorage.getItem(STORAGE_KEYS.SNAPSHOT(id))
    if (snapRaw) {
      try { snapshots[id] = JSON.parse(snapRaw) as Snapshot } catch {}
    }

    const progRaw = localStorage.getItem(STORAGE_KEYS.PROGRAMAS_CACHE(id))
    if (progRaw) {
      try { programasCache[id] = JSON.parse(progRaw) as Programa[] } catch {}
    }

    const curvaRaw = localStorage.getItem(STORAGE_KEYS.CURVA(id))
    if (curvaRaw) {
      try { historialTemps[id] = JSON.parse(curvaRaw) as { t: number; temp: number }[] } catch {}
    }

    const inicioRaw = localStorage.getItem(STORAGE_KEYS.INICIO(id))
    if (inicioRaw) {
      try {
        const ancla = JSON.parse(inicioRaw) as AnclaStorage
        programasActivos[id] = ancla.programa
        tIniciosMap[id] = ancla.timestampInicio
        tempIniciosMap[id] = ancla.tempInicio
        puntosTeoricosMap[id] = calcularCurvaTeorica(
          ancla.programa.pasos,
          ancla.tempInicio,
          ancla.timestampInicio
        )
      } catch {}
    }

    const maps: MapsPartial = {
      hornos, hornoActivoId: id, passwords, estados: {},
      historialTemps, programasCache, programasActivos,
      puntosTeoricosMap, tIniciosMap, tempIniciosMap,
      ultimosYMax, snapshots,
    }
    set({ ...maps, ...derivar(maps) })
  },
}))
