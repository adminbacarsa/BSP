export type ModalidadLaboral = 'INDETERMINADO' | 'EVENTUAL' | 'PLAZO_FIJO';

/** En la bolsa. No es un alta ARCA vigente: la persona está disponible sin alta. */
export type BolsaDisponibilidad = 'DISPONIBLE' | 'NO_DISPONIBLE';

export type EstadoArcaMovimiento = 'ALTA' | 'BAJA';

export interface ArcaHistorialItem {
  estado: EstadoArcaMovimiento;
  fecha: string;
  origen: 'IMPORT_PLANILLA' | 'CONTRATO' | 'EFECTIVIZACION';
  contratoId?: string | null;
}

export interface JornadaContrato {
  fecha: string;
  horaInicio: string;
  horaFin: string;
  horas: number;
}

export type AdicionalEscalaTipo = 'REMUNERATIVO' | 'NO_REMUNERATIVO' | 'VIATICO';
export type AdicionalEscalaModo = 'POR_JORNADA' | 'POR_DIA' | 'POR_HORA' | 'FIJO_PERIODO';

/** Una vigencia de la paritaria. Doc id = `{convenio}_{categoria}_{vigenciaDesde}`. */
export interface EscalaSalarial {
  convenio: 'CCT_422_05';
  categoria: string;
  categoriaLabel: string;
  vigenciaDesde: string;
  vigenciaHasta?: string | null;
  basicoMensual: number;
  divisorHoras: number;
  jornadaOrdinariaHoras: number;
  recargos: {
    nocturnoPct: number | null;
    extra50Pct: number;
    extra100Pct: number;
    sabado13Pct: number;
    domingoPct: number;
    feriadoPct: number;
  };
  presentismo?: { pct: number; divisorDias?: number; tipo?: AdicionalEscalaTipo } | null;
  adicionales: Array<{
    codigo: string;
    nombre: string;
    tipo: AdicionalEscalaTipo;
    modo: AdicionalEscalaModo;
    monto: number;
  }>;
  sac?: { divisor: number };
  vacaciones?: { unDiaCada: number; divisorDiasMes: number };
  status: 'ACTIVE' | 'PENDIENTE_APROBACION' | 'INACTIVE';
  fuenteUrl?: string;
  fuenteNota?: string;
}

/** Defaults de carga masiva ARCA por empresa. Doc: empresas/{id}.arcaEventuales. */
export interface ArcaEventualesConfig {
  modalidadContrato: string;
  movimientoAlta: string;
  movimientoBaja: string;
  situacionRevistaAlta: string;
  situacionRevistaBaja: string;
  modalidadLiquidacion: string;
  sucursal: string;
  actividad: string;
  puesto: string;
  cctCodigo: string;
  categoriaProfesional: string;
  obraSocialDefault?: string;
}

export interface ContratoEventual {
  empresaId: string;
  employeeId: string;
  bolsaCuil: string;
  causa: string;
  fechaAlta: string;
  fechaBaja: string;
  jornadas: JornadaContrato[];
  estado: ContratoEventualEstado;
  status: 'ACTIVE' | 'INACTIVE';
}

export type ContratoEventualEstado =
  | 'BORRADOR'
  | 'DOCUMENTADO'
  | 'ACUSE_RECIBIDO'
  | 'ALTA_ARCA'
  | 'VIGENTE'
  | 'FINALIZADO'
  | 'BAJA_ARCA'
  | 'ANULADO';

export type PlanillaClase = 'ACTIVO' | 'EFECTIVIZADO' | 'BAJA' | 'GOLONDRINA' | 'DESCONOCIDO';

export interface LegajoBolsaRef {
  empresaId: string;
  employeeId: string;
  modalidad: ModalidadLaboral;
}

export interface ModalidadHistoryItem {
  modalidad: ModalidadLaboral;
  desde: string;
  hasta?: string;
  motivo: 'ALTA' | 'EFECTIVIZACION' | 'REINGRESO_EVENTUAL' | 'IMPORT_PLANILLA';
  contratoId?: string;
  setByUid: string;
  setAt: string;
}
