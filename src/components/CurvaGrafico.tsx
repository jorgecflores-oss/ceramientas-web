import { useState, useEffect, useRef, useMemo, useId } from 'react'
import type { PuntoCurva } from '../types/horno'
import type { Snapshot } from '../store/hornoStore'

const PAD_LEFT   = 38
const PAD_TOP    = 10
const PAD_BOTTOM = 22
const PAD_RIGHT  = 8
const SVG_H      = 260
const MIN_WIN_MS = 10 * 60 * 1000
const MIN_ZOOM_MS = 2 * 60 * 1000
const UMBRAL_PAN_PX = 6

function interpolarTemp(puntos: PuntoCurva[], t: number): number {
  if (puntos.length === 0) return 0
  if (t <= puntos[0].t) return puntos[0].temp
  if (t >= puntos[puntos.length - 1].t) return puntos[puntos.length - 1].temp
  for (let i = 1; i < puntos.length; i++) {
    if (puntos[i].t >= t) {
      const ratio = (t - puntos[i - 1].t) / (puntos[i].t - puntos[i - 1].t)
      return puntos[i - 1].temp + ratio * (puntos[i].temp - puntos[i - 1].temp)
    }
  }
  return puntos[puntos.length - 1].temp
}

function formatHoraRel(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return `${h}:${String(m).padStart(2, '0')}`
}

interface Props {
  puntos: PuntoCurva[]
  puntosTeoricos?: PuntoCurva[]
  xAhora?: number
  ultimoYMax?: number | null
  snapshot?: Snapshot | null
}

