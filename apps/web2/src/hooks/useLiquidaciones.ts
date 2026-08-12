import { useState, useEffect, useCallback, useRef } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
    collection, doc, setDoc, deleteDoc, onSnapshot,
    query, where, serverTimestamp,
} from 'firebase/firestore';
import { app, db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface RrhhNovedades {
    vacacionesDias: number;
    enfermedadDias: number;
    art: number;
    licenciaEspecialDias: number;
    permisoGremialDias: number;
    injustificadaDias: number;
    otrosDias: number;
}

export interface EmployeeLiquidacion {
    employee: {
        id: string;
        dni: string;
        cuil: string | null;
        fileNumber: string | null;
        fullName: string;
        laborAgreement: string | null;
    };
    acumulado: {
        hsTeoricas: number;
        hsReales: number;
        diurnas: number;
        nocturnas: number;
        al50: number;
        al100FT: number;
        plusFeriado: number;
    };
    liquidacion200: {
        bolsa: number;
        hsSimples: number;
        al50: number;
        nota: string;
    };
    pagaAparte: {
        francoTrabajado100: number;
        plusFeriado: number;
    };
    novedadesRRHH: RrhhNovedades;
    turnosCount: number;
    turnosConFichada: number;
    warnings: string[];
}

export interface LiquidacionSnapshot {
    cycleId: string;
    cycleStart: string;
    cycleEnd: string;
    cctVersion: '422/05';
    hoursMode: 'planned' | 'real';
    generatedAt: string;
    lockedAt: string | null;
    empresaId: string;
    items: EmployeeLiquidacion[];
    pagination: { page: number; pageSize: number; total: number };
}

export interface AjusteAdj {
    hsReales?: number;
    diurnas?: number;
    nocturnas?: number;
    al100FT?: number;
    plusFeriado?: number;
    vacacionesDias?: number;
    enfermedadDias?: number;
    art?: number;
    licenciaEspecialDias?: number;
    permisoGremialDias?: number;
    injustificadaDias?: number;
    otrosDias?: number;
}

export interface AjusteLiquidacion {
    id: string;
    empresaId: string;
    cycleId: string;
    employeeId: string;
    adj: AjusteAdj;
    nota: string;
    creadoPor: string;
    creadoAt: Date | null;
    updatedAt: Date | null;
}

// ─── Hook principal ───────────────────────────────────────────────────────────

interface UseLiquidacionesOptions {
    cycleId: string;
    hoursMode: 'planned' | 'real';
    empresaId: string;
}

interface UseLiquidacionesResult {
    snapshot: LiquidacionSnapshot | null;
    loading: boolean;
    error: string | null;
    ajustes: Map<string, AjusteLiquidacion>;
    refresh: () => void;
    saveAjuste: (employeeId: string, adj: AjusteAdj, nota: string) => Promise<void>;
    deleteAjuste: (employeeId: string) => Promise<void>;
}

function tsToDate(val: any): Date | null {
    if (!val) return null;
    if (val instanceof Date) return val;
    if (typeof val.toDate === 'function') return val.toDate();
    if (typeof val.seconds === 'number') return new Date(val.seconds * 1000);
    return null;
}

export function useLiquidaciones(opts: UseLiquidacionesOptions): UseLiquidacionesResult {
    const { cycleId, hoursMode, empresaId } = opts;
    const { user } = useAuth();

    const [snapshot, setSnapshot] = useState<LiquidacionSnapshot | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [ajustes, setAjustes] = useState<Map<string, AjusteLiquidacion>>(new Map());
    const refreshToken = useRef(0);

    // Cargar snapshot desde la callable cuando cambia cycleId/hoursMode.
    const loadSnapshot = useCallback(async () => {
        if (!cycleId || !empresaId) return;
        setLoading(true);
        setError(null);
        try {
            const fns = getFunctions(app, 'us-central1');
            const callable = httpsCallable<
                { cycleId: string; empresaId: string; hoursMode: string; pageSize: number },
                LiquidacionSnapshot
            >(fns, 'getPayrollSnapshotInternal');
            const result = await callable({ cycleId, empresaId, hoursMode, pageSize: 500 });
            setSnapshot(result.data);
        } catch (e: any) {
            setError(e?.message || 'Error al cargar liquidación.');
            setSnapshot(null);
        } finally {
            setLoading(false);
        }
    }, [cycleId, empresaId, hoursMode, refreshToken.current]); // eslint-disable-line react-hooks/exhaustive-deps

    const refresh = useCallback(() => {
        refreshToken.current += 1;
        loadSnapshot();
    }, [loadSnapshot]);

    useEffect(() => {
        loadSnapshot();
    }, [cycleId, empresaId, hoursMode]); // re-carga al cambiar parámetros

    // Suscripción en tiempo real a ajustes_liquidacion para este ciclo/empresa.
    useEffect(() => {
        if (!cycleId || !empresaId) return;
        const q = query(
            collection(db, 'ajustes_liquidacion'),
            where('empresaId', '==', empresaId),
            where('cycleId', '==', cycleId),
        );
        const unsub = onSnapshot(q, (snap) => {
            const map = new Map<string, AjusteLiquidacion>();
            snap.docs.forEach((d) => {
                const data = d.data();
                map.set(data.employeeId, {
                    id: d.id,
                    empresaId: data.empresaId,
                    cycleId: data.cycleId,
                    employeeId: data.employeeId,
                    adj: data.adj || {},
                    nota: data.nota || '',
                    creadoPor: data.creadoPor || '',
                    creadoAt: tsToDate(data.creadoAt),
                    updatedAt: tsToDate(data.updatedAt),
                });
            });
            setAjustes(map);
        });
        return () => unsub();
    }, [cycleId, empresaId]);

    const saveAjuste = useCallback(
        async (employeeId: string, adj: AjusteAdj, nota: string) => {
            if (!user || !cycleId || !empresaId) return;
            const docId = `${empresaId}_${cycleId}_${employeeId}`;
            const ref = doc(db, 'ajustes_liquidacion', docId);
            await setDoc(
                ref,
                {
                    empresaId,
                    cycleId,
                    employeeId,
                    adj,
                    nota,
                    creadoPor: user.uid,
                    updatedAt: serverTimestamp(),
                    creadoAt: serverTimestamp(),
                },
                { merge: true },
            );
        },
        [user, cycleId, empresaId],
    );

    const deleteAjuste = useCallback(
        async (employeeId: string) => {
            if (!empresaId || !cycleId) return;
            const docId = `${empresaId}_${cycleId}_${employeeId}`;
            await deleteDoc(doc(db, 'ajustes_liquidacion', docId));
        },
        [empresaId, cycleId],
    );

    return { snapshot, loading, error, ajustes, refresh, saveAjuste, deleteAjuste };
}

// ─── Helpers de presentación ──────────────────────────────────────────────────

/** Aplica ajustes manuales sobre un item calculado. Devuelve un objeto fusionado. */
export function applyAjuste(
    item: EmployeeLiquidacion,
    ajuste: AjusteLiquidacion | undefined,
): EmployeeLiquidacion & { hasAdjustment: boolean } {
    if (!ajuste || Object.keys(ajuste.adj).length === 0) {
        return { ...item, hasAdjustment: false };
    }
    const adj = ajuste.adj;
    const acumulado = { ...item.acumulado };
    if (adj.hsReales !== undefined) acumulado.hsReales = adj.hsReales;
    if (adj.diurnas !== undefined) acumulado.diurnas = adj.diurnas;
    if (adj.nocturnas !== undefined) acumulado.nocturnas = adj.nocturnas;
    if (adj.al100FT !== undefined) acumulado.al100FT = adj.al100FT;
    if (adj.plusFeriado !== undefined) acumulado.plusFeriado = adj.plusFeriado;

    const novedadesRRHH = { ...item.novedadesRRHH };
    if (adj.vacacionesDias !== undefined) novedadesRRHH.vacacionesDias = adj.vacacionesDias;
    if (adj.enfermedadDias !== undefined) novedadesRRHH.enfermedadDias = adj.enfermedadDias;
    if (adj.art !== undefined) novedadesRRHH.art = adj.art;
    if (adj.licenciaEspecialDias !== undefined) novedadesRRHH.licenciaEspecialDias = adj.licenciaEspecialDias;
    if (adj.permisoGremialDias !== undefined) novedadesRRHH.permisoGremialDias = adj.permisoGremialDias;
    if (adj.injustificadaDias !== undefined) novedadesRRHH.injustificadaDias = adj.injustificadaDias;
    if (adj.otrosDias !== undefined) novedadesRRHH.otrosDias = adj.otrosDias;

    const bolsa = Math.max(0, acumulado.hsReales - acumulado.al100FT);
    const hsSimples = Math.min(bolsa, 200);
    const al50Calc = Math.max(0, bolsa - 200);

    return {
        ...item,
        acumulado: { ...acumulado, al50: Math.round(al50Calc * 100) / 100 },
        liquidacion200: {
            bolsa: Math.round(bolsa * 100) / 100,
            hsSimples: Math.round(hsSimples * 100) / 100,
            al50: Math.round(al50Calc * 100) / 100,
            nota: item.liquidacion200.nota,
        },
        pagaAparte: {
            francoTrabajado100: Math.round(acumulado.al100FT * 100) / 100,
            plusFeriado: Math.round(acumulado.plusFeriado * 100) / 100,
        },
        novedadesRRHH,
        hasAdjustment: true,
    };
}

/** Genera un CSV de la liquidación actual (ajustada). */
export function buildLiquidacionCsv(
    items: (EmployeeLiquidacion & { hasAdjustment: boolean })[],
    cycleId: string,
    hoursMode: 'planned' | 'real',
): string {
    const modeLabel = hoursMode === 'planned' ? 'Planificadas' : 'Reales';
    const header = [
        'Legajo', 'Apellido y Nombre', 'DNI', 'CUIL',
        `Hs Teóricas`, `Hs ${modeLabel}`, 'Diurnas', 'Nocturnas',
        'FT 100%', 'Plus Feriado', 'Bolsa 200hs', 'Simples', 'Al 50%',
        'Vacaciones', 'Enfermedad', 'ART', 'Lic. Especial', 'P. Gremial', 'Injustificadas', 'Otros',
        'Ajustado', 'Warnings',
    ].join(',');

    const rows = items.map((it) => {
        const e = it.employee;
        const a = it.acumulado;
        const l = it.liquidacion200;
        const n = it.novedadesRRHH;
        const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        return [
            esc(e.fileNumber ?? ''),
            esc(e.fullName),
            esc(e.dni),
            esc(e.cuil ?? ''),
            a.hsTeoricas, a.hsReales, a.diurnas, a.nocturnas,
            a.al100FT, a.plusFeriado,
            l.bolsa, l.hsSimples, l.al50,
            n.vacacionesDias, n.enfermedadDias, n.art, n.licenciaEspecialDias,
            n.permisoGremialDias, n.injustificadaDias, n.otrosDias,
            it.hasAdjustment ? 'SI' : 'NO',
            esc(it.warnings.join(' | ')),
        ].join(',');
    });

    return `Ciclo:,${cycleId},Horas:,${modeLabel}\n${header}\n${rows.join('\n')}`;
}
