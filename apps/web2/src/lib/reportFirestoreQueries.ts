import { db } from '@/lib/firebase';
import {
    collection,
    getDocs,
    query,
    where,
    Timestamp,
    type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { parsePlanificacionEstadoDocId } from '@/lib/multiempresa';
import { toCalendarDateStr } from '@/lib/planificacion/absenceCodes';

/** Meses hacia atrás desde el inicio del rango para capturar ausencias que empezaron antes y siguen vigentes. */
export const REPORT_ABSENCE_START_LOOKBACK_MONTHS = 2;

export type YearMonth = { year: number; month: number };

export function subtractCalendarMonthsFromYmd(ymd: string, months: number): string {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setMonth(dt.getMonth() - months);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** Meses calendario (inclusive) que toca un rango YYYY-MM-DD. */
export function calendarMonthsInYmdRange(startYmd: string, endYmd: string): YearMonth[] {
    const [sy, sm] = startYmd.split('-').map(Number);
    const [ey, em] = endYmd.split('-').map(Number);
    const out: YearMonth[] = [];
    let y = sy;
    let m = sm;
    while (y < ey || (y === ey && m <= em)) {
        out.push({ year: y, month: m });
        m += 1;
        if (m > 12) {
            m = 1;
            y += 1;
        }
    }
    return out;
}

function ymdToStartTimestamp(ymd: string): Timestamp {
    return Timestamp.fromDate(new Date(`${ymd}T00:00:00`));
}

function ymdToEndTimestamp(ymd: string): Timestamp {
    return Timestamp.fromDate(new Date(`${ymd}T23:59:59.999`));
}

export function absenceOverlapsReportRange(
    data: { startDate?: unknown; endDate?: unknown },
    rangeStartYmd: string,
    rangeEndYmd: string,
): boolean {
    const startStr = toCalendarDateStr(data.startDate);
    const endStr = toCalendarDateStr(data.endDate || data.startDate);
    if (!startStr || !endStr) return false;
    return endStr >= rangeStartYmd && startStr <= rangeEndYmd;
}

export async function fetchReportPlanificacionEstados(
    empresaId: string,
    scopeEmpresa: boolean,
    rangeStartYmd: string,
    rangeEndYmd: string,
    objectiveId?: string,
): Promise<QueryDocumentSnapshot[]> {
    const months = calendarMonthsInYmdRange(rangeStartYmd, rangeEndYmd);
    const objFilter = String(objectiveId ?? '').trim();

    const filterDocs = (docs: QueryDocumentSnapshot[]) => {
        if (!objFilter) return docs;
        return docs.filter((d) => {
            const parsed = parsePlanificacionEstadoDocId(d.id);
            return parsed?.objectiveId === objFilter;
        });
    };

    if (scopeEmpresa && empresaId) {
        const snaps = await Promise.all(
            months.map(({ year, month }) =>
                getDocs(
                    query(
                        collection(db, 'planificacion_estados'),
                        where('empresaId', '==', empresaId),
                        where('year', '==', year),
                        where('month', '==', month),
                    ),
                ),
            ),
        );
        return filterDocs(snaps.flatMap((s) => s.docs));
    }

    const snap = await getDocs(collection(db, 'planificacion_estados'));
    const monthKeys = new Set(months.map((m) => `${m.year}-${m.month}`));
    return filterDocs(
        snap.docs.filter((d) => {
            const parsed = parsePlanificacionEstadoDocId(d.id);
            if (!parsed) return false;
            return monthKeys.has(`${parsed.year}-${parsed.month}`);
        }),
    );
}

export async function fetchReportAusencias(
    empresaId: string,
    scopeEmpresa: boolean,
    rangeStartYmd: string,
    rangeEndYmd: string,
    employeeId?: string,
): Promise<QueryDocumentSnapshot[]> {
    const lookbackYmd = subtractCalendarMonthsFromYmd(rangeStartYmd, REPORT_ABSENCE_START_LOOKBACK_MONTHS);
    const startTs = ymdToStartTimestamp(lookbackYmd);
    const endTs = ymdToEndTimestamp(rangeEndYmd);
    const empId = String(employeeId ?? '').trim();

    let snap;
    if (empId) {
        snap = await getDocs(
            query(
                collection(db, 'ausencias'),
                where('employeeId', '==', empId),
                where('startDate', '>=', startTs),
                where('startDate', '<=', endTs),
            ),
        );
    } else if (scopeEmpresa && empresaId) {
        snap = await getDocs(
            query(
                collection(db, 'ausencias'),
                where('empresaId', '==', empresaId),
                where('startDate', '>=', startTs),
                where('startDate', '<=', endTs),
            ),
        );
    } else {
        snap = await getDocs(collection(db, 'ausencias'));
    }

    return snap.docs.filter((d) => absenceOverlapsReportRange(d.data(), rangeStartYmd, rangeEndYmd));
}

export async function fetchReportAjustesHoras(
    empresaId: string,
    rangeStartYmd: string,
    rangeEndYmd: string,
    employeeId?: string,
): Promise<QueryDocumentSnapshot[]> {
    if (!empresaId) return [];
    const startTs = ymdToStartTimestamp(rangeStartYmd);
    const endTs = ymdToEndTimestamp(rangeEndYmd);
    const empId = String(employeeId ?? '').trim();

    const snap = await getDocs(
        query(
            collection(db, 'ajustes_horas'),
            where('empresaId', '==', empresaId),
            where('fecha', '>=', startTs),
            where('fecha', '<=', endTs),
        ),
    );

    if (!empId) return snap.docs;
    return snap.docs.filter((d) => String(d.data().employeeId ?? '') === empId);
}
