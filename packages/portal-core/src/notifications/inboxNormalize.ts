export type PortalInboxNormalized = {
  id: string;
  title: string;
  body: string;
  type: string;
  target?: string;
  read?: boolean;
  dismissed?: boolean;
  status?: string;
  requiresAck?: boolean;
  ackedAt?: unknown;
  createdAt?: unknown;
  shiftId?: string;
  objectiveId?: string;
  objectiveName?: string;
  positionName?: string;
  clientName?: string;
  clientId?: string;
  shiftCode?: string;
  startTime?: unknown;
  endTime?: unknown;
  convocatoriaId?: string;
  protocoloStep?: string;
  solicitudId?: string;
  eventoId?: string;
  servicioId?: string;
};

function asOptionalString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

export function normalizePortalInboxItem(
  id: string,
  raw: Record<string, unknown>,
): PortalInboxNormalized {
  return {
    id,
    title: String(raw.title ?? raw.titulo ?? 'Alerta'),
    body: String(raw.body ?? raw.mensaje ?? raw.message ?? ''),
    type: String(raw.type ?? raw.tipo ?? ''),
    target: typeof raw.target === 'string' ? raw.target : undefined,
    read: raw.read === true,
    dismissed: raw.dismissed === true,
    status: typeof raw.status === 'string' ? raw.status : undefined,
    requiresAck: raw.requiresAck === true,
    ackedAt: raw.ackedAt,
    createdAt: raw.createdAt,
    shiftId: asOptionalString(raw.shiftId),
    objectiveId: asOptionalString(raw.objectiveId),
    objectiveName: asOptionalString(raw.objectiveName ?? raw.objetivoNombre),
    positionName: asOptionalString(raw.positionName ?? raw.puestoNombre ?? raw.puesto),
    clientName: asOptionalString(raw.clientName ?? raw.clienteNombre),
    clientId: asOptionalString(raw.clientId),
    shiftCode: asOptionalString(raw.shiftCode ?? raw.code ?? raw.codigoTurno),
    startTime: raw.startTime ?? raw.shiftStartTime ?? undefined,
    endTime: raw.endTime ?? raw.shiftEndTime ?? undefined,
    convocatoriaId: asOptionalString(raw.convocatoriaId),
    protocoloStep: asOptionalString(raw.protocolStep ?? raw.protocoloStep),
    solicitudId: asOptionalString(raw.solicitudId),
    eventoId: asOptionalString(raw.eventoId),
    servicioId: asOptionalString(raw.servicioId),
  };
}

export function solicitudEventoStatusLabel(status: string): string {
  switch (status) {
    case 'pendiente':
      return 'Pendiente (RRHH)';
    case 'convocado':
      return 'Convocatoria — respondé';
    case 'aprobada':
      return 'Confirmado';
    case 'rechazada':
      return 'Rechazado';
    case 'cerrada':
      return 'Cerrado';
    case 'reserva':
      return 'Reserva';
    default:
      return status || '—';
  }
}

/** Líneas de detalle turno/objetivo para la tarjeta de alerta. */
export function portalInboxDetailLines(n: PortalInboxNormalized): string[] {
  const lines: string[] = [];
  const lugar = [n.clientName, n.objectiveName, n.positionName].filter(Boolean);
  if (lugar.length) lines.push(lugar.join(' · '));
  const codigo = n.shiftCode ? `Turno ${n.shiftCode}` : null;
  if (codigo) lines.push(codigo);
  return lines;
}
