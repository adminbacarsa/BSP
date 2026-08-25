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
  solicitudId?: string;
  eventoId?: string;
  servicioId?: string;
};

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
    shiftId: typeof raw.shiftId === 'string' ? raw.shiftId : undefined,
    objectiveId: typeof raw.objectiveId === 'string' ? raw.objectiveId : undefined,
    solicitudId: typeof raw.solicitudId === 'string' ? raw.solicitudId : undefined,
    eventoId: typeof raw.eventoId === 'string' ? raw.eventoId : undefined,
    servicioId: typeof raw.servicioId === 'string' ? raw.servicioId : undefined,
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
