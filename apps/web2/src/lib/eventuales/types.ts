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
