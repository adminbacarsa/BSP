/**
 * Alta o ajuste del SLA del mes a partir de la planilla.
 * Misma puerta que Servicios: validateSlaRange, no pisar un SLA que ya cubre el mes, audit_logs.
 */
import { getAuth } from 'firebase/auth';
import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { newSlaSeriesId, overlappingSegments, slaSegmentsForMode, validateSlaRange } from '@/lib/servicios/slaMonthSplit';
import type { EquivalenciaCodigo } from '@/lib/planificacion/equivalenciaCodigo';
import { agregarFranjasAPosiciones } from '@/lib/planificacion/definirCodigo';
import { agregarRfzfAPosiciones, type DiaLetra } from '@/lib/planificacion/refuerzosRapido';
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
  /** «Exige cobertura» del servicio; sin valor no se toca (en el alta queda sí). */
  exigeCobertura?: boolean;
}): Promise<{ id: string }> {
  if (!opts.clientId || !opts.objectiveId) throw new Error('Falta el cliente o el objetivo');
  if (!opts.franjas.length) throw new Error('Agregá al menos una franja');
  const { startDate, endDate } = rangoMes(opts.year, opts.month);
  const rangeError = validateSlaRange(startDate, endDate);
  if (rangeError) throw new Error(rangeError);
  const segments = slaSegmentsForMode('individuales', startDate, endDate);
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
      slaSeriesId: newSlaSeriesId(),
      exigeCobertura: opts.exigeCobertura !== false,
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
      ...(typeof opts.exigeCobertura === 'boolean' ? { exigeCobertura: opts.exigeCobertura } : {}),
    } as Partial<ServiceSLA>, { empresaId: opts.empresaId, migracionCompleta: opts.migracionCompleta });
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

/** Pasa los horarios confirmados en el pegado al servicio del mes. No crea franjas. */
export async function actualizarHorariosServicio(opts: {
  servicioId: string;
  empresaId: string;
  migracionCompleta: boolean;
  objectiveName: string;
  cambios: readonly { code: string; inicio: string; fin: string }[];
}): Promise<void> {
  if (!opts.cambios.length) return;
  const snap = await getDoc(doc(db, 'servicios_sla', opts.servicioId));
  if (!snap.exists()) throw new Error('No encontré el servicio');
  const actual = snap.data() as ServiceSLA & { closed?: boolean; positions?: PosicionServicioDoc[] };
  if (actual.closed) throw new Error('Contrato cerrado: no se puede modificar');
  const tocar = <T extends { code?: string; startTime?: string; endTime?: string }>(lista: T[] | undefined) => (lista || []).map((s) => {
    const hit = opts.cambios.find((c) => c.code.toUpperCase() === String(s.code || '').toUpperCase());
    return hit ? { ...s, startTime: hit.inicio, endTime: hit.fin } : s;
  });
  const positions = (actual.positions || []).map((p) => {
    const extra = p as PosicionServicioDoc & { shifts?: Array<{ code?: string; startTime?: string; endTime?: string }> };
    return {
      ...p,
      allowedShiftTypes: tocar(p.allowedShiftTypes),
      ...(extra.shifts ? { shifts: tocar(extra.shifts) } : {}),
    };
  });
  await slaService.update(opts.servicioId, {
    positions: JSON.parse(JSON.stringify(positions)),
  }, { empresaId: opts.empresaId, migracionCompleta: opts.migracionCompleta });
  const user = getAuth().currentUser;
  await addDoc(collection(db, 'audit_logs'), {
    timestamp: serverTimestamp(),
    actorUid: user?.uid || 'SYSTEM',
    actorName: user?.displayName || user?.email || 'Sistema',
    action: 'UPDATE_CONTRACT',
    module: 'SERVICIOS_SLA',
    details: `Actualizó horarios desde el pegado en ${opts.objectiveName}: ${opts.cambios.map((c) => `${c.code} ${c.inicio}–${c.fin}`).join(', ')}`,
    ...(opts.empresaId ? { empresaId: opts.empresaId } : {}),
    metadata: { platform: 'web_admin_crono', via: 'PEGADO_HORARIOS', servicioId: opts.servicioId },
  });
}

