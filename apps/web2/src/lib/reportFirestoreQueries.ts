import { db, getDocsOnce } from '@/lib/firebase';
import {
    collection,
    query,
    where,
    Timestamp,
    type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { parsePlanificacionEstadoDocId } from '@/lib/multiempresa';
import { toCalendarDateStr } from '@/lib/planificacion/absenceCodes';

/** Meses hacia atrás desde el inicio del rango para capturar ausencias que empezaron antes y siguen vigentes. */
export const REPORT_ABSENCE_START_LOOKBACK_MONTHS = 2;

/** Timeout generoso: liquidación planta completa puede bajar miles de turnos. */
const REPORT_QUERY_TIMEOUT_MS = 180_000;

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

    if (empresaId) {
        const snaps = await Promise.all(
            months.map(({ year, month }) =>
                getDocsOnce(
                    query(
                        collection(db, 'planificacion_estados'),
                        where('empresaId', '==', empresaId),
                        where('year', '==', year),
                        where('month', '==', month),
                    ),
                    { timeoutMs: REPORT_QUERY_TIMEOUT_MS },
                ),
            ),
        );
        return filterDocs(snaps.flatMap((s) => s.docs));
    }

    // Sin empresaId: una query por mes (year+month). Evita getDocs de toda la colección.
    const snaps = await Promise.all(
        months.map(({ year, month }) =>
            getDocsOnce(
                query(
                    collection(db, 'planificacion_estados'),
                    where('year', '==', year),
                    where('month', '==', month),
                ),
                { timeoutMs: REPORT_QUERY_TIMEOUT_MS },
            ),
        ),
    );
    return filterDocs(snaps.flatMap((s) => s.docs));
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
        snap = await getDocsOnce(
            query(
                collection(db, 'ausencias'),
                where('employeeId', '==', empId),
                where('startDate', '>=', startTs),
                where('startDate', '<=', endTs),
            ),
            { timeoutMs: REPORT_QUERY_TIMEOUT_MS },
        );
    } else if (scopeEmpresa && empresaId) {
        snap = await getDocsOnce(
            query(
                collection(db, 'ausencias'),
                where('empresaId', '==', empresaId),
                where('startDate', '>=', startTs),
                where('startDate', '<=', endTs),
            ),
            { timeoutMs: REPORT_QUERY_TIMEOUT_MS },
        );
    } else {
        // Fallback acotado por fechas (evita getDocs de toda la colección).
        snap = await getDocsOnce(
            query(
                collection(db, 'ausencias'),
                where('startDate', '>=', startTs),
                where('startDate', '<=', endTs),
            ),
            { timeoutMs: REPORT_QUERY_TIMEOUT_MS },
        );
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

    const snap = await getDocsOnce(
        query(
            collection(db, 'ajustes_horas'),
            where('empresaId', '==', empresaId),
            where('fecha', '>=', startTs),
            where('fecha', '<=', endTs),
        ),
        { timeoutMs: REPORT_QUERY_TIMEOUT_MS },
    );

    if (!empId) return snap.docs;
    return snap.docs.filter((d) => String(d.data().employeeId ?? '') === empId);
}
