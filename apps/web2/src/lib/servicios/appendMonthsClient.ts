import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '@/lib/firebase';
import { slaService, type ServiceSLA } from '@/services/slaService';
import { calculateMonthlyBreakdown } from '@/lib/servicios/slaHoursCalculator';
import { findEncargadoPosition } from '@/lib/servicios/encargadoPosition';
import { localTodayYmd, newSlaBornClosed, stripSlaLifecycle } from '@/lib/servicios/newSlaDraft';
import {
  buildSlaDraftsForSegments,
  firstOfMonthAfter,
  formatDmy,
  lastDayOfMonth,
  lastOfChain,
  newSlaSeriesId,
  overlappingSegments,
  planAppendMonthsForward,
  type AppendMonthsPlan,
  type SlaMonthsMode,
} from '@/lib/servicios/slaMonthSplit';

export type SlaRow = ServiceSLA & { id: string };

export interface AppendMonthsPropuesta {
  /** Último servicio de la cadena (el que se extiende o del que se copian los meses). */
  last: SlaRow;
  mode: SlaMonthsMode;
  /** Fin propuesto: último día del mes siguiente al último vigente. */
  suggestedEnd: string;
  /** Si no se puede (cadena cerrada), el motivo. */
  error: string | null;
}

/** Igual que `openAppendMonths` del escritorio: último de la cadena, modo según `slaSeriesId`, fin sugerido. */
export function proponerAgregarMeses(services: readonly SlaRow[], srv: SlaRow): AppendMonthsPropuesta {
  const last = (lastOfChain(services as SlaRow[], srv) || srv) as SlaRow;
  const mode: SlaMonthsMode = last.slaSeriesId ? 'individuales' : 'agrupados';
  const suggestedEnd = lastDayOfMonth(firstOfMonthAfter(String(last.endDate || '')));
  const error = (last as { closed?: boolean }).closed === true
    ? 'El último servicio de la cadena está cerrado. Reabrilo para agregar meses.'
    : !String(last.endDate || '').trim()
      ? 'El servicio no tiene fecha de fin.'
      : null;
  return { last, mode, suggestedEnd, error };
}

/** Fin de vigencia al agregar `n` meses calendario completos después del último vigente. */
export function finAgregandoMeses(lastEndDate: string, n: number): string {
  let cursor = String(lastEndDate || '').slice(0, 10);
  for (let i = 0; i < Math.max(1, n); i += 1) cursor = lastDayOfMonth(firstOfMonthAfter(cursor));
  return cursor;
}

export interface AppendMonthsVistaPrevia {
  plan: AppendMonthsPlan;
  /** Meses ya cubiertos por otro servicio del objetivo (no se pisa). */
  overlapped: string[];
  /** Líneas para confirmar («• nov: 01/11 → 30/11»). */
  lines: string[];
  error: string | null;
}

/** Misma validación que el escritorio antes de confirmar: plan hacia adelante y sin pisar meses. */
export function vistaPreviaAgregarMeses(input: {
  services: readonly SlaRow[];
  last: SlaRow;
  mode: SlaMonthsMode;
  newEndDate: string;
}): AppendMonthsVistaPrevia {
  const plan = planAppendMonthsForward({ mode: input.mode, lastEndDate: String(input.last.endDate || ''), newEndDate: input.newEndDate });
  if (plan.error || (!plan.extendTo && plan.segments.length === 0)) {
    return { plan, overlapped: [], lines: [], error: plan.error || 'Solo podés agregar meses posteriores al último vigente' };
  }
  const overlapped = overlappingSegments(
    plan.segments,
    input.services as SlaRow[],
    { clientId: input.last.clientId, objectiveId: input.last.objectiveId },
    input.last.id,
  ).map((s) => s.label);
  const lines = plan.mode === 'agrupados'
    ? [`• hasta ${formatDmy(input.newEndDate)}`]
    : plan.segments.map((s) => `• ${s.label}: ${s.startDate.slice(8, 10)}/${s.startDate.slice(5, 7)} → ${s.endDate.slice(8, 10)}/${s.endDate.slice(5, 7)}${s.partial ? ' (parcial)' : ''}`);
  const error = overlapped.length > 0
    ? `Ya hay un servicio en ${overlapped.join(', ')} para ese objetivo. No se pisa.`
    : null;
  return { plan, overlapped, lines, error };
}

export interface AppendMonthsResultado {
  summary: string;
  /** Patches a aplicar sobre docs existentes (`endDate` extendido o `slaSeriesId`). */
  patches: Array<{ id: string; patch: Partial<ServiceSLA> & Record<string, unknown> }>;
  /** Docs nuevos (individuales). */
  created: SlaRow[];
}