/** Puestos y turnos definidos en el pegado («P2 T», «C») que el servicio del mes no tenía. */
export async function agregarFranjasServicio(opts: {
  servicioId: string;
  empresaId: string;
  migracionCompleta: boolean;
  objectiveName: string;
  franjas: ReadonlyArray<{ puesto: string; code: string; inicio: string; fin: string }>;
}): Promise<string[]> {
  const snap = await getDoc(doc(db, 'servicios_sla', opts.servicioId));
  if (!snap.exists()) throw new Error('No encontré el servicio');
  const actual = snap.data() as ServiceSLA & { closed?: boolean; positions?: PosicionServicioDoc[] };
  if (actual.closed) throw new Error('Contrato cerrado: no se puede modificar');
  const res = agregarFranjasAPosiciones((actual.positions || []) as unknown as Array<Record<string, unknown>>, opts.franjas);
  if (!res) return [];
  await slaService.update(opts.servicioId, {
    positions: JSON.parse(JSON.stringify(res.positions)),
  }, { empresaId: opts.empresaId, migracionCompleta: opts.migracionCompleta });
  const user = getAuth().currentUser;
  await addDoc(collection(db, 'audit_logs'), {
    timestamp: serverTimestamp(),
    actorUid: user?.uid || 'SYSTEM',
    actorName: user?.displayName || user?.email || 'Sistema',
    action: 'UPDATE_CONTRACT',
    module: 'SERVICIOS_SLA',
    details: `Agregó desde el pegado en ${opts.objectiveName}: ${res.agregadas.join(', ')}`,
    ...(opts.empresaId ? { empresaId: opts.empresaId } : {}),
    metadata: { platform: 'web_admin_crono', via: 'PEGADO_DEFINIR', servicioId: opts.servicioId },
  });
  return res.agregadas;
}

/** Refuerzo fijo desde Planificación: suma la franja al puesto RFZF del servicio del mes. */
export async function agregarRfzfServicio(opts: {
  servicioId: string;
  empresaId: string;
  migracionCompleta: boolean;
  objectiveName: string;
  inicio: string;
  fin: string;
  dias: DiaLetra[];
  pax: number;
  /** Puesto donde va (PP, Guardia…). Vacío: RFZF. */
  puesto?: string;
  /** Sigla de la franja (T, N, RF…). Vacía: RFZF, RFZF2… */
  sigla?: string;
  /** Día en que arranca: ese mes corre desde acá; desde el mes siguiente con su patrón. */
  desde?: string;
}): Promise<{ code: string; puesto: string; texto: string }> {
  const snap = await getDoc(doc(db, 'servicios_sla', opts.servicioId));
  if (!snap.exists()) throw new Error('No encontré el servicio');
  const actual = snap.data() as ServiceSLA & { closed?: boolean; positions?: PosicionServicioDoc[] };
  if (actual.closed) throw new Error('Contrato cerrado: no se puede modificar');
  const res = agregarRfzfAPosiciones((actual.positions || []) as unknown as Array<Record<string, unknown>>, opts);
  await slaService.update(opts.servicioId, {
    positions: JSON.parse(JSON.stringify(res.positions)),
  }, { empresaId: opts.empresaId, migracionCompleta: opts.migracionCompleta });
  const user = getAuth().currentUser;
  await addDoc(collection(db, 'audit_logs'), {
    timestamp: serverTimestamp(),
    actorUid: user?.uid || 'SYSTEM',
    actorName: user?.displayName || user?.email || 'Sistema',
    action: 'UPDATE_CONTRACT',
    module: 'SERVICIOS_SLA',
    details: `Refuerzo fijo desde Planificación en ${opts.objectiveName}: ${res.texto}`,
    ...(opts.empresaId ? { empresaId: opts.empresaId } : {}),
    metadata: { platform: 'web_admin_crono', via: 'PLANIFICACION_RFZF', servicioId: opts.servicioId },
  });
  return { code: res.code, puesto: res.puesto, texto: res.texto };
}

