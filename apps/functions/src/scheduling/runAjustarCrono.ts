import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

const db = () => admin.firestore();

// ─────────────────────────────────────────────
// INTERFACES
// ─────────────────────────────────────────────

export interface RunAjustarCronoInput {
    empresaId: string;
    objectiveId: string;
    objectiveNombre?: string;
    fechaDesde: string;           // YYYY-MM-DD
    fechaHasta: string;           // YYYY-MM-DD
    motivo?: string;
    destinoObjetivoId?: string;
    destinoObjetivoNombre?: string;
}

export interface RunAjustarCronoOutput {
    ok: boolean;
    retenesLiberados: number;
    slotsAplicados: number;
    slotsOmitidos: number;
    errores: string[];
}

type Banda8 = 'M' | 'T' | 'N';
type Banda12 = 'D12' | 'N12';
type BandaAjuste = Banda8 | Banda12 | 'RET';

interface ShiftRow {
    id: string;
    employeeId: string;
    employeeName: string;
    banda: Banda8;
}

interface ShiftPlan {
    id: string;
    employeeId: string;
    employeeName: string;
    banda: Banda8;
    ajuste: BandaAjuste;
}

// ─────────────────────────────────────────────
// UTILIDADES DE FECHA (AR = UTC-3, sin DST)
// ─────────────────────────────────────────────

/** Genera YYYY-MM-DD strings entre fromStr y toStr (inclusive). */
function eachDayUTC(fromStr: string, toStr: string): string[] {
    const days: string[] = [];
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const [fy, fm, fd] = fromStr.split('-').map(Number);
    const [ty, tm, td] = toStr.split('-').map(Number);
    let cur = new Date(Date.UTC(fy, fm - 1, fd, 12, 0, 0));
    const last = new Date(Date.UTC(ty, tm - 1, td, 12, 0, 0));
    while (cur <= last) {
        const y = cur.getUTCFullYear();
        const m = String(cur.getUTCMonth() + 1).padStart(2, '0');
        const d = String(cur.getUTCDate()).padStart(2, '0');
        days.push(`${y}-${m}-${d}`);
        cur = new Date(cur.getTime() + MS_PER_DAY);
    }
    return days;
}

/** Boundaries del día AR en UTC para queries Firestore. AR = UTC-3: día AR 00:00 = UTC 03:00. */
function dayBoundsAR(dateStr: string): { start: admin.firestore.Timestamp; end: admin.firestore.Timestamp } {
    const [y, m, d] = dateStr.split('-').map(Number);
    return {
        start: admin.firestore.Timestamp.fromDate(new Date(Date.UTC(y, m - 1, d, 3, 0, 0))),
        end:   admin.firestore.Timestamp.fromDate(new Date(Date.UTC(y, m - 1, d + 1, 2, 59, 59))),
    };
}

/** Timestamps para turno de 12h. AR = UTC-3: 06:00 AR = 09:00 UTC. */
function build12hTimestamps(dateStr: string, band: Banda12) {
    const [y, m, d] = dateStr.split('-').map(Number);
    if (band === 'D12') {
        return {
            startTime: admin.firestore.Timestamp.fromDate(new Date(Date.UTC(y, m - 1, d,     9, 0, 0))), // 06:00 AR
            endTime:   admin.firestore.Timestamp.fromDate(new Date(Date.UTC(y, m - 1, d,    21, 0, 0))), // 18:00 AR
        };
    }
    return {
        startTime: admin.firestore.Timestamp.fromDate(new Date(Date.UTC(y, m - 1, d,    21, 0, 0))),     // 18:00 AR
        endTime:   admin.firestore.Timestamp.fromDate(new Date(Date.UTC(y, m - 1, d + 1, 9, 0, 0))),     // 06:00 AR+1
    };
}