async function registrarAuditoria(accion: string, detalle: string, empresaId: string | undefined, scopeEmpresa: boolean): Promise<void> {
  try {
    const currentUser = getAuth().currentUser;
    await addDoc(collection(db, 'audit_logs'), {
      timestamp: serverTimestamp(),
      actorUid: currentUser?.uid || 'SYSTEM',
      actorName: currentUser?.displayName || currentUser?.email || 'Sistema',
      action: accion,
      module: 'SERVICIOS_SLA',
      details: detalle,
      ...(scopeEmpresa && empresaId ? { empresaId } : {}),
      metadata: { platform: 'web_admin_crono_movil' },
    });
  } catch (error) {
    console.error('Error auditoría:', error);
  }
}

/**
 * Ejecuta «Agregar meses» con las mismas escrituras que `handleAppendMonths` del escritorio:
 * agrupados → `endDate` del doc + `totalMonthlyHours` recalculado; individuales → un doc por mes
 * (misma estructura, `slaSeriesId`, nacido cerrado si ya venció) y la serie en el origen si faltaba.
 * El llamador ya validó con `vistaPreviaAgregarMeses`.
 */
export async function ejecutarAgregarMeses(input: {
  services: readonly SlaRow[];
  last: SlaRow;
  plan: AppendMonthsPlan;
  newEndDate: string;
  empresaId: string;
  migracionCompleta: boolean;
  scopeEmpresa: boolean;
}): Promise<AppendMonthsResultado> {
  const { last, plan, empresaId, migracionCompleta, scopeEmpresa } = input;
  const positions = (last.positions || []).map((p) => ({ ...p, allowedShiftTypes: (p.allowedShiftTypes || []).map((s) => ({ ...s })) }));
  const totalContractHours = Math.round(
    calculateMonthlyBreakdown(positions, String(last.startDate || ''), input.newEndDate, last.excludedDates).reduce((acc, m) => acc + m.totalHours, 0),
  );
  const encPosToSave = findEncargadoPosition(positions);
  const base = JSON.parse(JSON.stringify({
    ...last,
    positions,
    startDate: last.startDate,
    endDate: last.endDate,
    totalMonthlyHours: totalContractHours,
    encargadoEmployeeId: encPosToSave ? (last.encargadoEmployeeId || '') : '',
    encargadoEmployeeName: encPosToSave ? (last.encargadoEmployeeName || '') : '',
  })) as Record<string, unknown>;
  if (scopeEmpresa && empresaId) base.empresaId = empresaId;

  if (plan.mode === 'agrupados' && plan.extendTo) {
    const patch = { endDate: plan.extendTo, totalMonthlyHours: totalContractHours };
    await slaService.update(last.id, patch, { empresaId, migracionCompleta });
    await registrarAuditoria('UPDATE_CONTRACT', `Extendió vigencia hasta ${plan.extendTo}: ${last.clientName} - ${last.objectiveName}`, empresaId, scopeEmpresa);
    return { summary: plan.summary, patches: [{ id: last.id, patch }], created: [] };
  }

  const seriesId = String(last.slaSeriesId || newSlaSeriesId());
  const today = localTodayYmd();
  const drafts = buildSlaDraftsForSegments(
    { ...stripSlaLifecycle(base), status: 'active', slaSeriesId: seriesId } as unknown as ServiceSLA,
    plan.segments,
    seriesId,
  ).map((d) => {
    const bornClosed = newSlaBornClosed(d.endDate, today);
    return { ...d, closed: bornClosed, ...(bornClosed ? { closedReason: 'VENCIDO' } : {}) };
  });
  const patches: AppendMonthsResultado['patches'] = [];
  if (!last.slaSeriesId) {
    await slaService.update(last.id, { slaSeriesId: seriesId }, { empresaId, migracionCompleta });
    patches.push({ id: last.id, patch: { slaSeriesId: seriesId } });
  }
  const created: SlaRow[] = [];
  for (const draft of drafts) {
    const row = { ...draft } as ServiceSLA & { id?: string };
    delete row.id;
    const ref = await slaService.add(row, empresaId);
    created.push({ ...row, id: ref.id } as SlaRow);
  }
  await registrarAuditoria('CREATE_CONTRACT', `Agregó meses (${plan.segments.map((s) => s.label).join(', ')}): ${last.clientName} - ${last.objectiveName}`, empresaId, scopeEmpresa);
  return { summary: plan.summary, patches, created };
}
