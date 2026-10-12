// Orton, conos autosoportados, 60 °C/h (108 °F/h). Fuente: Orton Cone Chart °F 022-14
// (©2016 Orton Ceramic Foundation). Equivalencia aproximada: el cono mide calor acumulado,
// no temperatura.
//
// Los conos son strings: "06" y "6" son distintos. No normalizar ni quitar ceros.
// La tabla corta en cono 9 (1260 °C, tope del controlador).
export const CONOS_ORTON: { cono: string; temp: number }[] = [
  { cono: '022', temp: 590 },
  { cono: '021', temp: 617 },
  { cono: '020', temp: 638 },
  { cono: '019', temp: 678 },
  { cono: '018', temp: 715 },
  { cono: '017', temp: 738 },
  { cono: '016', temp: 772 },
  { cono: '015', temp: 791 },
  { cono: '014', temp: 807 },
  { cono: '013', temp: 837 },
  { cono: '012', temp: 861 },
  { cono: '011', temp: 875 },
  { cono: '010', temp: 903 },
  { cono: '09',  temp: 920 },
  { cono: '08',  temp: 942 },
  { cono: '07',  temp: 976 },
  { cono: '06',  temp: 998 },
  { cono: '05½', temp: 1015 },
  { cono: '05',  temp: 1031 },
  { cono: '04',  temp: 1063 },
  { cono: '03',  temp: 1086 },
  { cono: '02',  temp: 1102 },
  { cono: '01',  temp: 1119 },
  { cono: '1',   temp: 1137 },
  { cono: '2',   temp: 1142 },
  { cono: '3',   temp: 1152 },
  { cono: '4',   temp: 1162 },
  { cono: '5',   temp: 1186 },
  { cono: '5½',  temp: 1203 },
  { cono: '6',   temp: 1222 },
  { cono: '7',   temp: 1239 },
  { cono: '8',   temp: 1249 },
  { cono: '9',   temp: 1260 },
]

// Coincidencia exacta de temperatura, o null.
export function conoDeTemperatura(t: number): string | null {
  return CONOS_ORTON.find(c => c.temp === t)?.cono ?? null
}
