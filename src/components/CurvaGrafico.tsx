import { useState, useEffect } from 'react'
import type { PuntoCurva } from '../types/horno'
import type { Snapshot } from '../store/hornoStore'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from 'recharts'

function formatearTickX(min: number): string {
  if (min < 60) return `${min}`
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h}:${m.toString().padStart(2, '0')}`
}

function interpolarTemp(puntos: PuntoCurva[], t0: number, minAhora: number): number {
  for (let i = 1; i < puntos.length; i++) {
    const m0 = (puntos[i - 1].t - t0) / 60000
    const m1 = (puntos[i].t - t0) / 60000
    if (minAhora >= m0 && minAhora <= m1) {
      const ratio = (minAhora - m0) / (m1 - m0)
      return puntos[i - 1].temp + ratio * (puntos[i].temp - puntos[i - 1].temp)
    }
  }
  return puntos[puntos.length - 1].temp
}

function CartelFijo({ xAhora, xMax, tempReal, tempTeorica }: {
  xAhora: number
  xMax: number
  tempReal: number
  tempTeorica: number
}) {
  const delta = tempReal - tempTeorica
  const porcentajeX = Math.min(Math.max((xAhora / xMax) * 100, 10), 80)
  return (
    <div
      className="absolute top-8 bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-xs pointer-events-none"
      style={{ left: `${porcentajeX}%`, transform: 'translateX(-50%)' }}
    >
      <div className="text-neutral-500 mb-1 font-bold tracking-wider">{formatearTickX(Math.round(xAhora))}</div>
      <div className="text-orange-400">Real: {Math.round(tempReal)}°C</div>
      <div className="text-blue-300">Teórica: {Math.round(tempTeorica)}°C</div>
      <div className={`font-semibold ${delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
        Δ: {delta >= 0 ? '+' : ''}{Math.round(delta)}°C
      </div>
    </div>
  )
}

interface Props {
  puntos: PuntoCurva[]
  puntosTeoricos?: PuntoCurva[]
  xAhora?: number
  ultimoYMax?: number | null
  snapshot?: Snapshot | null
}

