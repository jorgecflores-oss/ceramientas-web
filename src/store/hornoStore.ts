import { create } from 'zustand'
import type { EstadoMQTT, Horno, Programa, PuntoCurva } from '../types/horno'
import { STORAGE_KEYS } from '../utils/constants'
import { calcularCurvaTeorica } from '../utils/curvaTeorica'

interface AnclaStorage {
  timestampInicio: number
  tempInicio: number
  programa: Programa
}

interface HornoState {
  hornoActivo: Horno | null
  password: string | null
  estado: EstadoMQTT | null
  mqttConectado: boolean
  historialTemp: { t: number; temp: number }[]
  programas: Programa[]
  programaActivo: Programa | null
  puntosTeoricos: PuntoCurva[]
  tInicio: number | null
  tempInicio: number | null

  setHorno: (h: Horno, pass: string) => void
  clearHorno: () => void
  setEstado: (e: EstadoMQTT) => void
  setMqttConectado: (c: boolean) => void
  pushTemp: (temp: number) => void
  resetHistorial: () => void
  setProgramas: (p: Programa[]) => void
  setCurvaTeorica: (programa: Programa, puntos: PuntoCurva[], tInicio: number, tempInicio: number) => void
  clearCurvaTeorica: () => void
  loadCurvaFromStorage: () => void
  loadFromStorage: () => void
}

const MAX_HISTORIAL = 500
let debounceCurvaTimer: ReturnType<typeof setTimeout> | null = null

export const useHornoStore = create<HornoState>((set, get) => ({
  hornoActivo: null,
  password: null,
  estado: null,
  mqttConectado: false,
  historialTemp: [],
  programas: [],
  programaActivo: null,
  puntosTeoricos: [],
  tInicio: null,
  tempInicio: null,

  setHorno: (h, pass) => {
    localStorage.setItem(STORAGE_KEYS.HORNO_ID, h.hornoId)
    localStorage.setItem(STORAGE_KEYS.PASS(h.hornoId), pass)
    if (h.ip) {
      localStorage.setItem(STORAGE_KEYS.IP_CACHE(h.hornoId), h.ip)
    }
    if (h.potencia) {
      localStorage.setItem(STORAGE_KEYS.POTENCIA(h.hornoId), String(h.potencia))
    }
    set({ hornoActivo: h, password: pass })
  },

  clearHorno: () => {
    const id = get().hornoActivo?.hornoId
    if (id) {
      localStorage.removeItem(STORAGE_KEYS.PASS(id))
      localStorage.removeItem(STORAGE_KEYS.INICIO(id))
      localStorage.removeItem(STORAGE_KEYS.PROGRAMAS_CACHE(id))
    }
    localStorage.removeItem(STORAGE_KEYS.HORNO_ID)
    set({
      hornoActivo: null,
      password: null,
      estado: null,
      historialTemp: [],
      programas: [],
      programaActivo: null,
      puntosTeoricos: [],
      tInicio: null,
      tempInicio: null,
    })
  },

  setEstado: (e) => set({ estado: e }),

  setMqttConectado: (c) => set({ mqttConectado: c }),

  pushTemp: (temp) => {
    const arr = get().historialTemp
    const nuevo = [...arr, { t: Date.now(), temp }]
    if (nuevo.length > MAX_HISTORIAL) nuevo.shift()
    set({ historialTemp: nuevo })

    const id = get().hornoActivo?.hornoId
    if (!id) return

    if (debounceCurvaTimer) clearTimeout(debounceCurvaTimer)
    debounceCurvaTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEYS.CURVA(id), JSON.stringify(nuevo))
      } catch (e) {
        console.error('[pushTemp persist]', e)
      }
    }, 2000)
  },

  resetHistorial: () => set({ historialTemp: [] }),

  setProgramas: (p) => {
    const id = get().hornoActivo?.hornoId
    if (id) {
      localStorage.setItem(STORAGE_KEYS.PROGRAMAS_CACHE(id), JSON.stringify(p))
    }
    set({ programas: p })
  },

  setCurvaTeorica: (programa, puntos, tInicio, tempInicio) => {
    const id = get().hornoActivo?.hornoId
    if (id) {
      const ancla: AnclaStorage = { timestampInicio: tInicio, tempInicio, programa }
      localStorage.setItem(STORAGE_KEYS.INICIO(id), JSON.stringify(ancla))
    }
    set({ programaActivo: programa, puntosTeoricos: puntos, tInicio, tempInicio })
  },

  clearCurvaTeorica: () => {
    const id = get().hornoActivo?.hornoId
    if (id) {
      localStorage.removeItem(STORAGE_KEYS.INICIO(id))
      localStorage.removeItem(STORAGE_KEYS.CURVA(id))
    }
    set({ programaActivo: null, puntosTeoricos: [], tInicio: null, tempInicio: null, historialTemp: [] })
  },

  loadCurvaFromStorage: () => {
    const id = get().hornoActivo?.hornoId
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
      set({
        programaActivo: ancla.programa,
        tInicio: ancla.timestampInicio,
        tempInicio: ancla.tempInicio,
        puntosTeoricos: puntos,
      })
      try {
        const rawCurva = localStorage.getItem(STORAGE_KEYS.CURVA(id))
        if (rawCurva) {
          const historial = JSON.parse(rawCurva) as { t: number; temp: number }[]
          set({ historialTemp: historial })
        }
      } catch (e) {
        console.error('[loadCurvaFromStorage curva real]', e)
      }
    } catch (e) {
      console.error('[loadCurvaFromStorage]', e)
    }
  },

  loadFromStorage: () => {
    const id = localStorage.getItem(STORAGE_KEYS.HORNO_ID)
    if (!id) return
    const pass = localStorage.getItem(STORAGE_KEYS.PASS(id))
    if (!pass) return
    const ip = localStorage.getItem(STORAGE_KEYS.IP_CACHE(id))
    const pot = localStorage.getItem(STORAGE_KEYS.POTENCIA(id))

    const programasRaw = localStorage.getItem(STORAGE_KEYS.PROGRAMAS_CACHE(id))
    const programas: Programa[] = programasRaw ? (JSON.parse(programasRaw) as Programa[]) : []

    let programaActivo: Programa | null = null
    let tInicio: number | null = null
    let tempInicio: number | null = null
    const inicioRaw = localStorage.getItem(STORAGE_KEYS.INICIO(id))
    if (inicioRaw) {
      try {
        const ancla = JSON.parse(inicioRaw) as AnclaStorage
        programaActivo = ancla.programa
        tInicio = ancla.timestampInicio
        tempInicio = ancla.tempInicio
      } catch {}
    }

    set({
      hornoActivo: { hornoId: id, nombre: `Horno ${id.slice(-6)}`, ip: ip ?? undefined, potencia: pot ? Number(pot) : undefined },
      password: pass,
      programas,
      programaActivo,
      tInicio,
      tempInicio,
    })
  },
}))
