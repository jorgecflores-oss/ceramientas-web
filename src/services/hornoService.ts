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

// Login modo AP: POST directo a IP, con X-Auth de la password derivada (única que puede andar recién reseteado)
export async function postConfigAP(ip: string, pass: string, body: unknown) {
  const res = await fetchTimeout(`http://${ip}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth': pass },
    body: JSON.stringify(body),
  })
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
  if (!Array.isArray(resp.data)) {
    throw new Error(`Respuesta /programas inválida (${typeof resp.data}) — probable JSON malformado en firmware`)
  }
  return resp.data as Programa[]
}

export async function getHistorial(hornoId: string) {
  return (await hornoRequest(hornoId, 'historial', 'GET')).data
}

export async function deleteHistorial(hornoId: string) {
  return (await hornoRequest(hornoId, 'historial', 'DELETE')).data
}

export async function getCurva(hornoId: string, desde: number = 0) {
  return (await hornoRequest(hornoId, `curva?desde=${desde}`, 'GET')).data as {
    epoch: number
    total: number
    desde: number
    pts: { m: number; t: number }[]
  }
}

export async function consultarInfoMQTT(
  hornoId: string
): Promise<{ ok: boolean; nombre?: string; version?: string; reclamado?: boolean }> {
  try {
    const resp = await mqttRequest(hornoId, 'info', 'GET', undefined, 6000)
    if (resp.status === 200) {
      const data = resp.data as { nombre?: string; version?: string; reclamado?: boolean }
      return { ok: true, nombre: data.nombre, version: data.version, reclamado: data.reclamado }
    }
    return { ok: false }
  } catch {
    return { ok: false }
  }
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

export async function getPrograma(hornoId: string, idx: number): Promise<Programa> {
  return (await hornoRequest(hornoId, `programas/${idx}`, 'GET')).data as Programa
}

export async function postOTA(hornoId: string): Promise<{ ok: boolean; msg?: string }> {
  const result = await hornoRequest(hornoId, 'ota', 'POST', JSON.stringify({}))
  return result.data as { ok: boolean; msg?: string }
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
let _apProbeFailedAt = 0  // negativo-cache: no reintentar probe AP por 60s tras fallo

// Lee IP solo de caché (sin probe AP) — para polling frecuente
function resolverCachedIP(hornoId: string): string | null {
  const cached = AP_CACHE.get(hornoId)
  if (cached && Date.now() - cached.ts < AP_TTL_MS) return cached.ip
  return getCachedIP(hornoId)
}

async function resolverIP(hornoId: string): Promise<string | null> {
  const cached = AP_CACHE.get(hornoId)
  if (cached && Date.now() - cached.ts < AP_TTL_MS) return cached.ip

  const now = Date.now()
  if (now - _apProbeFailedAt > AP_TTL_MS) {
    try {
      const resp = await fetch(`http://${AP_IP}/info`, {
        signal: AbortSignal.timeout(500),
      })
      if (resp.ok) {
        const info = await resp.json()
        if (info.hornoId === hornoId) {
          AP_CACHE.set(hornoId, { ip: AP_IP, ts: now })
          return AP_IP
        }
      }
      _apProbeFailedAt = now
    } catch {
      _apProbeFailedAt = now
    }
  }

  return getCachedIP(hornoId)
}

class FirmwareError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function autoSanarPassword(hornoId: string): Promise<boolean> {
  const yaConocido = useHornoStore.getState().hornos.some(h => h.hornoId === hornoId)
  if (!yaConocido) return false
  const keyPass = STORAGE_KEYS.PASS(hornoId)
  const passActual = localStorage.getItem(keyPass)
  const derivada = hornoId.slice(-6).toLowerCase()
  const invertida = derivada.split('').reverse().join('')
  const candidata = passActual === derivada ? invertida : derivada
  localStorage.setItem(keyPass, candidata)
  try {
    const resp = await mqttRequest(hornoId, 'config', 'POST', JSON.stringify({ reclamar: true }), 6000)
    if (resp.status === 200) {
      const data = resp.data as { nuevaPass?: string }
      if (data.nuevaPass) localStorage.setItem(keyPass, data.nuevaPass)
      return true
    }
  } catch {
    // sigue abajo a revertir
  }
  if (passActual) localStorage.setItem(keyPass, passActual)
  else localStorage.removeItem(keyPass)
  return false
}

