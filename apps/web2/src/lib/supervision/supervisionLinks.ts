/** Deep-links compartidos — web admin y futura app supervisores. */
export function buildPlanificacionHref(opts: {
  objectiveId: string;
  clientId?: string;
  /** YYYY-MM-DD; default hoy AR */
  fecha?: string;
}): string {
  const fecha = String(opts.fecha || new Date().toLocaleDateString('en-CA')).slice(0, 10);
  const [yStr, mStr] = fecha.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const q = new URLSearchParams();
  q.set('objectiveId', opts.objectiveId);
  if (opts.clientId) q.set('clientId', opts.clientId);
  if (Number.isFinite(y) && y > 2000) q.set('year', String(y));
  if (Number.isFinite(m) && m >= 1 && m <= 12) q.set('month', String(m));
  return `/admin/planificacion/?${q.toString()}`;
}

export function buildOperacionesHref(opts?: { clientId?: string }): string {
  if (!opts?.clientId) return '/admin/operaciones';
  const q = new URLSearchParams();
  q.set('clientId', opts.clientId);
  return `/admin/operaciones/?${q.toString()}`;
}

export function solicitudEnMes(fecha: string, mes: string): boolean {
  const f = String(fecha || '').slice(0, 10);
  const m = String(mes || '').slice(0, 7);
  if (!f || !m) return true;
  return f.startsWith(m);
}