export function CurvaGrafico({ puntos, puntosTeoricos, xAhora, ultimoYMax, snapshot }: Props) {
  const rawId = useId()
  const uid = rawId.replace(/:/g, '')
  const containerRef = useRef<HTMLDivElement>(null)
  const [svgW, setSvgW] = useState(300)
  const [tooltipVisible, setTooltipVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    // Leer tamaño inicial para evitar flash en iOS (ResizeObserver puede tardar un ciclo)
    const initialW = Math.round(el.getBoundingClientRect().width)
    if (initialW > 0) setSvgW(initialW)
    const ro = new ResizeObserver(([entry]) => {
      setSvgW(Math.round(entry.contentRect.width))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let modo: 'pinch' | 'pan-pendiente' | 'pan' | null = null
    let distanciaInicial = 0
    let vistaAlInicio = { inicio: tMinRef.current, fin: tMaxRef.current }
    let xPanInicial = 0
    let vistaAlIniciarPan = { inicio: tMinRef.current, fin: tMaxRef.current }

    const distanciaEntreDedos = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)

    const centroT = (clientXProm: number, rect: DOMRect, ini: number, fin: number) => {
      const cx = clientXProm - rect.left
      const ratio = (cx - PAD_LEFT) / Math.max(1, rect.width - PAD_LEFT - PAD_RIGHT)
      return ini + ratio * (fin - ini)
    }

    const aplicarZoom = (centro: number, anchoDeseado: number, iniBase: number, finBase: number) => {
      const anchoTotal = tMaxDatosRef.current - tMinDatosRef.current
      const nuevoAncho = Math.min(Math.max(anchoDeseado, MIN_ZOOM_MS), anchoTotal)
      let inicio = centro - (centro - iniBase) * (nuevoAncho / (finBase - iniBase))
      let fin = inicio + nuevoAncho
      if (inicio < tMinDatosRef.current) { inicio = tMinDatosRef.current; fin = inicio + nuevoAncho }
      if (fin > tMaxDatosRef.current) { fin = tMaxDatosRef.current; inicio = fin - nuevoAncho }
      setVista({ inicio, fin })
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        modo = 'pinch'
        distanciaInicial = distanciaEntreDedos(e.touches)
        vistaAlInicio = { inicio: tMinRef.current, fin: tMaxRef.current }
        e.preventDefault()
      } else if (e.touches.length === 1) {
        modo = 'pan-pendiente'
        xPanInicial = e.touches[0].clientX
        vistaAlIniciarPan = { inicio: tMinRef.current, fin: tMaxRef.current }
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      const rect = el.getBoundingClientRect()
      if (modo === 'pinch' && e.touches.length === 2) {
        e.preventDefault()
        if (distanciaInicial < 1) return
        const distanciaAhora = distanciaEntreDedos(e.touches)
        const factor = distanciaInicial / distanciaAhora
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2
        const centro = centroT(cx, rect, vistaAlInicio.inicio, vistaAlInicio.fin)
        aplicarZoom(centro, (vistaAlInicio.fin - vistaAlInicio.inicio) * factor, vistaAlInicio.inicio, vistaAlInicio.fin)
      } else if ((modo === 'pan' || modo === 'pan-pendiente') && e.touches.length === 1) {
        const dx = e.touches[0].clientX - xPanInicial
        if (modo === 'pan-pendiente') {
          if (Math.abs(dx) < UMBRAL_PAN_PX) return
          modo = 'pan'
        }
        e.preventDefault()
        const anchoMs = vistaAlIniciarPan.fin - vistaAlIniciarPan.inicio
        const plotWpx = Math.max(1, rect.width - PAD_LEFT - PAD_RIGHT)
        const deltaMs = -(dx / plotWpx) * anchoMs
        let inicio = vistaAlIniciarPan.inicio + deltaMs
        let fin = vistaAlIniciarPan.fin + deltaMs
        if (inicio < tMinDatosRef.current) { inicio = tMinDatosRef.current; fin = inicio + anchoMs }
        if (fin > tMaxDatosRef.current) { fin = tMaxDatosRef.current; inicio = fin - anchoMs }
        setVista({ inicio, fin })
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        modo = null
      } else if (e.touches.length === 1) {
        modo = 'pan-pendiente'
        xPanInicial = e.touches[0].clientX
        vistaAlIniciarPan = { inicio: tMinRef.current, fin: tMaxRef.current }
      }
    }

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const factor = Math.exp(e.deltaY * 0.01)
      const centro = centroT(e.clientX, rect, tMinRef.current, tMaxRef.current)
      aplicarZoom(centro, (tMaxRef.current - tMinRef.current) * factor, tMinRef.current, tMaxRef.current)
    }

    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)
    el.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      el.removeEventListener('wheel', onWheel)
    }
  }, [])

  // Modo snapshot vs. live
  const hayTeorica = puntosTeoricos && puntosTeoricos.length > 1
  const modoSnapshot = !hayTeorica && !!snapshot && snapshot.puntosTeoricos.length > 1

  const puntosEf: PuntoCurva[] = modoSnapshot ? snapshot!.historialTemp : puntos
  const teoricoEf: PuntoCurva[] | undefined = modoSnapshot
    ? snapshot!.puntosTeoricos
    : (hayTeorica ? puntosTeoricos! : undefined)
  const xAhoraEf: number | undefined = modoSnapshot ? snapshot!.xAhoraFinal : xAhora
  const hayTeoricoEf = teoricoEf && teoricoEf.length > 1

  // t0 = inicio del programa (primer nodo teórico)
  const t0 = useMemo(() => {
    if (hayTeoricoEf) return teoricoEf![0].t
    return puntosEf.length > 0 ? puntosEf[0].t : Date.now()
  }, [hayTeoricoEf, teoricoEf, puntosEf])

  // Descartar datos anteriores al inicio del programa actual
  const puntosEfFilt = useMemo(() => {
    return hayTeoricoEf ? puntosEf.filter(p => p.t >= t0) : puntosEf
  }, [puntosEf, hayTeoricoEf, t0])

  // Rango X natural (todo el programa/datos disponibles)
  const { tMin: tMinDatos, tMax: tMaxDatos } = useMemo(() => {
    const teoEnd = hayTeoricoEf ? teoricoEf![teoricoEf!.length - 1].t : 0
    const realEnd = puntosEfFilt.length > 0 ? puntosEfFilt[puntosEfFilt.length - 1].t : t0
    return { tMin: t0, tMax: Math.max(teoEnd, realEnd, t0 + MIN_WIN_MS) }
  }, [t0, hayTeoricoEf, teoricoEf, puntosEfFilt])

  // Ventana de vista (zoom/pan táctil). null = rango completo natural.
  const [vista, setVista] = useState<{ inicio: number; fin: number } | null>(null)
  useEffect(() => { setVista(null) }, [t0])

  const tMin = vista?.inicio ?? tMinDatos
  const tMax = vista?.fin ?? tMaxDatos

  const tMinRef = useRef(tMin)
  const tMaxRef = useRef(tMax)
  const tMinDatosRef = useRef(tMinDatos)
  const tMaxDatosRef = useRef(tMaxDatos)
  useEffect(() => { tMinRef.current = tMin; tMaxRef.current = tMax }, [tMin, tMax])
  useEffect(() => { tMinDatosRef.current = tMinDatos; tMaxDatosRef.current = tMaxDatos }, [tMinDatos, tMaxDatos])

  // Rango Y
  const { yMin, yMax } = useMemo(() => {
    const teoMax = hayTeoricoEf ? Math.max(...teoricoEf!.map(p => p.temp)) : 0
    const realTemps = puntosEfFilt.length > 0 ? puntosEfFilt.map(p => p.temp) : [20]
    const tempInicio = hayTeoricoEf ? teoricoEf![0].temp : Math.min(...realTemps)
    const yn = Math.max(0, Math.min(tempInicio, Math.min(...realTemps)) - 10)
    let yx = Math.max(teoMax, Math.max(...realTemps), yn + 25)
    if (!hayTeoricoEf && ultimoYMax) yx = ultimoYMax
    return { yMin: yn, yMax: yx }
  }, [puntosEfFilt, hayTeoricoEf, teoricoEf, ultimoYMax])

  const plotW = Math.max(1, svgW - PAD_LEFT - PAD_RIGHT)
  const plotH = Math.max(1, SVG_H - PAD_TOP - PAD_BOTTOM)

  const realPath = useMemo(() => {
    const pw = Math.max(1, svgW - PAD_LEFT - PAD_RIGHT)
    const ph = Math.max(1, SVG_H - PAD_TOP - PAD_BOTTOM)
    const lxp = (t: number) => PAD_LEFT + ((t - tMin) / (tMax - tMin)) * pw
    const lyp = (temp: number) => PAD_TOP + (1 - (temp - yMin) / (yMax - yMin)) * ph

    const pts = puntosEfFilt
    if (pts.length < 2) return ''
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${lxp(p.t).toFixed(1)},${lyp(p.temp).toFixed(1)}`).join(' ')
  }, [puntosEfFilt, tMin, tMax, yMin, yMax, svgW])

  // Path curva teórica
  const teoPath = useMemo(() => {
    if (!hayTeoricoEf) return ''
    const pw = Math.max(1, svgW - PAD_LEFT - PAD_RIGHT)
    const ph = Math.max(1, SVG_H - PAD_TOP - PAD_BOTTOM)
    const lxp = (t: number) => PAD_LEFT + ((t - tMin) / (tMax - tMin)) * pw
    const lyp = (temp: number) => PAD_TOP + (1 - (temp - yMin) / (yMax - yMin)) * ph
    return teoricoEf!.map((p, i) => `${i === 0 ? 'M' : 'L'}${lxp(p.t).toFixed(1)},${lyp(p.temp).toFixed(1)}`).join(' ')
  }, [hayTeoricoEf, teoricoEf, tMin, tMax, yMin, yMax, svgW])

  // Ticks eje Y: nodos teóricos + extremos, deduplicados si están a <15° entre sí
  const yTicks = useMemo(() => {
    const nodeTemps = hayTeoricoEf ? [...new Set(teoricoEf!.map(p => Math.round(p.temp)))] : []
    const all = [Math.round(yMin), ...nodeTemps, Math.round(yMax)]
    const sorted = [...new Set(all)].sort((a, b) => a - b)
    const deduped: number[] = []
    for (const v of sorted) {
      if (deduped.length === 0 || v - deduped[deduped.length - 1] >= 15) deduped.push(v)
    }
    return deduped
  }, [hayTeoricoEf, teoricoEf, yMin, yMax])

  // Proyecciones inline (usadas en render; los useMemo definen lxp/lyp locales)
  const xp = (t: number) => PAD_LEFT + ((t - tMin) / (tMax - tMin)) * plotW
  const yp = (temp: number) => PAD_TOP + (1 - (temp - yMin) / (yMax - yMin)) * plotH

  // Línea "ahora"
  const tAhora = xAhoraEf !== undefined ? t0 + xAhoraEf * 60000 : undefined
  const xNow = tAhora !== undefined
    ? (() => { const x = xp(tAhora); return x >= PAD_LEFT && x <= PAD_LEFT + plotW ? x : null })()
    : null

  // Tooltip (datos del último punto real)
  const tooltip = useMemo(() => {
    if (!tooltipVisible || puntosEfFilt.length < 1) return null
    const lastPt = puntosEfFilt[puntosEfFilt.length - 1]
    const real = Math.round(lastPt.temp)
    const teo = hayTeoricoEf ? Math.round(interpolarTemp(teoricoEf!, lastPt.t)) : null
    const relMs = (tAhora ?? lastPt.t) - t0
    return { relMs, real, teo }
  }, [tooltipVisible, puntosEfFilt, hayTeoricoEf, teoricoEf, tAhora, t0])

  const handleClick = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setTooltipVisible(v => {
      if (v) return false
      timerRef.current = setTimeout(() => setTooltipVisible(false), 6000)
      return true
    })
  }

  if (puntosEfFilt.length === 0 && !hayTeoricoEf) {
    return (
      <div className="flex items-center justify-center text-neutral-500 text-sm" style={{ height: SVG_H }}>
        Sin datos aún
      </div>
    )
  }

  const teoNodes = hayTeoricoEf ? teoricoEf! : []
  const clipId = `plot-${uid}`

  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs text-neutral-400 uppercase tracking-wider">
          {modoSnapshot ? 'Curva (última cocción)' : 'Curva'}
        </span>
        {hayTeoricoEf && (
          <div className="flex gap-3 text-xs">
            <span className="flex items-center gap-1">
              <span className="inline-block w-4 h-[2px] rounded" style={{ background: '#FF6B35' }} />
              <span className="text-neutral-400">Real</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-4 h-0" style={{ borderTop: '2px dashed #64B5F6' }} />
              <span className="text-neutral-400">Teórica</span>
            </span>
          </div>
        )}
      </div>
      <div
        ref={containerRef}
        className="relative w-full cursor-pointer select-none"
        style={{ height: SVG_H, touchAction: 'none' }}
        onClick={handleClick}
      >
        {vista && (
          <button
            onClick={(e) => { e.stopPropagation(); setVista(null) }}
            className="absolute top-1 right-1 z-10 text-[10px] px-2 py-1 rounded bg-neutral-800/90 border border-neutral-700 text-neutral-300"
          >
            ↺ Ver todo
          </button>
        )}
        <svg width={svgW} height={SVG_H} style={{ display: 'block' }}>
          <defs>
            <clipPath id={clipId}>
              <rect x={PAD_LEFT} y={PAD_TOP} width={plotW} height={plotH} />
            </clipPath>
          </defs>

          {/* Guías verticales en nodos teóricos */}
          {teoNodes.map((node, i) => {
            const x = xp(node.t)
            if (x < PAD_LEFT - 1 || x > PAD_LEFT + plotW + 1) return null
            return (
              <line key={`vg${i}`}
                x1={x} y1={PAD_TOP} x2={x} y2={PAD_TOP + plotH}
                stroke="#888888" strokeWidth={1} opacity={0.25}
              />
            )
          })}

          {/* Eje Y: cuadrícula + etiquetas */}
          {yTicks.map((temp, i) => {
            const y = yp(temp)
            if (y < PAD_TOP - 2 || y > PAD_TOP + plotH + 2) return null
            return (
              <g key={`yt${i}`}>
                <line x1={PAD_LEFT} y1={y} x2={PAD_LEFT + plotW} y2={y}
                  stroke="#888888" strokeWidth={1} opacity={0.12} />
                <text x={PAD_LEFT - 5} y={y + 4} fill="#888888" fontSize={8} textAnchor="end" opacity={0.8}>
                  {temp}°
                </text>
              </g>
            )
          })}

          {/* Curva teórica: punteada celeste */}
          {teoPath && (
            <path d={teoPath} stroke="#64B5F6" strokeWidth={1.5} strokeDasharray="5,4"
              fill="none" clipPath={`url(#${clipId})`} />
          )}

          {/* Nodos de la curva teórica */}
          {teoNodes.map((node, i) => {
            const x = xp(node.t)
            const y = yp(node.temp)
            if (x < PAD_LEFT - 6 || x > PAD_LEFT + plotW + 6) return null
            if (y < PAD_TOP - 6 || y > PAD_TOP + plotH + 6) return null
            return (
              <circle key={`tc${i}`} cx={x} cy={y} r={3}
                stroke="#64B5F6" strokeWidth={1} fill="#1a1a1a" />
            )
          })}

          {/* Curva real: sólida naranja */}
          {realPath && (
            <path d={realPath} stroke="#FF6B35" strokeWidth={2}
              fill="none" clipPath={`url(#${clipId})`} />
          )}

          {/* Línea vertical "ahora" en verde */}
          {xNow !== null && (
            <line x1={xNow} y1={PAD_TOP} x2={xNow} y2={PAD_TOP + plotH}
              stroke="#4CAF50" strokeWidth={1.5} opacity={0.65} />
          )}

          {/* Etiquetas eje X en nodos teóricos */}
          {(() => {
            const seen: number[] = []
            return teoNodes.map((node, i) => {
              const x = xp(node.t)
              if (x < PAD_LEFT || x > PAD_LEFT + plotW) return null
              if (seen.some(sx => Math.abs(sx - x) < 32)) return null
              seen.push(x)
              return (
                <text key={`xl${i}`} x={x} y={PAD_TOP + plotH + 15}
                  fill="#888888" fontSize={8} textAnchor="middle" opacity={0.8}>
                  {formatHoraRel(node.t - t0)}
                </text>
              )
            })
          })()}
        </svg>

        {/* Tooltip anclado a la línea verde */}
        {tooltip && (
          <div
            className="absolute top-8 bg-neutral-800/95 border border-neutral-700 rounded-lg px-3 py-2 text-xs pointer-events-none"
            style={{ left: xNow !== null ? Math.max(PAD_LEFT, Math.min(svgW - 130, xNow - 55)) : PAD_LEFT + 10 }}
          >
            <div className="text-neutral-500 mb-1 font-bold tracking-wider">{formatHoraRel(tooltip.relMs)}</div>
            <div className="text-orange-400">Real: {tooltip.real}°C</div>
            {tooltip.teo !== null && (
              <>
                <div className="text-blue-300">Teórica: {tooltip.teo}°C</div>
                <div className={`font-semibold ${tooltip.real - tooltip.teo >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  Δ {tooltip.real - tooltip.teo >= 0 ? '+' : ''}{tooltip.real - tooltip.teo}°C
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
