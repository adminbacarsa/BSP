import * as admin from 'firebase-admin';
import { planificacionEstadoLookupDocIds, ymCordobaParts } from '../assistant/planificacionEstadoKeys';

export function isOperationalTurnoForCc(t: Record<string, unknown>): boolean {
  const origin = String(t.origin ?? '').trim().toUpperCase();
  const code = String(t.code ?? '').trim().toUpperCase();
  return (
    origin === 'RETEN' ||
    origin === 'OPERATIONS_COVERAGE' ||
    origin === 'SLA_VIRTUAL' ||
    origin === 'EVENTO' ||
    !!t.isReten ||
    String(t.resolvedBy ?? '').toUpperCase() === 'OPERACIONES' ||
    code === 'EV' ||
    !!t.eventoId
  );
}

function toYyyyMmDd(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value.trim().slice(0, 10);
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const ts = value as { toDate?: () => Date; seconds?: number };
  if (typeof ts.toDate === 'function') {
    const dt = ts.toDate();
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof ts.seconds === 'number') {
    return toYyyyMmDd(new Date(ts.seconds * 1000));
  }
  return String(value).trim().slice(0, 10);
}

function slaCoversCalendarMonth(
  startDate: unknown,
  endDate: unknown,
  year: number,
  monthIndex0: number,
): boolean {
  const startRaw = toYyyyMmDd(startDate);
  const endRaw = toYyyyMmDd(endDate);
  if (!startRaw && !endRaw) return false;
  const start = startRaw || '1970-01-01';
  const end = endRaw || '2099-12-31';
  const viewMonthStr = `${year}-${String(monthIndex0 + 1).padStart(2, '0')}-01`;
  const viewMonthEndStr = `${year}-${String(monthIndex0 + 1).padStart(2, '0')}-${String(new Date(year, monthIndex0 + 1, 0).getDate()).padStart(2, '0')}`;
  return start <= viewMonthEndStr && end >= viewMonthStr;
}

function isSlaContractActive(status: unknown): boolean {
  const st = String(status ?? '').trim().toLowerCase();
  if (!st) return true;
  return st !== 'inactive' && st !== 'inactivo' && st !== 'cancelled' && st !== 'cancelado';
}

/**
 * Coherencia CC (planificado):
 * 1) Servicio/SLA habilitado para el objetivo en el mes.
 * 2) Cronograma publicado (`publishedAt`).
 * Los turnos operativos (cobertura, RET, EV…) no pasan por esta puerta.
 */
export class CcObjectiveMonthGate {
  private publishCache = new Map<string, boolean>();
  private slaByEmpresa = new Map<string, admin.firestore.QueryDocumentSnapshot[]>();

  async isTurnoInCcScope(db: admin.firestore.Firestore, t: Record<string, unknown>): Promise<boolean> {
    if (t.draft === true || t.isVirtual === true) return false;
    if (isOperationalTurnoForCc(t)) return true;

    const objId = String(t.objectiveId ?? '').trim();
    const empId = String(t.empresaId ?? '').trim();
    if (!objId || !empId) return false;

    const startMs =
      (t.startTime as admin.firestore.Timestamp | undefined)?.toMillis?.() ??
      ((t.startTime as { seconds?: number } | undefined)?.seconds
        ? (t.startTime as { seconds: number }).seconds * 1000
        : 0);
    if (!startMs) return false;

    const { year, month } = ymCordobaParts(new Date(startMs));
    const monthIndex0 = month - 1;

    if (!(await this.hasActiveSlaForMonth(db, empId, objId, year, monthIndex0))) return false;
    if (!(await this.isPlanPublished(db, empId, objId, year, month))) return false;
    return true;
  }

  private async isPlanPublished(
    db: admin.firestore.Firestore,
    empresaId: string,
    objectiveId: string,
    year: number,
    month: number,
  ): Promise<boolean> {
    const key = `${empresaId}|${objectiveId}|${year}|${month}`;
    if (this.publishCache.has(key)) return this.publishCache.get(key)!;

    const docIds = planificacionEstadoLookupDocIds(empresaId, objectiveId, year, month);
    const docs = await Promise.all(docIds.map((id) => db.doc(`planificacion_estados/${id}`).get()));
    const ok = docs.some((d) => {
      if (!d.exists) return false;
      const pub = d.data()?.publishedAt;
      return pub != null && pub !== '';
    });
    this.publishCache.set(key, ok);
    return ok;
  }

  private async loadSlas(db: admin.firestore.Firestore, empresaId: string) {
    if (this.slaByEmpresa.has(empresaId)) return;
    const snap = await db.collection('servicios_sla').where('empresaId', '==', empresaId).limit(800).get();
    this.slaByEmpresa.set(empresaId, snap.docs);
  }

  private async hasActiveSlaForMonth(
    db: admin.firestore.Firestore,
    empresaId: string,
    objectiveId: string,
    year: number,
    monthIndex0: number,
  ): Promise<boolean> {
    await this.loadSlas(db, empresaId);
    const docs = this.slaByEmpresa.get(empresaId) ?? [];
    return docs.some((d) => {
      const data = d.data();
      if (String(data.objectiveId ?? '').trim() !== objectiveId) return false;
      if (!isSlaContractActive(data.status)) return false;
      return slaCoversCalendarMonth(data.startDate, data.endDate, year, monthIndex0);
    });
  }
}
