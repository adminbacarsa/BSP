import type { SolicitudRefuerzo } from '@/services/solicitudRefuerzoService';

export type RefuerzoActionTarget = 'PLANIFICACION' | 'OPERACIONES';

export function calcRefuerzoPactadaHours(startTime: string, endTime: string): number {
  const parse = (t: string) => {
    const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    return m ? +m[1] + +m[2] / 60 : null;
  };
  const s = parse(startTime);
  const e = parse(endTime);
  if (s === null || e === null) return 8;
  let dur = e - s;
  if (dur <= 0) dur += 24;
  return Math.max(0, Math.min(dur, 24));
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
    return `TURA · ${guardia} · ${sol.objectiveName || 'objetivo'}`;
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
  if (sol.alcance === 'ESTRUCTURAL') return 'PLANIFICACION';
  return sol.origen === 'PORTAL_CLIENTE' ? 'PLANIFICACION' : 'OPERACIONES';
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

  return {
    type: opts.type ?? (isPlanificacion ? 'REFUERZO_CLIENTE_PENDIENTE' : 'VACANTE_OPERATIVA'),
    title: buildRefuerzoDisplayTitle(sol),
    description: isPlanificacion
      ? buildRefuerzoPlanningInstruction(sol)
      : buildRefuerzoOperacionesInstruction(sol),
    status: 'pending',
    priority: 'high',
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
