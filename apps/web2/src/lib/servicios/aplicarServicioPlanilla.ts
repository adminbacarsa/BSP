/**
 * Alta o ajuste del SLA del mes a partir de la planilla.
 * Misma puerta que Servicios: validateSlaRange, no pisar un SLA que ya cubre el mes, audit_logs.
 */
import { getAuth } from 'firebase/auth';
import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { overlappingSegments, slaSegmentsForMode, validateSlaRange } from '@/lib/servicios/slaMonthSplit';
import type { EquivalenciaCodigo } from '@/lib/planificacion/equivalenciaCodigo';
import {
  horasMesDeFranjas,
  posicionesDesdeFranjas,
  rangoMes,
  type FranjaServicioPlanilla,
  type PosicionServicioDoc,
} from '@/lib/planificacion/servicioDesdePlanilla';
import { slaService, type ServiceSLA } from '@/services/slaService';

export type SlaRango = {
  id?: string;
  clientId?: string;
  objectiveId?: string;
  startDate?: string;
  endDate?: string;
  closed?: boolean;
};

function cubreMes(s: SlaRango, start: string, end: string): boolean {
  const a = String(s.startDate || '').slice(0, 10);
  const b = String(s.endDate || '').slice(0, 10);
  return !!a && !!b && a <= end && b >= start;
}

export async function aplicarServicioPlanilla(opts: {
  accion: 'crear' | 'actualizar';
  servicioId?: string;
  clientId: string;
  clientName: string;
  objectiveId: string;
  objectiveName: string;
  empresaId: string;
  migracionCompleta: boolean;
  year: number;
  month: number;
  franjas: FranjaServicioPlanilla[];
  equivalencias: EquivalenciaCodigo[];
  otros: SlaRango[];
}): Promise<{ id: string }> {
  if (!opts.clientId || !opts.objectiveId) throw new Error('Falta el cliente o el objetivo');
  if (!opts.franjas.length) throw new Error('Agregá al menos una franja');
  const { startDate, endDate } = rangoMes(opts.year, opts.month);
  const rangeError = validateSlaRange(startDate, endDate);
  if (rangeError) throw new Error(rangeError);
  const segments = slaSegmentsForMode('agrupados', startDate, endDate);
  const horas = horasMesDeFranjas(opts.franjas, opts.year, opts.month);

  let id = opts.servicioId || '';
  if (opts.accion === 'crear') {
    const otros = opts.otros.map((s) => (
      s.objectiveId === opts.objectiveId ? { ...s, clientId: opts.clientId } : s
    ));
    const pisa = overlappingSegments(segments, otros, { clientId: opts.clientId, objectiveId: opts.objectiveId }, null);
    if (pisa.length) throw new Error('Ya hay un servicio que cubre este mes. Aplicalo en vez de crear otro.');
    const positions = posicionesDesdeFranjas(opts.franjas);
    const data = {
      clientId: opts.clientId,
      clientName: opts.clientName,
      objectiveId: opts.objectiveId,
      objectiveName: opts.objectiveName,
      startDate,
      endDate,
      positions,
      totalMonthlyHours: horas,
      status: 'active' as const,
      empresaId: opts.empresaId,
    };
    const ref = await slaService.add(data as ServiceSLA, opts.empresaId);
    id = ref.id;
  } else {
    if (!opts.servicioId) throw new Error('Falta el servicio a actualizar');
    const snap = await getDoc(doc(db, 'servicios_sla', opts.servicioId));
    if (!snap.exists()) throw new Error('No encontré el servicio');
    const actual = snap.data() as ServiceSLA & { closed?: boolean };
    if (actual.closed) throw new Error('Contrato cerrado: no se puede modificar');
    if (!cubreMes(actual, startDate, endDate)) throw new Error('Ese servicio no cubre este mes');
    const positions = posicionesDesdeFranjas(opts.franjas, (actual.positions || []) as PosicionServicioDoc[]);
    await slaService.update(opts.servicioId, {
      positions: JSON.parse(JSON.stringify(positions)),
      totalMonthlyHours: horas,
    }, { empresaId: opts.empresaId, migracionCompleta: opts.migracionCompleta });
    id = opts.servicioId;
  }

  await setDoc(doc(db, 'planificacion_import_mapeos', `${opts.empresaId}_${opts.objectiveId}`), {
    empresaId: opts.empresaId,
    objectiveId: opts.objectiveId,
    equivalencias: opts.equivalencias,
    actualizadoAt: new Date().toISOString(),
  }, { merge: true });

  try {
    const user = getAuth().currentUser;
    await addDoc(collection(db, 'audit_logs'), {
      timestamp: serverTimestamp(),
      actorUid: user?.uid || 'SYSTEM',
      actorName: user?.displayName || user?.email || 'Sistema',
      action: opts.accion === 'crear' ? 'CREATE_CONTRACT' : 'UPDATE_CONTRACT',
      module: 'SERVICIOS_SLA',
      details: `${opts.accion === 'crear' ? 'Creó' : 'Ajustó'} desde planilla el servicio de ${opts.objectiveName} (${startDate} → ${endDate})`,
      ...(opts.empresaId ? { empresaId: opts.empresaId } : {}),
      metadata: { platform: 'web_admin_crono', via: 'SERVICIO_PLANILLA', objectiveId: opts.objectiveId, servicioId: id },
    });
  } catch (e) {
    console.error('[servicio planilla] auditoría', e);
  }
  return { id };
}
