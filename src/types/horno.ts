export type EstadoHorno = 'idle' | 'ejecutando' | 'pausado' | 'finalizado' | 'error'

export interface Horno {
  hornoId: string
  nombre: string
  ip?: string
  version?: string
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

export interface Programa {
  nombre: string
  tipo: number
  pasos: Paso[]
}

export interface InfoHorno {
  hornoId: string
  nombre: string
  version: string
  mac: string
}