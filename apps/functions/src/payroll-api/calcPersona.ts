/**
 * Motor persona de `payrollApi` cuando `hoursCoreEnabled` está ON.
 *
 * Decisión de Mauro (H1, decisión 1): payrollApi usa EL MISMO cálculo por persona
 * que Reportes → Liquidación (junta legajo×día vía `buildPersonaBook`). API y
 * pantalla dan el mismo número por legajo. Espejo server-side de
 * `apps/web2/src/hooks/useReportes.ts` (bloque `personaBook`), con el mismo
 * fetch simple que usaba el motor legacy de este archivo (`calc.ts`).
 */
import * as admin from 'firebase-admin';
import type { CycleRange } from './cycle';
import { toTs } from './cycle';
import {
    belongsToEmpresaView,
    queryEmpleadosDocsScoped,
    tenantEmpresaIdsMatch,
} from '../assistant/assistantEmpresaScope';
import {
    buildPersonaBook,
    buildPersonaPublishStatusMap,
    personaEmployeeDisplayName,
    personaStatsToPayrollFigures,
} from '@cosp/hours-core';
import {
    fmtCuil,
    tsToDate,
    overlapsDay,
    datesBetween,
    RRHH_CODE_MAP,
    RRHH_TYPE_LABEL_TO_CODE,
} from './calc';
import type { EmployeeLiquidacion, LiquidacionSnapshot, RrhhNovedades } from './calc';

const normEmpresa = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, '_');

const emptyRrhh = (): RrhhNovedades => ({
    vacacionesDias: 0,
    enfermedadDias: 0,
    art: 0,
    licenciaEspecialDias: 0,
    permisoGremialDias: 0,
    injustificadaDias: 0,
    retiroAnticipadoDias: 0,
    otrosDias: 0,
});

export interface BuildSnapshotPersonaParams {
    db: admin.firestore.Firestore;
    cycle: CycleRange;
    empresaId: string;
    scopeEmpresa: boolean;
    migracionCompleta: boolean;
    clientIdFilter?: string;
    page: number;
    pageSize: number;
    hoursMode: 'planned' | 'real';
}

