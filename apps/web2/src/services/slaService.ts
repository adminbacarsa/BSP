
import { db } from '@/lib/firebase';
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
}

// Definición de Puesto
export interface ServicePosition {
  id: string;
  name: string;
  code?: string;
  coverageType: '24hs' | '12hs_diurno' | '12hs_nocturno' | 'custom';
  quantity: number;
  allowedShiftTypes: ShiftVariant[];
  activeDays: string[];
  excludedDates?: string[];  // YYYY-MM-DD: días sin servicio solo para este puesto
  preferenciaGenero?: 'M' | 'F' | 'INDISTINTO';
}

/** Una versión del horario de bandas vigente a partir de `desde`. */
export interface HorarioVersion {
  /** Fecha de inicio de esta versión (YYYY-MM-DD). */
  desde: string;
  /** Horario por código de banda: M, T, N, D12, N12. */
  bandas: Record<string, { startTime: string; endTime: string; hours: number }>;
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
      const s = await getDocs(q);
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
          const s = await getDocs(empresaScopedQuery('clients', opts.empresaId, true) as ReturnType<typeof query>);
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
