import { HTTP_TIMEOUT, AP_IP, STORAGE_KEYS } from '../utils/constants'
import type { InfoHorno, Programa, ConfigHorno } from '../types/horno'
import { mqttRequest } from './mqttService'

async function fetchTimeout(url: string, opts: RequestInit = {}, timeout = HTTP_TIMEOUT) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal })
    return res
  } finally {
    clearTimeout(timer)
  }
}

// Login: recibe IP directa, sin hornoId ni cache todavía
export async function getInfo(ip: string): Promise<InfoHorno> {
  const res = await fetchTimeout(`http://${ip}/info`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function scanWifi(hornoId: string) {
  return (await hornoRequest(hornoId, 'wifi/scan', 'GET')).data
}

export async function getEstado(hornoId: string) {
  return (await hornoRequest(hornoId, 'estado', 'GET')).data
}

export async function getProgramas(hornoId: string): Promise<Programa[]> {
  return (await hornoRequest(hornoId, 'programas', 'GET')).data as Programa[]
}

export async function getHistorial(hornoId: string) {
  return (await hornoRequest(hornoId, 'historial', 'GET')).data
}

export async function deleteHistorial(hornoId: string) {
  return (await hornoRequest(hornoId, 'historial', 'DELETE')).data
}

export async function getCurva(hornoId: string) {
  return (await hornoRequest(hornoId, 'curva', 'GET')).data
}

export async function getConfig(hornoId: string): Promise<ConfigHorno> {
  return (await hornoRequest(hornoId, 'config', 'GET')).data as ConfigHorno
}

export async function postConfig(
  hornoId: string,
  config: { nombre?: string; potencia?: number }
) {
  return (await hornoRequest(hornoId, 'config', 'POST', JSON.stringify(config))).data
}

export async function postComando(hornoId: string, comando: string) {
  return (await hornoRequest(hornoId, 'comando', 'POST', JSON.stringify({ comando }))).data
}

export async function probeAP(): Promise<boolean> {
  try {
    await fetchTimeout(`http://${AP_IP}/info`, {}, 800)
    return true
  } catch {
    return false
  }
}

export function cacheIP(hornoId: string, ip: string) {
  localStorage.setItem(STORAGE_KEYS.IP_CACHE(hornoId), ip)
}

export function getCachedIP(hornoId: string): string | null {
  return localStorage.getItem(STORAGE_KEYS.IP_CACHE(hornoId))
}

const AP_CACHE = new Map<string, { ip: string; ts: number }>()
const AP_TTL_MS = 60_000

async function resolverIP(hornoId: string): Promise<string | null> {
  const cached = AP_CACHE.get(hornoId)
  if (cached && Date.now() - cached.ts < AP_TTL_MS) {
    return cached.ip
  }

  try {
    const resp = await fetch(`http://${AP_IP}/info`, {
      signal: AbortSignal.timeout(500),
    })
    if (resp.ok) {
      const info = await resp.json()
      if (info.hornoId === hornoId) {
        AP_CACHE.set(hornoId, { ip: AP_IP, ts: Date.now() })
        return AP_IP
      }
    }
  } catch {
    // AP no responde, seguir
  }

  return getCachedIP(hornoId)
}

export async function hornoRequest(
  hornoId: string,
  path: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: string
): Promise<{ status: number; data: unknown }> {
  const ip = await resolverIP(hornoId)
  const password = localStorage.getItem(STORAGE_KEYS.PASS(hornoId))

  if (ip && password) {
    try {
      const opts: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Auth': password,
        },
        signal: AbortSignal.timeout(2000),
      }
      if (body && method !== 'GET') opts.body = body
      const resp = await fetch(`http://${ip}/${path}`, opts)
      const data = await resp.json()
      return { status: resp.status, data }
    } catch {
      // HTTP falló, cae a MQTT
    }
  }

  return mqttRequest(hornoId, path, method, body)
}

if (typeof window !== 'undefined') {
  (window as unknown as { hornoRequest: typeof hornoRequest }).hornoRequest = hornoRequest
}

export async function fetchProgramasOnce(hornoId: string): Promise<Programa[]> {
  try {
    const programas = await getProgramas(hornoId)
    localStorage.setItem(STORAGE_KEYS.PROGRAMAS_CACHE(hornoId), JSON.stringify(programas))
    return programas
  } catch (e) {
    const cached = localStorage.getItem(STORAGE_KEYS.PROGRAMAS_CACHE(hornoId))
    if (cached) return JSON.parse(cached) as Programa[]
    throw e
  }
}
