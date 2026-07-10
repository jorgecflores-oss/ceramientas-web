import { HTTP_TIMEOUT, AP_IP, STORAGE_KEYS, OTA_VERSION_URL } from '../utils/constants'
import type { InfoHorno, Programa, ConfigHorno } from '../types/horno'
import { mqttRequest } from './mqttService'
import { useHornoStore } from '../store/hornoStore'

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
  const resp = await hornoRequest(hornoId, 'estado', 'GET')
  useHornoStore.getState().registrarRespuesta(hornoId, resp.via)
  return resp.data
}

export async function getProgramas(hornoId: string): Promise<Programa[]> {
  const resp = await hornoRequest(hornoId, 'programas', 'GET')
  useHornoStore.getState().registrarRespuesta(hornoId, resp.via)
  return resp.data as Programa[]
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
  const resp = await hornoRequest(hornoId, 'config', 'GET')
  useHornoStore.getState().registrarRespuesta(hornoId, resp.via)
  return resp.data as ConfigHorno
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

export async function postPrograma(
  hornoId: string,
  idx: number,
  data: { tempFinal?: number; nombre?: string; pasos?: import('../types/horno').Paso[] }
) {
  return (await hornoRequest(hornoId, `programas/${idx}`, 'POST', JSON.stringify(data))).data
}

export async function deletePrograma(hornoId: string, idx: number) {
  return (await hornoRequest(hornoId, `programas/${idx}`, 'DELETE')).data
}

export async function postOTA(hornoId: string): Promise<{ ok: boolean; msg?: string }> {
  const ip = await resolverIP(hornoId)
  if (!ip) throw new Error('No se pudo encontrar el horno')
  const password = localStorage.getItem(STORAGE_KEYS.PASS(hornoId)) ?? ''
  const doPost = (pass: string) => fetchTimeout(`http://${ip}/ota`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth': pass },
    body: JSON.stringify({}),
  })
  let resp = await doPost(password)
  if (resp.status === 401) {
    const passDefault = hornoId.slice(-6).toLowerCase()
    if (password !== passDefault) {
      resp = await doPost(passDefault)
      if (resp.ok) localStorage.setItem(STORAGE_KEYS.PASS(hornoId), passDefault)
    }
  }
  const json = await resp.json().catch(() => ({})) as { ok?: boolean; msg?: string; error?: string }
  if (!resp.ok) throw new Error(json.error ?? `Error HTTP ${resp.status}`)
  return json as { ok: boolean; msg?: string }
}

export async function getOTAStatus(hornoId: string): Promise<{
  version: string; enProgreso: boolean; disponible: boolean; versionNueva: string
} | null> {
  try {
    const ip = resolverCachedIP(hornoId)
    if (!ip) return null
    const password = localStorage.getItem(STORAGE_KEYS.PASS(hornoId)) ?? ''
    const resp = await fetchTimeout(`http://${ip}/ota/status`, {
      headers: { 'X-Auth': password },
    }, 3000)
    if (!resp.ok) return null
    return resp.json() as Promise<{ version: string; enProgreso: boolean; disponible: boolean; versionNueva: string }>
  } catch {
    return null
  }
}

// Exportado para reusar en AjustesScreen, CurvaGrafico, etc.
export { OTA_VERSION_URL }

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

// Lee IP solo de caché (sin probe AP) — para polling frecuente
function resolverCachedIP(hornoId: string): string | null {
  const cached = AP_CACHE.get(hornoId)
  if (cached && Date.now() - cached.ts < AP_TTL_MS) return cached.ip
  return getCachedIP(hornoId)
}

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
): Promise<{ status: number; data: unknown; via: 'http' | 'mqtt' }> {
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
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      return { status: resp.status, data, via: 'http' }
    } catch (e) {
      // Errores HTTP del firmware (4xx/5xx): propagar, no intentar MQTT
      if (e instanceof Error && /^HTTP \d{3}/.test(e.message)) throw e
      // Error de red/timeout: caer a MQTT
    }
  }

  const resultado = await mqttRequest(hornoId, path, method, body)
  return { ...resultado, via: 'mqtt' }
}

export async function verificarHornoMQTT(
  hornoId: string
): Promise<{ ok: boolean; nombre?: string; version?: string }> {
  const passDerivada = hornoId.slice(-6).toLowerCase()
  const keyPass = STORAGE_KEYS.PASS(hornoId)
  const passPrevia = localStorage.getItem(keyPass)
  localStorage.setItem(keyPass, passDerivada)
  try {
    const resp = await mqttRequest(hornoId, 'info', 'GET', undefined, 6000)
    if (resp.status === 200) {
      const data = resp.data as { nombre?: string; version?: string }
      return { ok: true, nombre: data.nombre, version: data.version }
    }
    if (passPrevia) localStorage.setItem(keyPass, passPrevia)
    else localStorage.removeItem(keyPass)
    return { ok: false }
  } catch {
    if (passPrevia) localStorage.setItem(keyPass, passPrevia)
    else localStorage.removeItem(keyPass)
    return { ok: false }
  }
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
