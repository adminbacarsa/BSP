import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { arDayBoundsMs, arYearMonth, arYmd, arHmOnYmdMs } from '../common/arClock';
import { horasSlaDelMes } from '../servicios/horasMesSla';
import { limitesMes, slaInactivo, ymdSla } from '../servicios/copiarSlaMes';

const TZ = 'America/Argentina/Buenos_Aires';
const FRANCO = new Set(['F', 'FF', 'FP']);
const NON_SERVICE = new Set(['F', 'FF', 'FP', 'V', 'L', 'A', 'E', 'AA', 'AUS', 'PG', 'ART']);
const LICENCIAS = new Set(['V', 'L', 'A', 'E', 'AA', 'PG', 'ART']);
const MESES = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

type DocData = FirebaseFirestore.DocumentData;

function clienteInactivo(d: DocData): boolean {
  if (d.active === false || d.isActive === false || d.baja === true) return true;
  const u = String(d.status ?? '').trim().toUpperCase();
  return u === 'INACTIVE' || u === 'INACTIVO' || u === 'SUSPENDED' || u === 'SUSPENDIDO';
}

function listaObjetivos(d: DocData): unknown[] {
  const raw = d.objetivos ?? d.objectives;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') return Object.values(raw as Record<string, unknown>);
  return [];
}

function objetivoActivo(o: unknown): boolean {
  if (!o || typeof o !== 'object') return true;
  const st = String((o as { status?: unknown }).status || 'ACTIVE').trim().toUpperCase();
  return st !== 'INACTIVE' && st !== 'INACTIVO';
}

function empleadoActivo(status: unknown): boolean {
  return ['active', 'activo', 'activa'].includes(String(status || '').trim().toLowerCase());
}

function esTurnoOperativo(s: DocData): boolean {
  const origin = String(s.origin || '');
  return origin === 'RETEN' || origin === 'OPERATIONS_COVERAGE' || origin === 'SLA_VIRTUAL'
    || s.isReten === true || s.resolvedBy === 'OPERACIONES';
}

function publicado(d: DocData): boolean {
  if (d.published === true || d.estado === 'publicado') return true;
  return d.publishedAt != null && d.publishedAt !== '';
}

function horasContratoMes(d: DocData, year: number, monthIndex0: number): number {
  const positions = Array.isArray(d.positions) ? d.positions : [];
  if (positions.length > 0) {
    const start = ymdSla(d.startDate) || '1970-01-01';
    const end = ymdSla(d.endDate) || '9999-12-31';
    const excluded = Array.isArray(d.excludedDates) ? d.excludedDates.map((f) => String(f)) : undefined;
    return horasSlaDelMes(positions as never[], start, end, excluded, year, monthIndex0);
  }
  const n = Number(d.totalMonthlyHours ?? d.horasMes ?? d.totalHours ?? d.hours ?? 0);
  return Number.isFinite(n) ? n : 0;
}

async function nombreEmpresa(db: admin.firestore.Firestore, empresaId: string): Promise<string> {
  const tokenSnap = await db.collection('dashboard_tokens').doc(empresaId).get();
  const desdeToken = String(tokenSnap.data()?.empresaName || '').trim();
  if (desdeToken && desdeToken !== empresaId) return desdeToken;
  const emp = await db.collection('empresas').doc(empresaId).get();
  const e = emp.data() || {};
  return String(e.nombre || e.name || e.razonSocial || desdeToken || empresaId);
}

