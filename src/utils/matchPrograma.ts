import type { Programa, Paso } from '../types/horno'

const pasoActivo = (p: Paso): boolean =>
  p.velocidad !== 0 || p.temperatura !== 0 || p.tiempo !== 0

export function matchPrograma(
  programas: Programa[],
  etapaTotal: number,
  etapaActual: number,
  tempObjetivo: number
): Programa | null {
  const etapaIdx = Math.max(0, etapaActual - 1)

  const match = programas.find((p) => {
    const activos = p.pasos.filter(pasoActivo)
    if (activos.length !== etapaTotal) return false
    if (tempObjetivo > 0 && etapaIdx < activos.length) {
      const esUltimoPaso = etapaIdx === activos.length - 1
      const tempEfectiva = esUltimoPaso && (p.tempFinal ?? 0) > 0
        ? p.tempFinal!
        : activos[etapaIdx].temperatura
      return tempEfectiva === tempObjetivo
    }
    return true
  })

  if (!match) return null

  if (match.tempFinal && match.tempFinal > 0) {
    const activos = match.pasos.filter(pasoActivo)
    if (activos.length > 0) {
      const lastActivoIdx = match.pasos.lastIndexOf(activos[activos.length - 1])
      if (lastActivoIdx >= 0) {
        const pasosOverride = [...match.pasos]
        pasosOverride[lastActivoIdx] = {
          ...pasosOverride[lastActivoIdx],
          temperatura: match.tempFinal,
        }
        return { ...match, pasos: pasosOverride }
      }
    }
  }

  return match
}
