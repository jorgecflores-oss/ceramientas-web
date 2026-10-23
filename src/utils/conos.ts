// Conos Orton autosoportados (serie regular SSB). Fuente: Orton Cone Chart °F 022-14
// (©2016 Orton Ceramic Foundation), columnas 27, 108 y 270 °F/h = 15, 60 y 150 °C/h.
// Equivalencia aproximada: el cono mide calor acumulado, no temperatura.
// La velocidad es la de los últimos 100 °C (180 °F) antes de llegar al cono.
// El estándar internacional de uso es 150 °C/h (defecto).
//
// Los conos son strings: "06" y "6" son distintos. No normalizar ni quitar ceros.
// Se ofrecen solo los conos cuya temperatura entra en el rango del controlador (<= 1260 °C).
export type CurvaCono = 15 | 60 | 150

export const CURVAS_CONO: CurvaCono[] = [150, 60, 15]
export const CURVA_CONO_DEFECTO: CurvaCono = 150
export const TEMP_MAX_CONO = 1260

const TABLA: { cono: string; c15: number; c60: number; c150: number }[] = [
  { cono: '022', c15: 586, c60: 590, c150: 630 },
  { cono: '021', c15: 600, c60: 617, c150: 643 },
  { cono: '020', c15: 626, c60: 638, c150: 666 },
  { cono: '019', c15: 656, c60: 678, c150: 695 },
  { cono: '018', c15: 686, c60: 715, c150: 734 },
  { cono: '017', c15: 705, c60: 738, c150: 763 },
  { cono: '016', c15: 742, c60: 772, c150: 796 },
  { cono: '015', c15: 750, c60: 791, c150: 818 },
  { cono: '014', c15: 757, c60: 807, c150: 838 },
  { cono: '013', c15: 807, c60: 837, c150: 861 },
  { cono: '012', c15: 843, c60: 861, c150: 882 },
  { cono: '011', c15: 857, c60: 875, c150: 894 },
  { cono: '010', c15: 891, c60: 903, c150: 915 },
  { cono: '09',  c15: 907, c60: 920, c150: 930 },
  { cono: '08',  c15: 922, c60: 942, c150: 956 },
  { cono: '07',  c15: 962, c60: 976, c150: 987 },
  { cono: '06',  c15: 981, c60: 998, c150: 1013 },
  { cono: '05½', c15: 1004, c60: 1015, c150: 1025 },
  { cono: '05',  c15: 1021, c60: 1031, c150: 1044 },
  { cono: '04',  c15: 1046, c60: 1063, c150: 1077 },
  { cono: '03',  c15: 1071, c60: 1086, c150: 1104 },
  { cono: '02',  c15: 1078, c60: 1102, c150: 1122 },
  { cono: '01',  c15: 1093, c60: 1119, c150: 1138 },
  { cono: '1',   c15: 1109, c60: 1137, c150: 1154 },
  { cono: '2',   c15: 1112, c60: 1142, c150: 1164 },
  { cono: '3',   c15: 1115, c60: 1152, c150: 1170 },
  { cono: '4',   c15: 1141, c60: 1162, c150: 1183 },
  { cono: '5',   c15: 1159, c60: 1186, c150: 1207 },
  { cono: '5½',  c15: 1167, c60: 1203, c150: 1225 },
  { cono: '6',   c15: 1185, c60: 1222, c150: 1243 },
  { cono: '7',   c15: 1201, c60: 1239, c150: 1257 },
  { cono: '8',   c15: 1211, c60: 1249, c150: 1271 },
  { cono: '9',   c15: 1224, c60: 1260, c150: 1280 },
]

const campo = (curva: CurvaCono) => (curva === 15 ? 'c15' : curva === 60 ? 'c60' : 'c150') as 'c15' | 'c60' | 'c150'

export function conosDeCurva(curva: CurvaCono): { cono: string; temp: number }[] {
  const k = campo(curva)
  return TABLA.map(r => ({ cono: r.cono, temp: r[k] })).filter(r => r.temp <= TEMP_MAX_CONO)
}

export function tempDeCono(cono: string, curva: CurvaCono): number | null {
  return conosDeCurva(curva).find(c => c.cono === cono)?.temp ?? null
}

// Coincidencia exacta de temperatura en esa curva, o null.
export function conoDeTemperatura(t: number, curva: CurvaCono): string | null {
  return conosDeCurva(curva).find(c => c.temp === t)?.cono ?? null
}

// Busca primero en la curva preferida y después en las otras (programas guardados con otra curva).
export function buscarCono(t: number, preferida: CurvaCono): { cono: string; curva: CurvaCono } | null {
  for (const curva of [preferida, ...CURVAS_CONO.filter(c => c !== preferida)]) {
    const cono = conoDeTemperatura(t, curva)
    if (cono !== null) return { cono, curva }
  }
  return null
}

const CLAVE_CURVA_CONO = 'ceramientas_curva_cono'

export function leerCurvaCono(): CurvaCono {
  try {
    const v = Number(localStorage.getItem(CLAVE_CURVA_CONO))
    if (v === 15 || v === 60 || v === 150) return v
  } catch { /* sin storage: defecto */ }
  return CURVA_CONO_DEFECTO
}

export function guardarCurvaCono(curva: CurvaCono) {
  try { localStorage.setItem(CLAVE_CURVA_CONO, String(curva)) } catch { /* sin storage */ }
}
