import { STORAGE_KEYS } from '../utils/constants'
import type { Horneada, HorneadaFirmware } from '../types/horno'
import { hornoRequest } from './hornoService'

function motivoDesdeEstado(estado?: number, motivo?: string): string {
  if (motivo) return motivo
  if (estado === 0) return 'normal'
  if (estado === 1) return 'detenido'
  if (estado === 2) return 'emergencia'
  return 'normal'
}

function normalizarESP32(r: HorneadaFirmware): Horneada {
  return {
    id:              String(r.timestamp ?? ''),
    programa:        r.nombre ?? '',
    tempMax:         r.temp_max ?? 0,
    kWhConsumidos:   r.kwh ?? 0,
    costo:           r.costo ?? 0,
    duracionHoras:   Math.floor((r.duracion_min ?? 0) / 60),
    duracionMinutos: (r.duracion_min ?? 0) % 60,
    timestamp:       r.timestamp ?? 0,
    motivo:          motivoDesdeEstado(r.estado, r.motivo),
  }
}

function getDeletedSet(hornoId: string): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.HISTORIAL_BORRADOS(hornoId))
    if (raw) return new Set(JSON.parse(raw) as string[])
  } catch {}
  return new Set()
}

function saveDeletedSet(hornoId: string, set: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEYS.HISTORIAL_BORRADOS(hornoId), JSON.stringify([...set]))
  } catch {}
}

export function getHistorialCache(hornoId: string): Horneada[] {
  if (!hornoId) return []
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.HISTORIAL_CACHE(hornoId))
    if (raw) return JSON.parse(raw) as Horneada[]
  } catch {}
  return []
}

export async function getHistorial(hornoId: string): Promise<Horneada[]> {
  const deleted = getDeletedSet(hornoId)
  try {
    const res = await hornoRequest(hornoId, 'historial', 'GET')
    const data = res.data as { registros: HorneadaFirmware[] }
    let lista = (data.registros ?? []).map(normalizarESP32)
    if (deleted.size > 0) lista = lista.filter(r => !deleted.has(String(r.timestamp)))
    try {
      localStorage.setItem(STORAGE_KEYS.HISTORIAL_CACHE(hornoId), JSON.stringify(lista))
    } catch {}
    return lista
  } catch {
    const cached = getHistorialCache(hornoId)
    if (deleted.size > 0) return cached.filter(r => !deleted.has(String(r.timestamp)))
    return cached
  }
}

export function deleteHistorialItem(hornoId: string, timestamp: number): void {
  const ts = String(timestamp)
  const deleted = getDeletedSet(hornoId)
  deleted.add(ts)
  saveDeletedSet(hornoId, deleted)
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.HISTORIAL_CACHE(hornoId))
    if (raw) {
      const lista = (JSON.parse(raw) as Horneada[]).filter(r => String(r.timestamp) !== ts)
      localStorage.setItem(STORAGE_KEYS.HISTORIAL_CACHE(hornoId), JSON.stringify(lista))
    }
  } catch {}
}

export async function deleteHistorialAll(hornoId: string): Promise<void> {
  await hornoRequest(hornoId, 'historial', 'DELETE')
  localStorage.removeItem(STORAGE_KEYS.HISTORIAL_CACHE(hornoId))
  localStorage.removeItem(STORAGE_KEYS.HISTORIAL_BORRADOS(hornoId))
}
