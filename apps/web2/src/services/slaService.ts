
import { db, getDocsOnce } from '@/lib/firebase';
import { collection, addDoc, getDocs, doc, updateDoc, query, orderBy, where } from 'firebase/firestore';
import { empresaScopedQuery, filterSlaRowsByEmpresa, filterRowsByEmpresa, updateDocForEmpresa, stampEmpresaId } from '@/lib/multiempresa';

// Definición de Turno (variante)
export interface ShiftVariant {
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  hours: number;
  isCustom?: boolean;
  days?: string[];
  specificDates?: string[]; // YYYY-MM-DD: fechas puntuales (refuerzos), no recurrentes
  // Turno cortado: dos bloques separados en el día (ej. 09–13 y 18–22).
  // Si está presente, startTime/endTime corresponden al bloque 1 y se generan dos turnos en Firestore.
  blocks?: Array<{ startTime: string; endTime: string }>;
  // PAX específico para este turno. Cuando está presente en cualquier turno del puesto,
  // el cálculo usa este valor en lugar del pos.quantity global.
  quantity?: number;
}

// Definición de Puesto
export interface ServicePosition {
  id: string;
  name: string;
  code?: string;
  coverageType: '24hs' | '12hs_diurno' | '12hs_nocturno' | 'custom' | 'encargado' | 'eventos';
  quantity: number;
  allowedShiftTypes: ShiftVariant[];
  activeDays: string[];
  excludedDates?: string[];  // YYYY-MM-DD: días sin servicio solo para este puesto
  /**
   * Exclusión parcial por banda: fecha → códigos (M, T, N…).
   * Si ese día también está en excludedDates, manda el día completo.
   * Si el turno tiene quantity>1 y solo querés bajar PAX, usá excludedShiftPaxDates.
   */
  excludedShiftDates?: Record<string, string[]>;
  /**
   * Exclusión de N pax de una banda (sin apagar el turno entero).
   * fecha → { código → pax a excluir }. Ej: { "2025-07-03": { "M": 1 } } con M×2 → queda 1 pax.
   * Si excludePax >= quantity del turno, equivale a excludedShiftDates.
   */
  excludedShiftPaxDates?: Record<string, Record<string, number>>;
  preferenciaGenero?: 'M' | 'F' | 'INDISTINTO';
  /** Encargado/Eventos: si false no suma horas vendidas SLA ni cierre cobertura. Eventos siempre false. */
  includeInSlaTotals?: boolean;
  /** Encargado: horario fijo (L–V) vs rotación compartida (patrón 6×2, 5×1…). */
  encargadoScheduleMode?: 'fixed' | 'rotating';
  /** Patrón rotativo obligatorio si includeInSlaTotals y mode=rotating. */
  workPattern?: '6x2' | '5x1' | '4x12' | '6x1';
  /** Horas por jornada para patrón rotativo (default: turno ENC o 8). */
  workPatternHoursPerDay?: number;
  /** Soft-delete del puesto: deja de exigir cobertura / horas desde `inactiveFrom`. */
  status?: 'ACTIVE' | 'INACTIVE';
  inactiveFrom?: string;
  inactiveReason?: string;
  inactiveBy?: string;
}

export type SlaChangeAction =
  | 'REFUERZO_ESTRUCTURAL'
  | 'REVERT_REFUERZO'
  | 'CANCEL_SERVICE'
  | 'BAJA_PUESTO'
  | 'REACTIVAR_PUESTO';

export interface SlaChangeLogEntry {
  at: string;
  byUid?: string;
  byName?: string;
  action: SlaChangeAction;
  detail: string;
  solicitudId?: string;
  positionId?: string;
  positionName?: string;
  shiftCode?: string;
  paxDelta?: number;
}

export function isPositionActiveOnDate(
  pos: { status?: string; inactiveFrom?: string } | null | undefined,
  dateStr: string,
): boolean {
  const st = String(pos?.status || 'ACTIVE').toUpperCase();
  if (st !== 'INACTIVE' && st !== 'INACTIVO') return true;
  const from = String(pos?.inactiveFrom || '').slice(0, 10);
  if (!from) return false;
  return String(dateStr || '').slice(0, 10) < from;
}

export function appendSlaChangeLog(
  existing: SlaChangeLogEntry[] | undefined,
  entry: Omit<SlaChangeLogEntry, 'at'> & { at?: string },
): SlaChangeLogEntry[] {
  const next: SlaChangeLogEntry = {
    ...entry,
    at: entry.at || new Date().toISOString(),
  };
  return [...(existing || []), next].slice(-80);
}

/** Una versión del horario de bandas vigente a partir de `desde`. */
export interface HorarioVersion {
  /** Fecha de inicio de esta versión (YYYY-MM-DD). */
  desde: string;
  /** Horario por código de banda: M, T, N, D12, N12. */
  bandas: Record<string, { startTime: string; endTime: string; hours: number }>;
}

