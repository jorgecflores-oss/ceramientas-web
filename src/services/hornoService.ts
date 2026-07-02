import { HTTP_TIMEOUT, AP_IP, STORAGE_KEYS } from '../utils/constants'
import type { InfoHorno, Programa } from '../types/horno'

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

export async function getInfo(ip: string): Promise<InfoHorno> {
  const res = await fetchTimeout(`http://${ip}/info`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function scanWifi(ip: string) {
  const res = await fetchTimeout(`http://${ip}/wifi/scan`, {}, 10000)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function getEstado(ip: string, pass: string) {
  const res = await fetchTimeout(`http://${ip}/estado`, {
    headers: { 'X-Auth': pass },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function getProgramas(ip: string, pass: string): Promise<Programa[]> {
  const res = await fetchTimeout(`http://${ip}/programas`, {
    headers: { 'X-Auth': pass },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function getHistorial(ip: string, pass: string) {
  const res = await fetchTimeout(`http://${ip}/historial`, {
    headers: { 'X-Auth': pass },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function getCurva(ip: string, pass: string) {
  const res = await fetchTimeout(`http://${ip}/curva`, {
    headers: { 'X-Auth': pass },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function getConfig(ip: string, pass: string) {
  const res = await fetchTimeout(`http://${ip}/config`, {
    headers: { 'X-Auth': pass },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function postComando(ip: string, pass: string, comando: string) {
  const res = await fetchTimeout(`http://${ip}/comando`, {
    method: 'POST',
    headers: { 'X-Auth': pass, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pass, comando }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
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

export async function fetchProgramasOnce(
  ip: string,
  pass: string,
  hornoId: string
): Promise<Programa[]> {
  try {
    const programas = await getProgramas(ip, pass)
    localStorage.setItem(
      STORAGE_KEYS.PROGRAMAS_CACHE(hornoId),
      JSON.stringify(programas)
    )
    return programas
  } catch (e) {
    const cached = localStorage.getItem(STORAGE_KEYS.PROGRAMAS_CACHE(hornoId))
    if (cached) return JSON.parse(cached) as Programa[]
    throw e
  }
}