import { create } from 'zustand'
import type { EstadoMQTT, Horno } from '../types/horno'
import { STORAGE_KEYS } from '../utils/constants'

interface HornoState {
  hornoActivo: Horno | null
  password: string | null
  estado: EstadoMQTT | null
  mqttConectado: boolean
  historialTemp: { t: number; temp: number }[]

  setHorno: (h: Horno, pass: string) => void
  clearHorno: () => void
  setEstado: (e: EstadoMQTT) => void
  setMqttConectado: (c: boolean) => void
  pushTemp: (temp: number) => void
  resetHistorial: () => void
  loadFromStorage: () => void
}

const MAX_HISTORIAL = 500

export const useHornoStore = create<HornoState>((set, get) => ({
  hornoActivo: null,
  password: null,
  estado: null,
  mqttConectado: false,
  historialTemp: [],

  setHorno: (h, pass) => {
    localStorage.setItem(STORAGE_KEYS.HORNO_ID, h.hornoId)
    localStorage.setItem(STORAGE_KEYS.PASS(h.hornoId), pass)
    set({ hornoActivo: h, password: pass })
  },

  clearHorno: () => {
    const id = get().hornoActivo?.hornoId
    if (id) {
      localStorage.removeItem(STORAGE_KEYS.PASS(id))
    }
    localStorage.removeItem(STORAGE_KEYS.HORNO_ID)
    set({ hornoActivo: null, password: null, estado: null, historialTemp: [] })
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

  loadFromStorage: () => {
    const id = localStorage.getItem(STORAGE_KEYS.HORNO_ID)
    if (!id) return
    const pass = localStorage.getItem(STORAGE_KEYS.PASS(id))
    if (!pass) return
    set({
      hornoActivo: { hornoId: id, nombre: `Horno ${id.slice(-6)}` },
      password: pass,
    })
  },
}))