import type { Paso, PuntoCurva } from '../types/horno'

const pasoActivo = (p: Paso): boolean =>
  p.velocidad !== 0 || p.temperatura !== 0 || p.tiempo !== 0

export function calcularCurvaTeorica(
  pasos: Paso[],
  tempInicio: number,
  timestampInicio: number
): PuntoCurva[] {
  const puntos: PuntoCurva[] = []
  let t = timestampInicio
  let tempActual = tempInicio

  puntos.push({ t, temp: tempActual })

  for (const paso of pasos) {
    if (!pasoActivo(paso)) continue
    const velPorMin = Math.abs(paso.velocidad) / 10
    const delta = paso.temperatura - tempActual

    if (velPorMin > 0 && Math.abs(delta) > 0.5) {
      t += (Math.abs(delta) / velPorMin) * 60000
    }

    puntos.push({ t, temp: paso.temperatura })
    tempActual = paso.temperatura

    if (paso.tiempo > 0) {
      t += paso.tiempo * 60000
      puntos.push({ t, temp: paso.temperatura })
    }
  }

  const lastActivo = [...pasos].reverse().find(pasoActivo)
  if (lastActivo && lastActivo.temperatura > 0 && puntos.length > 1) {
    puntos[puntos.length - 1] = {
      ...puntos[puntos.length - 1],
      temp: lastActivo.temperatura,
    }
  }

  return puntos
}

export function calcularT0Virtual(
  pasos: Paso[],
  tempActual: number,
  tInicio: number,
  tempBase = 20
): number {
  if (tempActual <= tempBase) return tInicio
  const curvaRel = calcularCurvaTeorica(pasos, tempBase, 0)
  if (curvaRel.length < 2) return tInicio

  for (let i = 1; i < curvaRel.length; i++) {
    const p0 = curvaRel[i - 1]
    const p1 = curvaRel[i]
    const lo = Math.min(p0.temp, p1.temp)
    const hi = Math.max(p0.temp, p1.temp)
    if (hi > lo && tempActual >= lo && tempActual <= hi) {
      const ratio = (tempActual - p0.temp) / (p1.temp - p0.temp)
      return tInicio - Math.round(p0.t + ratio * (p1.t - p0.t))
    }
  }
  return tInicio - curvaRel[curvaRel.length - 1].t
}
