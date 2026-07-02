import type { PuntoCurva } from '../types/horno'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
} from 'recharts'

interface Props {
  puntos: PuntoCurva[]
  tempObj?: number
  puntosTeoricos?: PuntoCurva[]
}

export function CurvaGrafico({ puntos, tempObj = 0, puntosTeoricos }: Props) {
  if (puntos.length === 0) {
    return (
      <div className="flex items-center justify-center h-[220px] text-neutral-500 text-sm">
        Sin datos aún
      </div>
    )
  }

  const hayTeorica = puntosTeoricos && puntosTeoricos.length > 1

  const tAll = [
    ...puntos.map((p) => p.t),
    ...(hayTeorica ? puntosTeoricos.map((p) => p.t) : []),
  ]
  const t0 = Math.min(...tAll)
  const xMax = Math.floor((Math.max(...tAll) - t0) / 60000)

  const data = puntos.map((p) => ({
    min: Math.floor((p.t - t0) / 60000),
    temp: p.temp,
  }))

  const dataTeo = hayTeorica
    ? puntosTeoricos.map((p) => ({
        min: Math.floor((p.t - t0) / 60000),
        temp: p.temp,
      }))
    : undefined

  const maxTempReal = Math.max(...puntos.map((p) => p.temp))
  const maxTempTeorico = hayTeorica
    ? Math.max(...puntosTeoricos.map((p) => p.temp))
    : 0
  const yMax = Math.ceil(Math.max(maxTempReal + 50, maxTempTeorico + 20, 100))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2A2A2A" />
        <XAxis
          dataKey="min"
          type="number"
          domain={[0, xMax]}
          tickCount={5}
          tick={{ fill: '#737373', fontSize: 11 }}
          label={{ value: 'min', position: 'insideBottomRight', offset: -4, fill: '#737373', fontSize: 11 }}
        />
        <YAxis
          domain={[0, yMax]}
          tick={{ fill: '#737373', fontSize: 11 }}
          label={{ value: '°C', angle: -90, position: 'insideLeft', fill: '#737373', fontSize: 11 }}
          width={36}
        />
        <Tooltip
          contentStyle={{ backgroundColor: '#1A1A1A', border: '1px solid #2A2A2A', borderRadius: 8 }}
          labelStyle={{ color: '#a3a3a3', fontSize: 11 }}
          itemStyle={{ color: '#ffffff', fontSize: 12 }}
          formatter={(value: string | number, name: string | number) => [`${value}°C`, String(name)]}
          labelFormatter={(label: string | number) => `${label} min`}
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
      </LineChart>
    </ResponsiveContainer>
  )
}
