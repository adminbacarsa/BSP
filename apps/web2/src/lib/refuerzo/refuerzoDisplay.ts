import type { SolicitudRefuerzo } from '@/services/solicitudRefuerzoService';

export type RefuerzoActionTarget = 'PLANIFICACION' | 'OPERACIONES';

export function calcRefuerzoPactadaHours(startTime: string, endTime: string): number {
  const parse = (t: string) => {
    const raw = String(t || '').trim();
    const hm = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (hm) return +hm[1] + +hm[2] / 60;
    const iso = raw.match(/T(\d{2}):(\d{2})/);
    if (iso) return +iso[1] + +iso[2] / 60;
    return null;
  };
  const s = parse(startTime);
  const e = parse(endTime);
  if (s === null || e === null) return 8;
  let dur = e - s;
  if (dur <= 0) dur += 24;
  return Math.max(0, Math.min(dur, 24));
}

/** Puntual vende extra. Estructural ya está en el SLA: no se cobra de nuevo. */
export function isSolicitudRefuerzoExtraVendible(sol: Pick<SolicitudRefuerzo, 'alcance' | 'slaApplied'>): boolean {
  if (sol.alcance === 'ESTRUCTURAL' || sol.slaApplied) return false;
  return true;
}

function instantFromClock(val: unknown): Date | null {
  if (!val) return null;
  if (typeof (val as { toDate?: () => Date }).toDate === 'function') {
    const d = (val as { toDate: () => Date }).toDate();
    return isNaN(d.getTime()) ? null : d;
  }
  const sec = (val as { seconds?: number; _seconds?: number }).seconds
    ?? (val as { _seconds?: number })._seconds;
  if (typeof sec === 'number' && sec > 0) return new Date(sec * 1000);
  if (typeof val === 'string') {
    const raw = val.trim();
    if (/^\d{1,2}:\d{2}$/.test(raw)) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Duración real del turno RFZ/TURA (ISO o Timestamp). No usa 8 h por defecto. */
export function hoursFromShiftClock(shift: {
  startTime?: unknown;
  endTime?: unknown;
  hours?: unknown;
}): number {
  const a = instantFromClock(shift.startTime);
  const b = instantFromClock(shift.endTime);
  if (a && b) {
    let dur = (b.getTime() - a.getTime()) / 3600000;
    if (dur <= 0) dur += 24;
    if (dur > 0 && dur <= 24) return Math.round(dur * 100) / 100;
  }
  if (typeof shift.startTime === 'string' && typeof shift.endTime === 'string') {
    const hs = calcRefuerzoPactadaHours(shift.startTime, shift.endTime);
    if (hs > 0 && hs < 24) return hs;
  }
  const stored = Number(shift.hours);
  if (Number.isFinite(stored) && stored >= 0.25 && stored <= 24) return stored;
  return 0;
}

export function formatRefuerzoTimeRange(startTime?: string, endTime?: string): string {
  const s = String(startTime || '').trim();
  const e = String(endTime || '').trim();
  if (!s && !e) return '—';
  if (s && e) return `${s}–${e}`;
  return s || e;
}

export function formatRefuerzoFechaAr(fecha?: string): string {
  if (!fecha) return '—';
  const parts = fecha.split('-');
  if (parts.length !== 3) return fecha;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function refuerzoTipoCode(sol: Pick<SolicitudRefuerzo, 'tipo'>): 'RFZ' | 'TURA' {
  return sol.tipo === 'AGREGADO_TURNO' ? 'TURA' : 'RFZ';
}

export function buildRefuerzoDisplayTitle(sol: SolicitudRefuerzo): string {
  const code = refuerzoTipoCode(sol);
  if (code === 'TURA') {
    const guardia = sol.parentEmpleadoName || 'guardia';
    const dest = sol.positionName?.trim();
    return dest
      ? `TURA · ${guardia} → ${dest} · ${sol.objectiveName || 'objetivo'}`
      : `TURA · ${guardia} · ${sol.objectiveName || 'objetivo'}`;
  }
  const puesto = sol.positionName || 'Puesto';
  const pax = sol.cantidadPax ?? 1;
  return `RFZ · ${puesto} · +${pax} persona${pax !== 1 ? 's' : ''}`;
}

export function buildRefuerzoDisplayDescription(sol: SolicitudRefuerzo): string {
  const code = refuerzoTipoCode(sol);
  const horario = formatRefuerzoTimeRange(sol.startTime, sol.endTime);
  const fecha = formatRefuerzoFechaAr(sol.fecha);
  const hs = calcRefuerzoPactadaHours(sol.startTime, sol.endTime);
  const pax = sol.cantidadPax ?? 1;
  const horasVendidas = (hs * (code === 'RFZ' ? pax : 1)).toFixed(1);

  const parts = [
    `${sol.clientName || 'Cliente'} · ${sol.objectiveName || 'Objetivo'}`,
    `${fecha} · ${horario} (${horasVendidas}h vendidas)`,
  ];

  if (code === 'TURA' && sol.parentEmpleadoName) {
    parts.push(`Agregar turno a ${sol.parentEmpleadoName}`);
  } else if (sol.positionName) {
    parts.push(`Puesto: ${sol.positionName}`);
  }

  if (sol.motivo?.trim()) parts.push(`Motivo: ${sol.motivo.trim()}`);
  if (sol.solicitadoPorNombre) parts.push(`Solicitó: ${sol.solicitadoPorNombre}`);

  return parts.join(' · ');
}

export function buildRefuerzoPlanningInstruction(sol: SolicitudRefuerzo): string {
  const code = refuerzoTipoCode(sol);
  const fecha = formatRefuerzoFechaAr(sol.fecha);
  const horario = formatRefuerzoTimeRange(sol.startTime, sol.endTime);
  if (code === 'TURA') {
    return `Asigná guardia al turno TURA en la grilla (${fecha} ${horario}) vinculado a ${sol.parentEmpleadoName || 'el guardia'}.`;
  }
  const pax = sol.cantidadPax ?? 1;
  const puesto = sol.positionName ? ` · ${sol.positionName}` : '';
  if (sol.alcance === 'ESTRUCTURAL') {
    return `Refuerzo estructural: +${pax} pax${puesto} desde ${fecha} ${horario}. Cubrir la demanda extra del SLA en la malla (no hay fila RFZ).`;
  }
  return `En Planificación, abrí la fila VACANTE RFZ${puesto} (${fecha} ${horario}) y asigná ${pax} guardia${pax !== 1 ? 's' : ''}.`;
}

export function buildRefuerzoOperacionesInstruction(sol: SolicitudRefuerzo): string {
  const code = refuerzoTipoCode(sol);
  const fecha = formatRefuerzoFechaAr(sol.fecha);
  const horario = formatRefuerzoTimeRange(sol.startTime, sol.endTime);
  if (code === 'TURA') {
    return `Vacante TURA urgente: ${sol.parentEmpleadoName || 'guardia'} · ${fecha} ${horario}. Asigná cobertura desde Operaciones.`;
  }
  const pax = sol.cantidadPax ?? 1;
  return `Vacante RFZ urgente: ${sol.positionName || 'Puesto'} · +${pax} pax · ${fecha} ${horario}. Asigná guardia desde Operaciones.`;
}

export function resolveRefuerzoActionTarget(sol: SolicitudRefuerzo): RefuerzoActionTarget {
  if (sol.actionTarget === 'PLANIFICACION' || sol.actionTarget === 'OPERACIONES') {
    return sol.actionTarget;
  }
  if (sol.alcance === 'ESTRUCTURAL') return 'PLANIFICACION';
  if (sol.tipo === 'REFUERZO_PUESTO') return 'PLANIFICACION';
  if (sol.origen === 'PORTAL_CLIENTE') return 'PLANIFICACION';
  return 'OPERACIONES';
}

/** TURA con guardia base ya asignado: extensión de plan, no vacante operativa. */
export function isTuraExtensionWithAssignedGuard(sol: Pick<SolicitudRefuerzo, 'tipo' | 'parentEmpleadoId' | 'parentShiftId'>): boolean {
  if (sol.tipo !== 'AGREGADO_TURNO') return false;
  return !!(String(sol.parentEmpleadoId || '').trim() || String(sol.parentShiftId || '').trim());
}

export function buildRefuerzoNovedadPayload(
  sol: SolicitudRefuerzo,
  opts: {
    reportedBy: string;
    turnoIds?: string[];
    actionTarget?: RefuerzoActionTarget;
    type?: string;
  },
): Record<string, unknown> {
  const code = refuerzoTipoCode(sol);
  const actionTarget = opts.actionTarget ?? resolveRefuerzoActionTarget(sol);
  const isPlanificacion = actionTarget === 'PLANIFICACION';
  const horasPactadas = calcRefuerzoPactadaHours(sol.startTime, sol.endTime);
  const pax = sol.cantidadPax ?? 1;
  const turaExtension = isTuraExtensionWithAssignedGuard(sol) && !isPlanificacion;

  const defaultType = isPlanificacion
    ? 'REFUERZO_CLIENTE_PENDIENTE'
    : turaExtension
      ? 'TURA_EXTENSION'
      : 'VACANTE_OPERATIVA';

  return {
    type: opts.type ?? defaultType,
    title: buildRefuerzoDisplayTitle(sol),
    description: isPlanificacion
      ? buildRefuerzoPlanningInstruction(sol)
      : turaExtension
        ? `Extensión TURA${sol.parentEmpleadoName ? ` de ${sol.parentEmpleadoName}` : ''}: ${sol.startTime || ''}–${sol.endTime || ''}. Horario anexado al turno en plan — no requiere protocolo de cobertura.`
        : buildRefuerzoOperacionesInstruction(sol),
    priority: turaExtension ? 'normal' : 'high',
    status: 'pending',
    actionTarget,
    solicitudRefuerzoId: sol.id,
    tipoSolicitud: code,
    empresaId: sol.empresaId,
    objectiveId: sol.objectiveId,
    objectiveName: sol.objectiveName,
    clientId: sol.clientId,
    clientName: sol.clientName,
    positionId: sol.positionId ?? null,
    positionName: sol.positionName ?? null,
    fecha: sol.fecha,
    startTime: sol.startTime,
    endTime: sol.endTime,
    cantidadPax: pax,
    horasPactadas,
    horasVendidasEstimadas: horasPactadas * (code === 'RFZ' ? pax : 1),
    motivo: sol.motivo ?? null,
    solicitadoPorNombre: sol.solicitadoPorNombre ?? null,
    parentEmpleadoId: sol.parentEmpleadoId ?? null,
    parentEmpleadoName: sol.parentEmpleadoName ?? null,
    parentShiftId: sol.parentShiftId ?? null,
    turnoIds: opts.turnoIds ?? [],
    reportedBy: opts.reportedBy,
    origenSolicitud: sol.origen,
  };
}
