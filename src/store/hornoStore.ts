import { create } from 'zustand'
import type { EstadoMQTT, Horno, Programa, PuntoCurva } from '../types/horno'
import { STORAGE_KEYS } from '../utils/constants'

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
    }
    set({ programaActivo: null, puntosTeoricos: [], tInicio: null, tempInicio: null })
  },

  loadCurvaFromStorage: () => {
    const id = get().hornoActivo?.hornoId
    if (!id) return
    const raw = localStorage.getItem(STORAGE_KEYS.INICIO(id))
    if (!raw) return
    try {
      const ancla = JSON.parse(raw) as AnclaStorage
      set({
        programaActivo: ancla.programa,
        tInicio: ancla.timestampInicio,
        tempInicio: ancla.tempInicio,
      })
    } catch {}
  },

  loadFromStorage: () => {
    const id = localStorage.getItem(STORAGE_KEYS.HORNO_ID)
    if (!id) return
    const pass = localStorage.getItem(STORAGE_KEYS.PASS(id))
    if (!pass) return
    const ip = localStorage.getItem(STORAGE_KEYS.IP_CACHE(id))

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
      hornoActivo: { hornoId: id, nombre: `Horno ${id.slice(-6)}`, ip: ip ?? undefined },
      password: pass,
      programas,
      programaActivo,
      tInicio,
      tempInicio,
    })
  },
}))
