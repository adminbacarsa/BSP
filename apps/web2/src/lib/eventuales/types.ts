export type ModalidadLaboral = 'INDETERMINADO' | 'EVENTUAL' | 'PLAZO_FIJO';

export type BolsaEstado = 'ACTIVA' | 'BAJA' | 'EFECTIVIZADO';

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