export type AlcanceDiaNoTrabaja =
  | { tipo: 'todo' }
  | { tipo: 'puesto'; puesto: string }
  | { tipo: 'franja'; puesto: string; code: string };

/**
 * «No se trabaja este día» desde Planificación (feriado, fecha especial: Banco Cosquín el 7/10).
 * Mismo dato que «Días excluidos» de Servicios: todo el servicio, un puesto o una franja. Ese día no pide
 * cobertura, no cuenta como hora vendida ni se factura. El motivo queda en el servicio y en audit_logs.
 */
export async function excluirDiaServicio(opts: {
  servicioId: string;
  empresaId: string;
  migracionCompleta: boolean;
  objectiveName: string;
  ds: string;
  alcance: AlcanceDiaNoTrabaja;
  motivo: string;
}): Promise<string> {
  const snap = await getDoc(doc(db, 'servicios_sla', opts.servicioId));
  if (!snap.exists()) throw new Error('No encontré el servicio');
  const actual = snap.data() as ServiceSLA & { closed?: boolean; exclusionesMotivo?: Record<string, string> };
  if (actual.closed) throw new Error('Contrato cerrado: no se puede modificar');
  const sumar = (lista: unknown, v: string) => [...new Set([...(Array.isArray(lista) ? (lista as string[]) : []), v])].sort();
  const a = opts.alcance;
  const patch: Record<string, unknown> = {};
  let texto = '';
  if (a.tipo === 'todo') {
    patch.excludedDates = sumar((actual as { excludedDates?: string[] }).excludedDates, opts.ds);
    texto = 'todo el servicio';
  } else {
    const positions = ((actual.positions || []) as unknown as Array<Record<string, any>>).map((p) => {
      if (String(p.name || p.positionName || '').trim().toUpperCase() !== a.puesto.trim().toUpperCase()) return p;
      if (a.tipo === 'puesto') return { ...p, excludedDates: sumar(p.excludedDates, opts.ds) };
      const porFecha = { ...(p.excludedShiftDates || {}) } as Record<string, string[]>;
      porFecha[opts.ds] = sumar(porFecha[opts.ds], a.code);
      return { ...p, excludedShiftDates: porFecha };
    });
    patch.positions = JSON.parse(JSON.stringify(positions));
    texto = a.tipo === 'puesto' ? a.puesto : `${a.puesto} · ${a.code}`;
  }
  const clave = a.tipo === 'todo' ? `${opts.ds}|*` : a.tipo === 'puesto' ? `${opts.ds}|${a.puesto}` : `${opts.ds}|${a.puesto}|${a.code}`;
  patch.exclusionesMotivo = { ...(actual.exclusionesMotivo || {}), [clave]: opts.motivo.trim() };
  await slaService.update(opts.servicioId, patch as Partial<ServiceSLA>, { empresaId: opts.empresaId, migracionCompleta: opts.migracionCompleta });
  const user = getAuth().currentUser;
  await addDoc(collection(db, 'audit_logs'), {
    timestamp: serverTimestamp(),
    actorUid: user?.uid || 'SYSTEM',
    actorName: user?.displayName || user?.email || 'Sistema',
    action: 'UPDATE_CONTRACT',
    module: 'SERVICIOS_SLA',
    details: `No se trabaja el ${opts.ds.slice(8, 10)}/${opts.ds.slice(5, 7)} en ${opts.objectiveName} (${texto}): ${opts.motivo.trim()}`,
    ...(opts.empresaId ? { empresaId: opts.empresaId } : {}),
    metadata: { platform: 'web_admin_crono', via: 'PLANIFICACION_DIA_NO_TRABAJA', servicioId: opts.servicioId, fecha: opts.ds },
  });
  return texto;
}
