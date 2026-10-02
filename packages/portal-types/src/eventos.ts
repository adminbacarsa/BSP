export type TipoTurnoEvento = '3x8' | '2x12' | 'libre';

export type EstadoServicioEvento = 'pendiente' | 'confirmado' | 'ejecutado' | 'cancelado';

export type EstadoEvento =
  | 'activo'
  | 'borrador'
  | 'abierto'
  | 'en_curso'
  | 'ejecutado'
  | 'cancelado';

export type EstadoSolicitudEvento =
  | 'pendiente'
  | 'convocado'
  | 'aprobada'
  | 'rechazada'
  | 'cerrada'
  | 'reserva'
  /** Convocatoria de eventual sin respuesta en el plazo: no generó nada. */
  | 'vencida'
  /** Aceptó y después avisó que no puede asistir, antes del inicio. */
  | 'cancelada';

export type TipoSolicitudEvento = 'guardia_solicita' | 'admin_convoca' | 'admin_asigna';

export interface UbicacionServicioEvento {
  tipo: 'objetivo_existente' | 'nueva';
  objectiveId?: string;
  objectiveNombre?: string;
  direccion?: string;
  latitud?: number;
  longitud?: number;
}

export interface ServicioEvento {
  id: string;
  nombre: string;
  fecha: string;
  tipoTurno: TipoTurnoEvento;
  horaInicio: string;
  horaFin: string;
  horasTotal: number;
  ubicacion: UbicacionServicioEvento;
  cupo: number;
  aptitudesRequeridas?: string[];
  requisitos?: string;
  instrucciones?: string;
  status: EstadoServicioEvento;
}

export interface Evento {
  id?: string;
  empresaId: string;
  nombre: string;
  descripcion?: string;
  clienteId: string;
  clienteNombre: string;
  fecha: string;
  fechas?: string[];
  servicios: ServicioEvento[];
  status: EstadoEvento;
  horaInicio?: string;
  horaFin?: string;
  horasEvento?: number;
  cupoGuardias?: number;
}

export interface SolicitudEvento {
  id?: string;
  empresaId: string;
  eventoId: string;
  eventoNombre: string;
  servicioId: string;
  servicioNombre: string;
  servicioFecha: string;
  empleadoId: string;
  empleadoNombre: string;
  tipo: TipoSolicitudEvento;
  status: EstadoSolicitudEvento;
  nota?: string;
  convocadoPor?: string;
  respondidoAt?: unknown;
  respondidoPor?: string;
  creadoAt?: unknown;
  /** Convocatoria de un eventual de la bolsa: al aceptar nace turno EV + contrato + AT + código del anexo. */
  esEventual?: boolean;
  bolsaCuil?: string;
  pruebasSinMarco?: boolean;
  anexoEstado?: 'PENDIENTE_ACEPTACION' | 'PENDIENTE' | 'FIRMADO' | 'SIN_CANAL' | 'NO_EXIGIDO' | 'SIN_EFECTO';
  jornada?: { fecha?: string; horaInicio?: string; horaFin?: string; horas?: number };
  contratoId?: string | null;
  venceAt?: unknown;
}