// Restricción de cobertura por empleado dentro de un SLA
export interface PositionAssignment {
  employeeId: string;
  employeeName: string;
  /** Puestos y bandas permitidos. Si shiftCodes está vacío, permite todas las bandas del puesto. */
  slots: Array<{ positionName: string; shiftCodes: string[] }>;
}

export interface RuleTrigger {
  employeeId: string;
  employeeName: string;
  shiftCode: string;
  shiftCodes?: string[]; // OR — si está presente y no vacío, overrides shiftCode
}

export type RuleActionType = 'EXCLUDE' | 'MOVE' | 'RESTRICT' | 'ASSIGN';

export interface RuleAction {
  type: RuleActionType;
  positionName?: string;
  shiftCode?: string;
  toPositionName?: string;
  toShiftCode?: string;
  employeeId?: string;
  employeeName?: string;
  allowedCode?: string;
}

export interface ServiceRule {
  id: string;
  name?: string;
  triggers: RuleTrigger[];
  actions: RuleAction[];
}

export type RotationTriggerType = 'WEEKLY' | 'DAY_OF_WEEK' | 'DATE_RANGE' | 'FORTNIGHT' | 'WEEK_OF_MONTH';

export interface RotationTrigger {
  type: RotationTriggerType;
  periodIndex?: number;       // WEEKLY: 0=Semana A, 1=Semana B, etc.
  days?: number[];            // DAY_OF_WEEK: 1=Lun…7=Dom
  fromDate?: string;          // DATE_RANGE: YYYY-MM-DD
  toDate?: string;            // DATE_RANGE: YYYY-MM-DD
  half?: 'FIRST' | 'SECOND'; // FORTNIGHT
  weekNumbers?: number[];     // WEEK_OF_MONTH: [1,2,3,4]
}

export interface RotationEntry {
  employeeId: string;
  employeeName: string;
  positionName: string;
  shiftCode: string;
  cycleAnchorDate?: string; // YYYY-MM-DD — fecha de un franco conocido (para ciclo automático)
  sequence?: string[];      // custom_sequence: secuencia de códigos que se repite, ej. ['F','N','N','N','N','N','F','T','T','T','T','T']
}

export interface RotationPeriod {
  label: string;
  trigger: RotationTrigger;
  entries: RotationEntry[];
}

export interface ServiceRotation {
  id: string;
  name?: string;
  cumplirCondicion?: boolean;
  cycleMode?: 'round_robin' | 'cycle_rotation' | 'custom_sequence';
  referenceWeekStart?: string;    // YYYY-MM-DD — lunes de la Semana A (para tipo WEEKLY, round_robin)
  weekStartDay?: number;          // 1=Lun (default), 2=Mar, …7=Dom
  cycleWorkDays?: number;         // días de trabajo en el ciclo (ej. 5 para 5+1)
  cycleOffDays?: number;          // días de franco en el ciclo (ej. 1 para 5+1, 2 para 6+2)
  cycleStartDate?: string;        // YYYY-MM-DD — para cycle_rotation nuevo servicio, auto-calcula anchors escalonados
  sequenceAnchorDate?: string;    // YYYY-MM-DD — día 0 de la secuencia (para custom_sequence)
  periods: RotationPeriod[];
}

// Definición de Contrato de Servicio (SLA)
export interface ServiceSLA {
  id?: string;
  clientId: string;
  clientName: string;
  objectiveId: string;
  objectiveName: string;
  startDate: string;
  endDate: string;
  positions: ServicePosition[];
  totalMonthlyHours: number;
  status: 'active' | 'inactive' | 'expired';
  excludedDates?: string[];  // YYYY-MM-DD: días sin servicio dentro del período del contrato
  /** Historial de cambios de horario. Cada entrada reemplaza el horario de bandas desde su fecha. */
  horarioVersiones?: HorarioVersion[];
  /** Restricciones de cobertura por empleado: en qué puestos y bandas puede trabajar. Ausencia = sin restricción. */
  positionAssignments?: PositionAssignment[];
  /** Reglas IF→THEN: condiciones que el planificador aplica automáticamente. */
  serviceRules?: ServiceRule[];
  /** Rotaciones periódicas por puesto/banda entre empleados. */
  serviceRotations?: ServiceRotation[];
  /** Persona asignada al puesto Encargado de este servicio (no es flag de legajo). */
  encargadoEmployeeId?: string;
  encargadoEmployeeName?: string;
  changeLog?: SlaChangeLogEntry[];
  cancelledAt?: string;
  cancelledBy?: string;
  cancelledByUid?: string;
  cancelReason?: string;
}