export async function computeForEmpresa(empresaId: string, db: admin.firestore.Firestore): Promise<void> {
  const nowMs = Date.now();
  const hoy = arYearMonth(nowMs);
  const mesActual = limitesMes(`${hoy.year}-${String(hoy.month).padStart(2, '0')}`);
  const nextMonth = hoy.month === 12 ? 1 : hoy.month + 1;
  const nextYear = hoy.month === 12 ? hoy.year + 1 : hoy.year;
  const proximoMes = `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
  const { startMs } = arDayBoundsMs(nowMs);
  const todayStart = Timestamp.fromMillis(startMs);
  const todayEnd = Timestamp.fromMillis(startMs + 24 * 60 * 60 * 1000 - 1);

  let empresaNombre = empresaId;
  let activosClientes = 0;
  let totalClientes = 0;
  let totalObjetivos = 0;
  let empActivos = 0;
  let svcCount = 0;
  let horasMes = 0;
  let enServicio = 0;
  let deFranco = 0;
  let ausentes = 0;
  let vacantes = 0;
  let novedades = 0;
  let publicados = 0;
  let planSize = 0;
  let licenciasHoy = 0;
  const personalHoy = { M: 0, T: 0, N: 0, D12: 0, N12: 0, RET: 0, otros: 0 };
  let ausenciasMes = 0;
  let ftCiclo = 0;
  let periodoLabel = '';
  let cicloStart = '';
  let cicloEnd = '';

  const escribir = async (error?: string) => {
    const totalObj = totalObjetivos || planSize;
    const body: Record<string, unknown> = {
      empresaId,
      empresaNombre,
      timestamp: new Date().toISOString(),
      clientes: { activos: activosClientes, total: totalClientes },
      objetivos: totalObjetivos,
      empleados: { activos: empActivos },
      sla: { contratos: svcCount, horasMes: Math.round(horasMes) },
      operacionHoy: { enServicio, deFranco, ausentes, vacantes, novedades },
      planificacion: {
        proximoMes,
        objetivosPublicados: publicados,
        objetivosTotal: totalObj,
        pctPublicado: totalObj > 0 ? Math.round((publicados / totalObj) * 1000) / 10 : 0,
      },
      rrhh: {
        personalHoy,
        licenciasHoy,
        ausenciasMes,
      },
      liquidacion: {
        periodoActual: periodoLabel,
        cicloStart,
        cicloEnd,
        ftCiclo,
      },
    };
    if (error) body.error = error;
    await db.collection('dashboard_snapshots').doc(empresaId).set(body);
  };

  try {
    empresaNombre = await nombreEmpresa(db, empresaId);

    const clientsSnap = await db.collection('clients').where('empresaId', '==', empresaId).get();
    clientsSnap.forEach((doc) => {
      const d = doc.data();
      totalClientes++;
      if (clienteInactivo(d)) return;
      activosClientes++;
      totalObjetivos += listaObjetivos(d).filter(objetivoActivo).length;
    });

    const empSnap = await db.collection('empleados').where('empresaId', '==', empresaId).get();
    empSnap.forEach((doc) => {
      if (empleadoActivo(doc.data().status)) empActivos++;
    });

    const svcSnap = await db.collection('servicios_sla').where('empresaId', '==', empresaId).get();
    svcSnap.forEach((doc) => {
      const d = doc.data();
      if (d.closed === true || slaInactivo(d.status)) return;
      const start = ymdSla(d.startDate);
      const end = ymdSla(d.endDate) || '9999-12-31';
      if (start <= mesActual.end && end >= mesActual.start) {
        svcCount++;
        horasMes += horasContratoMes(d, mesActual.year, mesActual.month - 1);
      }
    });

    const turnosSnap = await db.collection('turnos')
      .where('empresaId', '==', empresaId)
      .where('startTime', '>=', todayStart)
      .where('startTime', '<=', todayEnd)
      .get();
    turnosSnap.forEach((doc) => {
      const s = doc.data();
      const status = String(s.status || '').toUpperCase();
      if (status === 'CANCELED' || status === 'CANCELLED') return;
      if (s.draft === true && !esTurnoOperativo(s)) return;
      const employeeId = String(s.employeeId || '').trim();
      if (!employeeId || employeeId.toUpperCase() === 'VACANTE') {
        vacantes++;
        return;
      }
      const code = String(s.code || s.type || '').toUpperCase();
      if (FRANCO.has(code) || (s.isFranco === true && code !== 'FT')) {
        deFranco++;
        return;
      }
      if (status === 'ABSENT' || s.isAbsent === true) {
        ausentes++;
        return;
      }
      if (LICENCIAS.has(code)) {
        licenciasHoy++;
        return;
      }
      if (!NON_SERVICE.has(code)) {
        enServicio++;
        if (code === 'M') personalHoy.M++;
        else if (code === 'T') personalHoy.T++;
        else if (code === 'N') personalHoy.N++;
        else if (code === 'D12') personalHoy.D12++;
        else if (code === 'N12') personalHoy.N12++;
        else if (code === 'RET') personalHoy.RET++;
        else personalHoy.otros++;
      }
    });

    const novSnap = await db.collection('novedades')
      .where('empresaId', '==', empresaId)
      .where('createdAt', '>=', todayStart)
      .get();
    novedades = novSnap.size;

    // Ausencias del mes calendario
    const ausSnap = await db.collection('ausencias')
      .where('empresaId', '==', empresaId)
      .where('startDate', '>=', mesActual.start)
      .where('startDate', '<=', mesActual.end)
      .get();
    ausenciasMes = ausSnap.size;

    // Ciclo 26→25 y FT del ciclo
    const ymdHoy = arYmd(nowMs);
    const dayHoy = parseInt(ymdHoy.slice(8), 10);
    if (dayHoy >= 26) {
      cicloStart = `${hoy.year}-${String(hoy.month).padStart(2, '0')}-26`;
      const em = hoy.month === 12 ? 1 : hoy.month + 1;
      const ey = hoy.month === 12 ? hoy.year + 1 : hoy.year;
      cicloEnd = `${ey}-${String(em).padStart(2, '0')}-25`;
    } else {
      const sm = hoy.month === 1 ? 12 : hoy.month - 1;
      const sy = hoy.month === 1 ? hoy.year - 1 : hoy.year;
      cicloStart = `${sy}-${String(sm).padStart(2, '0')}-26`;
      cicloEnd = `${hoy.year}-${String(hoy.month).padStart(2, '0')}-25`;
    }
    const cStartTs = Timestamp.fromMillis(arHmOnYmdMs(cicloStart, 0, 0));
    const cEndTs = Timestamp.fromMillis(arHmOnYmdMs(cicloEnd, 23, 59) + 59000);
    const startM = parseInt(cicloStart.slice(5, 7), 10);
    const endM = parseInt(cicloEnd.slice(5, 7), 10);
    const endY = parseInt(cicloEnd.slice(0, 4), 10);
    periodoLabel = `26 ${MESES[startM]} – 25 ${MESES[endM]} ${endY}`;

    const ftSnap = await db.collection('turnos')
      .where('empresaId', '==', empresaId)
      .where('code', '==', 'FT')
      .where('startTime', '>=', cStartTs)
      .where('startTime', '<=', cEndTs)
      .get();
    ftCiclo = ftSnap.docs.filter((d) => {
      const st = String(d.data().status || '').toUpperCase();
      return st !== 'CANCELED' && st !== 'CANCELLED';
    }).length;

    const planSnap = await db.collection('planificacion_estados')
      .where('empresaId', '==', empresaId)
      .where('year', '==', nextYear)
      .where('month', '==', nextMonth)
      .get();
    planSize = planSnap.size;
    planSnap.forEach((doc) => {
      if (publicado(doc.data())) publicados++;
    });

    await escribir();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[computeDashboardSnapshot] ${empresaId}`, err);
    try {
      await escribir(message);
    } catch (writeErr) {
      console.error(`[computeDashboardSnapshot] no se pudo guardar el error de ${empresaId}`, writeErr);
    }
  }
}

export const computeDashboardSnapshot = onSchedule(
  {
    schedule: 'every 60 minutes',
    timeZone: TZ,
    timeoutSeconds: 540,
    memory: '512MiB',
    region: 'us-central1',
  },
  async () => {
    const db = admin.firestore();
    const tokensSnap = await db.collection('dashboard_tokens').where('enabled', '==', true).get();
    await Promise.all(tokensSnap.docs.map((t) => computeForEmpresa(t.id, db)));
    console.log(`[computeDashboardSnapshot] empresas=${tokensSnap.size}`);
  },
);