export async function buildLiquidacionSnapshotPersona(
    params: BuildSnapshotPersonaParams,
): Promise<LiquidacionSnapshot> {
    const { db, cycle, empresaId, scopeEmpresa, migracionCompleta, page, pageSize, hoursMode } = params;

    // 1) Empleados (mismo scope multiempresa que el resto de COSP y que el motor legacy).
    const empDocs = await queryEmpleadosDocsScoped(db, empresaId, scopeEmpresa, 5000);
    const empNameById: Record<string, string> = {};
    const empDataById = new Map<string, FirebaseFirestore.DocumentData>();
    empDocs.forEach((d) => {
        const data = d.data();
        if (!belongsToEmpresaView(data, empresaId, migracionCompleta)) return;
        const st = String(data.status || '').toLowerCase();
        if (st === 'inactive' || st === 'inactivo') return;
        empDataById.set(d.id, data);
        empNameById[d.id] = personaEmployeeDisplayName(data as { name?: unknown; firstName?: unknown; lastName?: unknown });
    });

    // 2) Feriados.
    const holidaysSnap = await db.collection('feriados').get();
    const holidays: Record<string, boolean> = {};
    holidaysSnap.forEach((d) => {
        const v = d.data()?.date;
        if (typeof v === 'string') holidays[v.slice(0, 10)] = true;
    });

    // 3) Turnos del ciclo — mismo fetch que el motor legacy (rango por startTime + fallback scheduleDate).
    const tStart = toTs(cycle.cycleStart);
    const tEnd = toTs(cycle.cycleEnd);
    const turnosSnap = await db
        .collection('turnos')
        .where('startTime', '>=', tStart)
        .where('startTime', '<=', tEnd)
        .get();
    const turnosDocs = turnosSnap.docs.slice();
    try {
        const bySched = await db
            .collection('turnos')
            .where('scheduleDate', '>=', cycle.cycleStartStr)
            .where('scheduleDate', '<=', cycle.cycleEndStr)
            .get();
        const seen = new Set(turnosDocs.map((d) => d.id));
        for (const d of bySched.docs) {
            if (!seen.has(d.id)) turnosDocs.push(d);
        }
    } catch {
        // Sin índice scheduleDate: alcanza la query por startTime.
    }

    const turnoBelongs = (data: FirebaseFirestore.DocumentData): boolean => {
        const docEmp = String(data.empresaId ?? '').trim();
        if (!scopeEmpresa) {
            // Bacarsa legacy: aceptar sin empresaId o bacarsa; excluir otras.
            if (!docEmp) return true;
            return tenantEmpresaIdsMatch(docEmp, empresaId) || normEmpresa(docEmp) === 'bacarsa';
        }
        return belongsToEmpresaView(data, empresaId, migracionCompleta);
    };

    const turnos: Array<Record<string, unknown>> = [];
    let turnosDescartadosEmpresa = 0;
    for (const doc of turnosDocs) {
        const data = doc.data();
        if (!data) continue;
        if (!turnoBelongs(data)) {
            turnosDescartadosEmpresa++;
            continue;
        }
        if (params.clientIdFilter && data.clientId !== params.clientIdFilter) continue;
        turnos.push({ id: doc.id, ...data });
    }

    // 4) Ausencias que pueden solapar el ciclo (mismo criterio que el motor legacy).
    const ausenciasSnap = await db
        .collection('ausencias')
        .where('startDate', '<=', cycle.cycleEndStr)
        .get();
    const ausencias: Array<Record<string, unknown>> = [];
    ausenciasSnap.forEach((doc) => {
        const data = doc.data();
        if (!data) return;
        if (!turnoBelongs(data)) return;
        const status = String(data.status || '').toUpperCase();
        if (status === 'PENDIENTE' || status === 'PENDING' || status === 'REJECTED' || status === 'RECHAZADA') return;
        ausencias.push({ id: doc.id, ...data });
    });

    // 5) Publicación — Reportes arranca en publishFilter='all' (useReportes.ts línea 1292); sin filtro
    // adicional acá para dar el mismo número que la pantalla por defecto.
    const planifSnap = await db.collection('planificacion_estados').get();
    const publishStatusMap = buildPersonaPublishStatusMap(
        planifSnap.docs
            .filter((d) => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
            .map((d) => d.id),
    );

    const lockDoc = await db.collection('payroll_cycles_locks').doc(cycle.cycleId).get();
    const lockedAtRaw = lockDoc.exists ? lockDoc.data()?.lockedAt : null;
    const lockedAt = lockedAtRaw ? tsToDate(lockedAtRaw)?.toISOString() ?? null : null;

    const book = buildPersonaBook({
        turnos,
        ausencias,
        publishStatusMap,
        rangeStartYmd: cycle.cycleStartStr,
        rangeEndYmd: cycle.cycleEndStr,
        empNameById,
        holidays,
        usePlannedHours: hoursMode === 'planned',
        publishFilter: 'all',
    });

    // Novedades RRHH por legajo — mismos códigos/días que el motor legacy.
    const rrhhByEmp = new Map<string, RrhhNovedades>();
    for (const abs of ausencias) {
        const empId = String(abs.employeeId || '').trim();
        if (!empNameById[empId]) continue;
        const startStr = String(abs.startDate || '').slice(0, 10);
        const endStr = String(abs.endDate || startStr).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startStr)) continue;
        const start = tsToDate(startStr);
        const end = tsToDate(endStr) || start;
        if (!start || !end) continue;
        if (end < cycle.cycleStart || start > cycle.cycleEnd) continue;
        const days = datesBetween(start, end).filter((d) => overlapsDay(cycle.cycleStart, cycle.cycleEnd, d));
        if (days.length === 0) continue;

        const raw = String(abs.absenceType || abs.codigo || abs.type || '').trim();
        const upper = raw.toUpperCase();
        const code = RRHH_CODE_MAP[upper] ? upper : (RRHH_TYPE_LABEL_TO_CODE[upper] || upper);
        const bucket = rrhhByEmp.get(empId) || emptyRrhh();
        const mappedField = RRHH_CODE_MAP[code];
        if (mappedField) {
            (bucket[mappedField] as number) += days.length;
        } else {
            bucket.otrosDias += days.length;
        }
        rrhhByEmp.set(empId, bucket);
    }

    const allItems: EmployeeLiquidacion[] = book.employees.map(({ employeeId, shifts, stats }) => {
        const empData = (empDataById.get(employeeId) || {}) as Record<string, unknown>;
        const fullName = personaEmployeeDisplayName(empData as { name?: unknown; firstName?: unknown; lastName?: unknown });
        const dni = String(empData.dni || '').trim();
        const cuil = fmtCuil(empData.cuil || empData.cuit);
        const fileNumber = empData.fileNumber || empData.legajo
            ? String(empData.fileNumber || empData.legajo)
            : null;
        const laborAgreement = empData.laborAgreement ? String(empData.laborAgreement) : null;
        const figures = personaStatsToPayrollFigures({ shifts, stats }, 0);

        return {
            employee: { id: employeeId, dni, cuil, fileNumber, fullName, laborAgreement },
            acumulado: figures.acumulado,
            liquidacion200: {
                bolsa: figures.liquidacion200.bolsa,
                hsSimples: figures.liquidacion200.hsSimples,
                al50: figures.liquidacion200.al50,
                nota: 'FT y Feriados se pagan aparte.',
            },
            pagaAparte: {
                francoTrabajado100: figures.acumulado.al100FT,
                plusFeriado: figures.acumulado.plusFeriado,
            },
            novedadesRRHH: rrhhByEmp.get(employeeId) || emptyRrhh(),
            totales: figures.totales,
            desglose: figures.desglose,
            turnosCount: figures.turnosCount,
            turnosConFichada: figures.turnosConFichada,
            warnings: [],
        };
    });

    allItems.sort((a, b) => a.employee.fullName.localeCompare(b.employee.fullName, 'es'));

    const total = allItems.length;
    const startIdx = (page - 1) * pageSize;
    const items = allItems.slice(startIdx, startIdx + pageSize);

    return {
        cycleId: cycle.cycleId,
        cycleStart: cycle.cycleStartStr,
        cycleEnd: cycle.cycleEndStr,
        cctVersion: '422/05',
        hoursMode,
        generatedAt: new Date().toISOString(),
        lockedAt,
        empresaId,
        items,
        pagination: { page, pageSize, total },
        diagnostics: {
            empleadosEmpresa: Object.keys(empNameById).length,
            turnosEnRango: turnosDocs.length,
            turnosContados: book.rawShifts.length,
            turnosDescartadosEmpresa,
            turnosDescartadosEmpleado: 0,
            turnosSinHorario: 0,
            turnosBorrador: 0,
            ausenciasContadas: ausencias.length,
            hoursCoreEnabled: true,
        },
    };
}