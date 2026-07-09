export type EstadoHorno =
  | 'idle'
  | 'ejecutando'
  | 'rampa'
  | 'meseta'
  | 'pausado'
  | 'finalizado'
  | 'alarma_exceso'
  | 'alarma_critica'
  | 'detenido_manualmente'
  | 'emergencia'
  | 'error'
  | 'sin datos'

export type Page = 'horno' | 'programas' | 'historial' | 'config' | 'login'

export interface Horno {
  hornoId: string
  nombre: string
  ip?: string
  version?: string
  potencia?: number
}

export interface EstadoMQTT {
  temperatura: number
  tempObj: number
  etapa: number
  etapaTotal: number
  horas: number
  minutos: number
  rele: boolean
  rampaLenta: boolean
  rampaRapida: boolean
  corteLuz: boolean
  estado: EstadoHorno
}

export interface Paso {
  velocidad: number
  temperatura: number
  tiempo: number
}

export interface PuntoCurva {
  t: number
  temp: number
}

export interface Programa {
  nombre: string
  tipo: number
  tempFinal?: number
  pasos: Paso[]
}

export interface InfoHorno {
  hornoId: string
  nombre: string
  version: string
  mac: string
}

export interface ConfigHorno {
  nombre?: string
  potencia?: number
  factura?: number
  consumo?: number
  versionFirmware?: string
}

export interface Horneada {
  id: string
  programa: string
  tempMax: number
  kWhConsumidos: number
  costo: number
  duracionHoras: number
  duracionMinutos: number
  timestamp: number
  motivo: string
}

export interface HorneadaFirmware {
  timestamp: number
  nombre: string
  temp_max: number
  kwh: number
  costo: number
  duracion_min: number
  estado?: number
  motivo?: string
}

export type TipoNotif =
  | 'corte_luz'
  | 'rampa_rapida'
  | 'rampa_lenta'
  | 'etapa'
  | 'meseta'
  | 'fin'
  | 'alarma_critica'
  | 'alarma_exceso'
  | 'detenido'

export interface NotifMQTT {
  tipo: TipoNotif
  msg?: string
  tempActual?: number
}