/** Timestamps para turno de 8h. M: 07–15 AR, T: 15–23 AR, N: 23–07 AR+1. */
function build8hTimestamps(dateStr: string, band: Banda8) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const map: Record<Banda8, { sh: number; sm: number; eh: number; em: number; nextDay: boolean }> = {
        M: { sh: 10, sm: 0, eh: 18, em: 0, nextDay: false },  // 07:00–15:00 AR
        T: { sh: 18, sm: 0, eh:  2, em: 0, nextDay: true  },  // 15:00–23:00 AR
        N: { sh:  2, sm: 0, eh: 10, em: 0, nextDay: true  },  // 23:00–07:00 AR (start is +1 day UTC)
    };
    const { sh, sm, eh, em, nextDay } = map[band];
    const startDay = band === 'N' ? d + 1 : d;      // N starts at 23:00 AR = 02:00 UTC next day
    const endDay   = nextDay ? d + 1 : d;
    return {
        startTime: admin.firestore.Timestamp.fromDate(new Date(Date.UTC(y, m - 1, startDay, sh, sm, 0))),
        endTime:   admin.firestore.Timestamp.fromDate(new Date(Date.UTC(y, m - 1, endDay,   eh, em, 0))),
    };
}

function normBanda8(code: string): Banda8 | null {
    const c = String(code || '').toUpperCase();
    if (c === 'D12') return 'M';
    if (c === 'N12') return 'N';
    if (c === 'M' || c === 'T' || c === 'N') return c;
    return null;
}

function isOperacional(s: any): boolean {
    return s.origin === 'RETEN'
        || s.origin === 'OPERATIONS_COVERAGE'
        || s.origin === 'SLA_VIRTUAL'
        || !!s.isReten
        || s.resolvedBy === 'OPERACIONES';
}

const WORK_CODES = new Set(['M', 'T', 'N', 'D12', 'N12', 'RET']);

// ─────────────────────────────────────────────
// LÓGICA DE COMPRESIÓN (espejo de ajustesCronoService)
// ─────────────────────────────────────────────

function autoComprimir12h(shifts: ShiftRow[], liberarId: string): { ok: boolean; plan: ShiftPlan[] | null; error?: string } {
    if (shifts.length < 3) return { ok: false, plan: null, error: 'Se necesitan al menos 3 guardias.' };
    const n = shifts.find(s => s.banda === 'N');
    const liberar = shifts.find(s => s.employeeId === liberarId);
    if (!n) return { ok: false, plan: null, error: 'No hay turno Noche — no se puede comprimir sin N12.' };
    if (!liberar) return { ok: false, plan: null, error: 'Guardia a liberar no encontrado.' };
    if (liberar.employeeId === n.employeeId) return { ok: false, plan: null, error: 'No podés liberar al de Noche — quedaría sin N12.' };
    const diurno = shifts.find(s => s.employeeId !== liberarId && s.banda === 'M')
        ?? shifts.find(s => s.employeeId !== liberarId && s.banda === 'T')
        ?? shifts.find(s => s.employeeId !== liberarId && s.employeeId !== n.employeeId);
    if (!diurno) return { ok: false, plan: null, error: 'No se pudo asignar cobertura diurna D12.' };
    return {
        ok: true,
        plan: shifts.map(s => {
            if (s.employeeId === liberarId) return { ...s, ajuste: 'RET' as BandaAjuste };
            if (s.employeeId === n.employeeId) return { ...s, ajuste: 'N12' as BandaAjuste };
            if (s.employeeId === diurno.employeeId) return { ...s, ajuste: 'D12' as BandaAjuste };
            return { ...s, ajuste: 'RET' as BandaAjuste };
        }),
    };
}

/**
 * M+T+N disponibles → M→D12, N→N12, T→RET.
 * Fallback clásico si faltan bandas pero hay T.
 */
function autoComprimir12hAutomatico(shifts: ShiftRow[]): { ok: boolean; plan: ShiftPlan[] | null; error?: string } {
    if (shifts.length === 0) return { ok: false, plan: null, error: 'No hay turnos planificados ese día.' };
    const hasM = shifts.some(s => s.banda === 'M');
    const hasT = shifts.some(s => s.banda === 'T');
    const hasN = shifts.some(s => s.banda === 'N');
    if (hasM && hasT && hasN) {
        return {
            ok: true,
            plan: shifts.map(s => {
                if (s.banda === 'M') return { ...s, ajuste: 'D12' as BandaAjuste };
                if (s.banda === 'N') return { ...s, ajuste: 'N12' as BandaAjuste };
                return { ...s, ajuste: 'RET' as BandaAjuste };
            }),
        };
    }
    if (!hasT) return { ok: false, plan: null, error: `Sin banda Tarde (M:${hasM ? 1 : 0} T:0 N:${hasN ? 1 : 0}) — no hay guardias para liberar a RET.` };
    const t = shifts.find(s => s.banda === 'T');
    return autoComprimir12h(shifts, t!.employeeId);
}