/**
 * Devuelve el horario de bandas activo para una fecha dada.
 * Si no hay versiones, devuelve null (usar los allowedShiftTypes de las posiciones).
 */
export function getHorarioActivoParaFecha(
  sla: ServiceSLA,
  fecha: string,
): Record<string, { startTime: string; endTime: string; hours: number }> | null {
  if (!sla.horarioVersiones?.length) return null;
  const sorted = [...sla.horarioVersiones].sort((a, b) => a.desde.localeCompare(b.desde));
  let active: HorarioVersion['bandas'] | null = null;
  for (const v of sorted) {
    if (v.desde <= fecha) active = v.bandas;
    else break;
  }
  return active;
}

export const slaService = {
  getAll: async (opts?: { empresaId?: string; scopeEmpresa?: boolean; clientIds?: Set<string> }) => {
    try {
      const scope = opts?.scopeEmpresa === true && !!opts?.empresaId?.trim();
      const clientIds = opts?.clientIds ?? new Set<string>();
      const q = scope
        ? query(collection(db, 'servicios_sla'))
        : query(collection(db, 'servicios_sla'));
      const s = await getDocs(q);
      const rows = s.docs.map(d => ({ id: d.id, ...d.data() } as ServiceSLA));
      const filtered = filterSlaRowsByEmpresa(rows, opts?.empresaId || '', scope, clientIds);
      return filtered.sort((a, b) =>
        (a.clientName || a.objectiveName || '').localeCompare(b.clientName || b.objectiveName || '', 'es'),
      );
    } catch (e) {
      console.error("Error getting services:", e);
      return [];
    }
  },

  getByClientId: async (clientId: string, opts?: { empresaId?: string; scopeEmpresa?: boolean }) => {
    try {
      const scope = opts?.scopeEmpresa === true && !!opts?.empresaId?.trim();
      const q = query(collection(db, 'servicios_sla'), where('clientId', '==', clientId));
      const s = await getDocs(q);
      const rows = s.docs.map(d => ({ id: d.id, ...d.data() } as ServiceSLA));
      if (!scope) return rows;
      const clientIds = new Set([clientId]);
      return filterSlaRowsByEmpresa(rows, opts!.empresaId!, true, clientIds);
    } catch (e) {
      console.error("Error filter services:", e);
      return [];
    }
  },

  getClients: async (opts?: { empresaId?: string; scopeEmpresa?: boolean }) => {
    try {
      const scope = opts?.scopeEmpresa === true && !!opts?.empresaId?.trim();
      const q = scope
        ? query(empresaScopedQuery('clients', opts!.empresaId!, true) as ReturnType<typeof query>, orderBy('name'))
        : query(collection(db, 'clients'), orderBy('name'));
      const s = await getDocsOnce(q);
      return filterRowsByEmpresa(
        s.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name || data.fantasyName || 'Sin Nombre',
          objectives: data.objetivos || data.objectives || [],
          empresaId: data.empresaId,
        };
      }),
        opts?.empresaId || '',
        scope,
      );
    } catch (e) {
      if (opts?.scopeEmpresa && opts.empresaId) {
        try {
          const s = await getDocsOnce(empresaScopedQuery('clients', opts.empresaId, true) as ReturnType<typeof query>);
          return filterRowsByEmpresa(
            s.docs.map(d => {
              const data = d.data();
              return {
                id: d.id,
                name: data.name || data.fantasyName || 'Sin Nombre',
                objectives: data.objetivos || data.objectives || [],
                empresaId: data.empresaId,
              };
            }),
            opts.empresaId,
            true,
          ).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        } catch {
          /* fall through */
        }
      }
      console.error("Error loading clients for dropdown:", e);
      return [];
    }
  },

  // 4. CRUD Básico
  add: async (data: ServiceSLA, empresaId?: string) => addDoc(
    collection(db, 'servicios_sla'),
    stampEmpresaId(data as Record<string, unknown>, empresaId || ''),
  ),

  update: (id: string, data: Partial<ServiceSLA>, opts?: { empresaId: string; migracionCompleta: boolean }) => {
    if (opts?.empresaId) {
      return updateDocForEmpresa('servicios_sla', id, data as Record<string, unknown>, opts.empresaId, opts.migracionCompleta);
    }
    return updateDoc(doc(db, 'servicios_sla', id), data);
  },

  delete: (id: string, opts?: { empresaId: string; migracionCompleta: boolean }) => {
    const payload = { status: 'inactive' as const, inactiveAt: new Date().toISOString() };
    if (opts?.empresaId) {
      return updateDocForEmpresa('servicios_sla', id, payload, opts.empresaId, opts.migracionCompleta);
    }
    return updateDoc(doc(db, 'servicios_sla', id), payload);
  },
};