export function CurvaGrafico({ puntos, puntosTeoricos, xAhora, ultimoYMax, snapshot }: Props) {
  const [cartelVisible, setCartelVisible] = useState(false)

  useEffect(() => {
    if (!cartelVisible) return
    const timer = setTimeout(() => setCartelVisible(false), 6000)
    return () => clearTimeout(timer)
  }, [cartelVisible])

  // Toggle: abre si cerrado, cierra si abierto. Solo onClick — evita doble disparo
  // que ocurría al tener onTouchStart + onClick juntos (ambos fires en el mismo tap).
  const mostrarCartel = () => setCartelVisible(v => !v)

  const hayTeorica = puntosTeoricos && puntosTeoricos.length > 1
  const modoSnapshot = !hayTeorica && !!snapshot && snapshot.puntosTeoricos.length > 1

  const puntosEf: PuntoCurva[] = modoSnapshot ? snapshot!.historialTemp : puntos
  const teoricoEf: PuntoCurva[] | undefined = modoSnapshot
    ? snapshot!.puntosTeoricos
    : (hayTeorica ? puntosTeoricos! : undefined)
  const xAhoraEf: number | undefined = modoSnapshot ? snapshot!.xAhoraFinal : xAhora
  const hayTeoricoEf = teoricoEf && teoricoEf.length > 1

  if (puntosEf.length === 0 && !hayTeoricoEf) {
    return (
      <div className="flex items-center justify-center h-[320px] text-neutral-500 text-sm">
        Sin datos aún
      </div>
    )
  }

  const tAll = [
    ...puntosEf.map((p) => p.t),
    ...(hayTeoricoEf ? teoricoEf!.map((p) => p.t) : []),
  ]
  const t0 = Math.min(...tAll)
  const xMaxOriginal = Math.floor((Math.max(...tAll) - t0) / 60000)

  const data = puntosEf.map((p) => ({
    min: Math.floor((p.t - t0) / 60000),
    temp: p.temp,
  }))

  const dataTeo = hayTeoricoEf
    ? teoricoEf!.map((p) => ({
        min: Math.floor((p.t - t0) / 60000),
        temp: p.temp,
      }))
    : undefined

  const maxTempReal = puntosEf.length > 0 ? Math.max(...puntosEf.map((p) => p.temp)) : 0
  const maxTempTeorico = hayTeoricoEf
    ? Math.max(...teoricoEf!.map((p) => p.temp))
    : 0
  let yMax = Math.ceil(Math.max(maxTempReal + 50, maxTempTeorico + 20, 100))
  if (!hayTeoricoEf && ultimoYMax) {
    yMax = ultimoYMax
  }

  const ticksX: number[] = hayTeoricoEf
    ? Array.from(new Set(teoricoEf!.map((p) => Math.round((p.t - t0) / 60000)))).sort((a, b) => a - b)
    : []
  const ticksY: number[] = hayTeoricoEf
    ? Array.from(new Set(teoricoEf!.map((p) => p.temp))).sort((a, b) => a - b)
    : []
  const xMax = hayTeoricoEf && ticksX.length > 0
    ? Math.max(xMaxOriginal, ticksX[ticksX.length - 1])
    : xMaxOriginal

  const ultimaTempReal = puntosEf.length > 0 ? puntosEf[puntosEf.length - 1].temp : 0
  const tempTeoricaEnXAhora = hayTeoricoEf && xAhoraEf !== undefined
    ? interpolarTemp(teoricoEf!, t0, xAhoraEf)
    : 0

  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs text-neutral-400 uppercase tracking-wider">
          {modoSnapshot ? 'Curva (última cocción)' : 'Curva'}
        </span>
        <div className="flex gap-3 text-xs">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-0.5" style={{ background: '#FF6B35' }} />
            <span className="text-neutral-400">Real</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-0.5 border-t border-dashed" style={{ borderColor: '#64B5F6' }} />
            <span className="text-neutral-400">Teórica</span>
          </span>
        </div>
      </div>
      <div
        className="relative w-full h-[380px]"
        onClick={mostrarCartel}
      >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 20, left: 5, bottom: 25 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2A2A2A" />
          <XAxis
            dataKey="min"
            type="number"
            domain={[0, xMax]}
            ticks={ticksX.length > 0 ? ticksX : undefined}
            interval={0}
            tickFormatter={formatearTickX}
            tick={{ fill: '#AAAAAA', fontSize: 10 }}
            angle={-30}
            textAnchor="end"
            height={60}
            label={{ value: 'Hs:min', position: 'insideBottom', offset: 0, fill: '#AAAAAA', fontSize: 10 }}
          />
          <YAxis
            domain={[0, yMax]}
            ticks={ticksY.length > 0 ? ticksY : undefined}
            interval={0}
            minTickGap={1}
            tick={{ fill: '#AAAAAA', fontSize: 10 }}
            label={{ value: '°C', angle: -90, position: 'insideLeft', fill: '#AAAAAA', fontSize: 10, offset: 15 }}
            width={36}
          />
          {dataTeo && (
            <Line
              data={dataTeo}
              type="linear"
              dataKey="temp"
              name="Teórica"
              stroke="#64B5F6"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              dot={{ fill: '#64B5F6', r: 3 }}
              isAnimationActive={false}
            />
          )}
          <Line
            type="monotone"
            dataKey="temp"
            name="Real"
            stroke="#FF6B35"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          {xAhoraEf !== undefined && xAhoraEf >= 0 && (
            <ReferenceLine
              x={xAhoraEf}
              stroke="#4CAF50"
              strokeWidth={2}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
      {hayTeoricoEf && xAhoraEf !== undefined && cartelVisible && puntosEf.length > 0 && (
        <CartelFijo
          xAhora={xAhoraEf}
          xMax={xMax}
          tempReal={ultimaTempReal}
          tempTeorica={tempTeoricaEnXAhora}
        />
      )}
      </div>
    </div>
  )
}