// ─────────────────────────────────────────────
// HANDLER PRINCIPAL
// ─────────────────────────────────────────────

const RUNTIME = { timeoutSeconds: 120, memory: '512MB' as const };

export const runAjustarCronoHandler = async (
    data: RunAjustarCronoInput,
    context: functions.https.CallableContext,
): Promise<RunAjustarCronoOutput> => {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Se requiere autenticación.');
    }

    const {
        empresaId: rawEmpresaId,
        objectiveId,
        objectiveNombre: rawNombre,
        fechaDesde,
        fechaHasta,
        motivo = 'Evento — ajuste operativo',
        destinoObjetivoId,
        destinoObjetivoNombre,
    } = data;

    if (!rawEmpresaId || !objectiveId || !fechaDesde || !fechaHasta) {
        throw new functions.https.HttpsError('invalid-argument', 'empresaId, objectiveId, fechaDesde y fechaHasta son requeridos.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaDesde) || !/^\d{4}-\d{2}-\d{2}$/.test(fechaHasta)) {
        throw new functions.https.HttpsError('invalid-argument', 'fechaDesde y fechaHasta deben tener formato YYYY-MM-DD.');
    }

    const empresaId = String(rawEmpresaId).trim() || 'bacarsa';
    const objectiveNombre = rawNombre || objectiveId;
    const creadoPor = context.auth.token?.email || context.auth.uid;

    const days = eachDayUTC(fechaDesde, fechaHasta);
    if (days.length === 0 || fechaDesde > fechaHasta) {
        throw new functions.https.HttpsError('invalid-argument', 'Rango de fechas inválido.');
    }

    // Pre-cargar ajustes activos para evitar duplicados por día
    const existingSnap = await db()
        .collection('ajustes_crono')
        .where('empresaId', '==', empresaId)
        .where('tipo', '==', 'OPERATIVO')
        .where('origenObjetivoId', '==', objectiveId)
        .where('estado', '==', 'ACTIVO')
        .get();

    const alreadyAdjusted = new Set<string>();
    for (const docSnap of existingSnap.docs) {
        const ini = docSnap.data().fechaInicio?.toDate?.() as Date | undefined;
        if (!ini) continue;
        const arDate = new Date(ini.getTime() - 3 * 60 * 60 * 1000); // UTC → AR (-3h)
        const y = arDate.getUTCFullYear();
        const m = String(arDate.getUTCMonth() + 1).padStart(2, '0');
        const d = String(arDate.getUTCDate()).padStart(2, '0');
        alreadyAdjusted.add(`${y}-${m}-${d}`);
    }

    // Acumuladores para el documento ajustes_crono
    const cambiosBanda: Array<{
        employeeId: string;
        employeeName: string;
        bandaAnterior: string;
        bandaNueva: string;
        turnoIds: string[];
    }> = [];
    const retenes: Array<{
        employeeId: string;
        employeeName: string;
        turnoOrigenIds: string[];
        estado: string;
        destinoObjetivoId?: string;
        destinoObjetivoNombre?: string;
        destinoTurnoIds?: string[];
    }> = [];

    let retenesLiberados = 0;
    let slotsAplicados = 0;
    let slotsOmitidos = 0;
    const errores: string[] = [];

    const batch = db().batch();

    for (const dateStr of days) {
        if (alreadyAdjusted.has(dateStr)) { slotsOmitidos++; continue; }

        const { start, end } = dayBoundsAR(dateStr);
        const snap = await db()
            .collection('turnos')
            .where('objectiveId', '==', objectiveId)
            .where('startTime', '>=', start)
            .where('startTime', '<=', end)
            .get();

        const rows: ShiftRow[] = [];
        for (const s of snap.docs) {
            const d = s.data();
            if (d.draft === true) continue;
            if (isOperacional(d)) continue;
            const code = String(d.code || d.type || '').toUpperCase();
            if (!WORK_CODES.has(code)) continue;
            const banda = normBanda8(code);
            if (!banda) continue;
            rows.push({
                id: s.id,
                employeeId: String(d.employeeId || ''),
                employeeName: String(d.employeeName || d.employeeId || ''),
                banda,
            });
        }

        const result = autoComprimir12hAutomatico(rows);
        if (!result.ok || !result.plan) {
            slotsOmitidos++;
            continue;
        }

        for (const p of result.plan) {
            const turnoRef = db().collection('turnos').doc(p.id);

            if (p.ajuste === 'RET') {
                batch.update(turnoRef, {
                    origin: 'RETEN',
                    isReten: true,
                    code: 'RET',
                    name: 'Retén',
                    hours: 0,
                });
                const reten: typeof retenes[0] = {
                    employeeId: p.employeeId,
                    employeeName: p.employeeName,
                    turnoOrigenIds: [p.id],
                    estado: destinoObjetivoId ? 'ASIGNADO' : 'DISPONIBLE',
                };
                if (destinoObjetivoId && destinoObjetivoId !== objectiveId) {
                    reten.destinoObjetivoId = destinoObjetivoId;
                    if (destinoObjetivoNombre) reten.destinoObjetivoNombre = destinoObjetivoNombre;
                    const destRef = db().collection('turnos').doc();
                    const times = build8hTimestamps(dateStr, p.banda);
                    batch.set(destRef, {
                        employeeId: p.employeeId,
                        employeeName: p.employeeName,
                        objectiveId: destinoObjetivoId,
                        objectiveName: destinoObjetivoNombre || destinoObjetivoId,
                        code: p.banda,
                        name: p.banda,
                        hours: 8,
                        ...times,
                        origin: 'RETEN',
                        isReten: true,
                        draft: false,
                        empresaId,
                    });
                    reten.destinoTurnoIds = [destRef.id];
                }
                retenes.push(reten);
                retenesLiberados++;
            } else if (p.ajuste === 'D12' || p.ajuste === 'N12') {
                const times = build12hTimestamps(dateStr, p.ajuste);
                batch.update(turnoRef, { code: p.ajuste, name: p.ajuste, hours: 12, ...times });
                let entry = cambiosBanda.find(c => c.employeeId === p.employeeId && c.bandaNueva === p.ajuste);
                if (!entry) {
                    entry = { employeeId: p.employeeId, employeeName: p.employeeName, bandaAnterior: p.banda, bandaNueva: p.ajuste, turnoIds: [] };
                    cambiosBanda.push(entry);
                }
                entry.turnoIds.push(p.id);
            }
        }

        slotsAplicados++;
    }

    if (slotsAplicados === 0) {
        return {
            ok: false,
            retenesLiberados: 0,
            slotsAplicados: 0,
            slotsOmitidos,
            errores: errores.length ? errores : ['No se encontraron días con dotación comprimible en el rango.'],
        };
    }

    // Escribir el documento ajustes_crono
    const ajusteRef = db().collection('ajustes_crono').doc();
    batch.set(ajusteRef, {
        empresaId,
        tipo: 'OPERATIVO',
        fechaInicio: admin.firestore.Timestamp.fromDate(new Date(fechaDesde + 'T15:00:00Z')), // noon AR
        fechaFin:    admin.firestore.Timestamp.fromDate(new Date(fechaHasta + 'T15:00:00Z')),
        origenObjetivoId: objectiveId,
        origenObjetivoNombre: objectiveNombre,
        motivo: motivo.trim() || 'Evento — ajuste operativo',
        cambiosBanda,
        retenes,
        creadoPor,
        estado: 'ACTIVO',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    try {
        await batch.commit();
    } catch (e: any) {
        throw new functions.https.HttpsError('internal', e?.message || 'Error al guardar los cambios.');
    }

    return {
        ok: true,
        retenesLiberados,
        slotsAplicados,
        slotsOmitidos,
        errores,
    };
};

export const runAjustarCrono = functions
    .runWith(RUNTIME)
    .https.onCall(runAjustarCronoHandler);