async function hornoRequestInterno(
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
        signal: AbortSignal.timeout(HTTP_TIMEOUT),
      }
      if (body && method !== 'GET') opts.body = body
      const resp = await fetch(`http://${ip}/${path}`, opts)
      let data: unknown
      try {
        data = await resp.json()
      } catch {
        if (!resp.ok) throw new FirmwareError(`HTTP ${resp.status}`, resp.status)
        throw new Error(`HTTP 200 con JSON inválido en /${path}`)
      }
      if (!resp.ok) {
        const firmwareError = (data as { error?: string }).error
        throw new FirmwareError(firmwareError ?? `HTTP ${resp.status}`, resp.status)
      }
      cacheIP(hornoId, ip)
      return { status: resp.status, data, via: 'http' }
    } catch (e) {
      if (e instanceof FirmwareError) throw e
      // Error de red/timeout: caer a MQTT
    }
  }

  const resultado = await mqttRequest(hornoId, path, method, body)
  if (resultado.status >= 400) {
    const errData = resultado.data as { error?: string }
    throw new FirmwareError(errData?.error ?? `Error ${resultado.status}`, resultado.status)
  }
  return { ...resultado, via: 'mqtt' }
}

export async function hornoRequest(
  hornoId: string,
  path: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: string
): Promise<{ status: number; data: unknown; via: 'http' | 'mqtt' }> {
  try {
    return await hornoRequestInterno(hornoId, path, method, body)
  } catch (e) {
    if (e instanceof FirmwareError && e.status === 401) {
      const sanado = await autoSanarPassword(hornoId)
      if (sanado) return await hornoRequestInterno(hornoId, path, method, body)
    }
    throw e
  }
}

export async function verificarHornoMQTT(
  hornoId: string,
  passExplicita?: string
): Promise<{ ok: boolean; nombre?: string; version?: string }> {
  const pass = (passExplicita ?? hornoId.slice(-6)).toLowerCase()
  const keyPass = STORAGE_KEYS.PASS(hornoId)
  const passPrevia = localStorage.getItem(keyPass)
  localStorage.setItem(keyPass, pass)
  try {
    const resp = await mqttRequest(hornoId, 'info', 'GET', undefined, 6000)
    if (resp.status === 200) {
      const data = resp.data as { nombre?: string; version?: string; ip?: string }
      if (data.ip) cacheIP(hornoId, data.ip)
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

export async function refreshIPCache(hornoId: string): Promise<void> {
  try {
    const resp = await mqttRequest(hornoId, 'info', 'GET', undefined, 8000)
    if (resp.status === 200) {
      const data = resp.data as { ip?: string }
      if (data.ip) cacheIP(hornoId, data.ip)
    }
  } catch {
    // silencioso — no es crítico
  }
}

const CAPACIDAD_ACTUAL = 44

export async function fetchProgramasOnce(hornoId: string): Promise<Programa[]> {
  try {
    const programas = await getProgramas(hornoId)
    localStorage.setItem(STORAGE_KEYS.PROGRAMAS_CACHE(hornoId), JSON.stringify(programas))
    return programas
  } catch (e) {
    const cached = localStorage.getItem(STORAGE_KEYS.PROGRAMAS_CACHE(hornoId))
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as Programa[]
        if (
          Array.isArray(parsed) &&
          parsed.length === CAPACIDAD_ACTUAL &&
          parsed.every(p => p && Array.isArray(p.pasos) && p.pasos.every(
            (paso: unknown) => paso !== null && typeof paso === 'object' &&
              typeof (paso as Record<string, unknown>).velocidad === 'number' &&
              typeof (paso as Record<string, unknown>).temperatura === 'number' &&
              typeof (paso as Record<string, unknown>).tiempo === 'number'
          ))
        ) return parsed
      } catch {}
    }
    throw e
  }
}
