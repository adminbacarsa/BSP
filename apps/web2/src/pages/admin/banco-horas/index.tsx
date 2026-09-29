import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { ChevronRight, Database, Download, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { db, functions } from '@/lib/firebase';
import {
  fetchHoursLedgerMonthly,
  HOURS_LEDGER_LIC_CODES,
  HOURS_LEDGER_PLAN_OPTIONS,
  planHoursOf,
  previewHoursLedgerMonth,
  hoursLedgerJobDocId,
  watchHoursLedgerJob,
  type HoursLedgerJobView,
  type HoursLedgerMonthRow,
  type HoursLedgerPlanMode,
} from '@/lib/hoursLedger/hoursLedgerRead';
import { httpsCallable } from 'firebase/functions';

type PlanMode = HoursLedgerPlanMode;
type Level = 'cliente' | 'objetivo' | 'puesto' | 'dia';
type MonthRow = HoursLedgerMonthRow;

type DayRow = MonthRow & {
  date: string;
  puestoId: string;
  puestoName: string;
  level: 'dia';
};

const nf = (n: number) => Math.round(Number(n) || 0).toLocaleString('es-AR');

function planOf(mode: PlanMode, r: { planPublished: number; planDraft: number }) {
  return planHoursOf(mode, r);
}

const SUM_KEYS = [
  'slaActive', 'slaInactive', 'slaClosed', 'slaWithoutPlan', 'planPublished', 'planDraft', 'worked', 'workedOutside',
  'covered', 'uncovered', 'ft', 'ext', 'adv', 'novedadPaga',
  'licV', 'licE', 'licL', 'licA', 'licPG', 'licSUS', 'licSGS',
  'ausenciaHoras', 'ausenciaTurnos', 'ausenciaLegajos',
  'uncoveredAusencia', 'uncoveredRetiro', 'uncoveredFaltaPlan',
] as const;

function groupClients(objectives: MonthRow[]): MonthRow[] {
  const map = new Map<string, MonthRow>();
  for (const o of objectives) {
    const id = o.clientId || '_sin_cliente';
    const prev = map.get(id);
    if (!prev) {
      map.set(id, {
        ...o,
        id,
        level: 'cliente',
        clientId: o.clientId,
        clientName: o.clientName || 'Sin cliente',
        objectiveId: '',
        objectiveName: '',
      });
      continue;
    }
    for (const k of SUM_KEYS) prev[k] = (Number(prev[k]) || 0) + (Number(o[k]) || 0);
  }
  return [...map.values()];
}

function when(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function BancoHorasPage() {
  const { canReadModule, rolePermissions, isSuperAdmin, loading } = useAuth();
  const { empresaId } = useEmpresa();
  const allowed = canReadModule('HOURS_BANK');
  // `rebuild` habilita el botón; el callable solo guarda si el usuario es SuperAdmin.
  const canRebuild = isSuperAdmin || (rolePermissions.HOURS_BANK || []).includes('rebuild');
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [planMode, setPlanMode] = useState<PlanMode>('published');
  const [monthly, setMonthly] = useState<MonthRow[]>([]);
  const [days, setDays] = useState<DayRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState<'vacio' | 'libro' | 'preview'>('vacio');
  const [stack, setStack] = useState<Array<{ level: Level; id: string; label: string }>>([]);
  const [job, setJob] = useState<HoursLedgerJobView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const kicked = useRef('');

  const periodKey = `${year}-${String(month).padStart(2, '0')}`;

  const loadStored = useCallback(async () => {
    if (!empresaId) return;
    setLoaded(false);
    setBusy(true);
    try {
      const book = await fetchHoursLedgerMonthly(empresaId, periodKey);
      setMonthly(book.monthly);
      setDays([]);
      setStack([]);
      setSource(book.source === 'libro' ? 'libro' : 'vacio');
    } catch (e) {
      console.error(e);
      toast.error('No se pudo leer el libro');
    } finally {
      setBusy(false);
      setLoaded(true);
    }
  }, [empresaId, periodKey]);

  useEffect(() => { void loadStored(); }, [loadStored]);

  useEffect(() => {
    if (!empresaId) return;
    return watchHoursLedgerJob(empresaId, periodKey, true, (raw) => {
      if (!raw) { setJob(null); return; }
      const total = Number(raw.total) || 0;
      const processed = Number(raw.processed) || 0;
      setJob({
        status: String(raw.status || ''),
        total,
        processed,
        currentObjectiveName: String(raw.currentObjectiveName || ''),
        error: String(raw.error || ''),
        createdBy: String(raw.createdBy || ''),
        finishedAt: String(raw.finishedAt || ''),
        dryRun: raw.dryRun !== false,
        failed: Array.isArray(raw.failed) ? raw.failed as HoursLedgerJobView['failed'] : [],
      });
    });
  }, [empresaId, periodKey]);

  useEffect(() => {
    if (!loaded || !empresaId || source !== 'vacio') return;
    const key = `${empresaId}|${periodKey}`;
    if (kicked.current === key) return;
    kicked.current = key;
    void preview();
  }, [loaded, empresaId, periodKey, source]);

  const preview = async () => {
    if (!empresaId) return;
    setBusy(true);
    try {
      const book = await previewHoursLedgerMonth(empresaId, periodKey);
      setMonthly(book.monthly);
      setDays([]);
      setStack([]);
      setSource(book.source === 'preview' ? 'preview' : 'vacio');
      toast.success('Vista previa (no se escribió en la base)');
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'La vista previa falló');
    } finally {
      setBusy(false);
    }
  };

  const retryFailed = async () => {
    if (!empresaId) return;
    setBusy(true);
    try {
      const call = httpsCallable(functions, 'rebuildHoursLedger', { timeout: 60000 });
      await call({
        empresaId,
        period: periodKey,
        dryRun: true,
        retry: true,
        jobId: hoursLedgerJobDocId(empresaId, periodKey, true),
      });
      const book = await previewHoursLedgerMonth(empresaId, periodKey);
      setMonthly(book.monthly);
      setSource(book.source === 'preview' ? 'preview' : 'vacio');
      toast.success('Se reintentaron las tandas fallidas');
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo reintentar');
    } finally {
      setBusy(false);
    }
  };

  const empresa = monthly.find((r) => r.level === 'empresa');
  const storedClients = monthly.filter((r) => r.level === 'cliente');
  const objectives = monthly.filter((r) => r.level === 'objetivo');
  const clients = storedClients.length ? storedClients : groupClients(objectives);
  const current = stack[stack.length - 1];

  const visible = useMemo(() => {
    if (!current) return clients;
    if (current.level === 'cliente') {
      return monthly.filter((r) => r.level === 'objetivo' && (r.clientId || '_sin_cliente') === current.id);
    }
    if (current.level === 'objetivo') {
      const puestos = new Map<string, DayRow>();
      for (const d of days.filter((d) => d.objectiveId === current.id)) {
        const prev = puestos.get(d.puestoId);
        if (!prev) {
          puestos.set(d.puestoId, { ...d });
        } else {
          prev.slaActive += d.slaActive || 0;
          prev.slaInactive += d.slaInactive || 0;
          prev.slaClosed += d.slaClosed || 0;
          prev.slaWithoutPlan = (prev.slaWithoutPlan || 0) + (d.slaWithoutPlan || 0);
          prev.planPublished += d.planPublished || 0;
          prev.planDraft += d.planDraft || 0;
          prev.worked += d.worked || 0;
          prev.workedOutside = (prev.workedOutside || 0) + (d.workedOutside || 0);
          prev.covered += d.covered || 0;
          prev.uncovered += d.uncovered || 0;
          prev.ft += d.ft || 0;
          prev.ext += d.ext || 0;
          prev.adv += d.adv || 0;
          prev.novedadPaga += d.novedadPaga || 0;
          prev.licV = (prev.licV || 0) + (d.licV || 0);
          prev.licE = (prev.licE || 0) + (d.licE || 0);
          prev.licL = (prev.licL || 0) + (d.licL || 0);
          prev.licA = (prev.licA || 0) + (d.licA || 0);
          prev.licPG = (prev.licPG || 0) + (d.licPG || 0);
          prev.licSUS = (prev.licSUS || 0) + (d.licSUS || 0);
          prev.licSGS = (prev.licSGS || 0) + (d.licSGS || 0);
          prev.ausenciaHoras = (prev.ausenciaHoras || 0) + (d.ausenciaHoras || 0);
          prev.ausenciaTurnos = (prev.ausenciaTurnos || 0) + (d.ausenciaTurnos || 0);
          prev.uncoveredAusencia = (prev.uncoveredAusencia || 0) + (d.uncoveredAusencia || 0);
          prev.uncoveredRetiro = (prev.uncoveredRetiro || 0) + (d.uncoveredRetiro || 0);
          prev.uncoveredFaltaPlan = (prev.uncoveredFaltaPlan || 0) + (d.uncoveredFaltaPlan || 0);
        }
      }
      return [...puestos.values()];
    }
    return days.filter((d) => d.objectiveId === stack.find((s) => s.level === 'objetivo')?.id && d.puestoId === current.id);
  }, [clients, current, monthly, days, stack]);

  const openRow = async (row: any) => {
    if (!current) {
      setStack([{ level: 'cliente', id: row.clientId || '_sin_cliente', label: row.clientName || 'Sin cliente' }]);
      return;
    }
    if (current.level === 'cliente') {
      setStack([...stack, { level: 'objetivo', id: row.objectiveId, label: row.objectiveName }]);
      if (source === 'libro' && empresaId) {
        const snap = await getDocs(query(
          collection(db, 'hours_ledger'),
          where('empresaId', '==', empresaId),
          where('periodKey', '==', periodKey),
          where('objectiveId', '==', row.objectiveId),
        ));
        setDays(snap.docs.map((d) => d.data() as DayRow));
      }
      return;
    }
    if (current.level === 'objetivo') {
      setStack([...stack, { level: 'puesto', id: row.puestoId, label: row.puestoName }]);
    }
  };

  const exportExcel = () => {
    const sheet = monthly.filter((r) => r.level !== 'empresa').map((r) => ({
      Nivel: r.level,
      Cliente: r.clientName,
      Objetivo: r.objectiveName,
      'SLA activo': Math.round(r.slaActive || 0),
      'SLA inactivo': Math.round(r.slaInactive || 0),
      'SLA cerrado': Math.round(r.slaClosed || 0),
      'Sin plan': Math.round(r.slaWithoutPlan || 0),
      'Plan publicado': Math.round(r.planPublished || 0),
      'Plan borrador': Math.round(r.planDraft || 0),
      Trabajadas: Math.round(r.worked || 0),
      'Trabajadas fuera': Math.round(r.workedOutside || 0),
      Cubiertas: Math.round(r.covered || 0),
      Descubiertas: Math.round(r.uncovered || 0),
      FT: Math.round(r.ft || 0),
      EXT: Math.round(r.ext || 0),
      ADV: Math.round(r.adv || 0),
      'Descub. x ausencia': Math.round(r.uncoveredAusencia || 0),
      'Descub. x retiro': Math.round(r.uncoveredRetiro || 0),
      'Descub. x falta plan': Math.round(r.uncoveredFaltaPlan || 0),
      'Ausencias AA (hs)': Math.round(r.ausenciaHoras || 0),
      'Ausencias AA (turnos)': r.ausenciaTurnos || 0,
      'Ausencias AA (legajos)': r.ausenciaLegajos || 0,
      'Licencias (total)': Math.round(r.novedadPaga || 0),
      ...Object.fromEntries(HOURS_LEDGER_LIC_CODES.map(({ key, label }) => [`Lic. ${label}`, Math.round((r as any)[key] || 0)])),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), 'Banco');
    XLSX.writeFile(wb, `BancoHoras_${empresaId}_${periodKey}.xlsx`);
  };

  if (!loading && !allowed) {
    return (
      <DashboardLayout>
        <div className="p-8 text-slate-500">Tu rol no tiene el módulo Banco de Horas. Pedilo en Configuración → Roles.</div>
      </DashboardLayout>
    );
  }

  const cards = [
    ['SLA activo', empresa?.slaActive],
    ['SLA inactivo', empresa?.slaInactive],
    ['SLA cerrado', empresa?.slaClosed],
    ['Sin plan', empresa?.slaWithoutPlan],
    ['Plan', empresa ? planOf(planMode, empresa) : 0],
    ['Trabajadas', empresa?.worked],
    ['Trab. fuera', empresa?.workedOutside],
    ['Cubiertas', empresa?.covered],
    ['Descubiertas', empresa?.uncovered],
    ['FT', empresa?.ft],
    ['EXT', empresa?.ext],
    ['ADV', empresa?.adv],
  ] as const;

  const uncoveredCauseCards = [
    ['Descub. x ausencia', empresa?.uncoveredAusencia],
    ['Descub. x falta plan', empresa?.uncoveredFaltaPlan],
    ['Descub. x retiro', empresa?.uncoveredRetiro],
  ] as const;

  const licenciaCards = HOURS_LEDGER_LIC_CODES
    .map(({ key, label }) => [`Lic. ${label}`, (empresa as any)?.[key]] as const)
    .filter(([, v]) => Number(v) > 0);

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-black text-slate-800 flex items-center gap-2">
              <span className="p-2 rounded-2xl bg-indigo-100 text-indigo-600 shadow-sm"><Database size={18} /></span>
              Banco de Horas
            </h1>
            <p className="text-xs font-bold text-slate-500 mt-1">
              {source === 'preview' ? 'Vista previa, sin escribir' : source === 'libro' ? 'Libro guardado' : 'Todavía no hay libro de este mes'}
              {' · '}el plan oficial es el publicado
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input type="month" value={periodKey} onChange={(e) => {
              const [y, m] = e.target.value.split('-').map(Number);
              if (y && m) { setYear(y); setMonth(m); }
            }} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-bold shadow-sm" />
            <select value={planMode} onChange={(e) => setPlanMode(e.target.value as PlanMode)} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-bold shadow-sm">
              {HOURS_LEDGER_PLAN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {canRebuild && (
              <button type="button" onClick={() => void preview()} disabled={busy} className="rounded-2xl bg-indigo-600 text-white px-4 py-2 text-sm font-black shadow-sm hover:bg-indigo-700 disabled:opacity-50">
                <RefreshCw size={14} className="inline mr-1" /> Recalcular (vista previa)
              </button>
            )}
            {!!job?.failed?.length && (
              <button type="button" onClick={() => void retryFailed()} className="rounded-2xl border border-amber-300 bg-amber-50 text-amber-800 px-4 py-2 text-sm font-black shadow-sm">
                Reintentar lo fallido
              </button>
            )}
            <button type="button" onClick={exportExcel} disabled={!monthly.length} className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black shadow-sm hover:bg-slate-50 disabled:opacity-40">
              <Download size={14} className="inline mr-1" /> Excel
            </button>
          </div>
        </div>

        {job && (job.status === 'QUEUED' || job.status === 'RUNNING' || job.status === 'DONE' || job.status === 'ERROR') && (
          <div className="rounded-3xl bg-white shadow-sm border border-slate-100 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-black text-slate-600">
              <span>
                {job.status === 'QUEUED' || job.status === 'RUNNING' ? 'Calculando…' : job.status === 'ERROR' ? 'Terminó con errores' : 'Último recálculo'}
                {job.total ? ` · ${job.processed} de ${job.total} objetivos` : ''}
              </span>
              <span className="text-slate-400 font-bold">
                {job.createdBy || ''}{job.finishedAt ? ` · ${when(job.finishedAt)}` : ''}
              </span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-indigo-500 transition-all" style={{ width: `${job.total ? Math.round((100 * job.processed) / job.total) : (job.status === 'DONE' ? 100 : 8)}%` }} />
            </div>
            {(job.currentObjectiveName || job.error) && (
              <p className="mt-1 text-[11px] font-bold text-slate-400 truncate">{job.currentObjectiveName || job.error}</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {cards.map(([label, value]) => (
            <div key={label} className="rounded-3xl bg-white shadow-sm border border-slate-100 p-4">
              <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</div>
              <div className="text-2xl font-black text-slate-800 tabular-nums mt-1">{nf(Number(value) || 0)}</div>
            </div>
          ))}
          {uncoveredCauseCards.map(([label, value]) => (
            <div key={label} className="rounded-3xl bg-amber-50 shadow-sm border border-amber-100 p-4">
              <div className="text-[10px] font-black uppercase tracking-wide text-amber-500">{label}</div>
              <div className="text-2xl font-black text-amber-700 tabular-nums mt-1">{nf(Number(value) || 0)}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          <div className="rounded-3xl bg-indigo-50 shadow-sm border border-indigo-100 p-4">
            <div className="text-[10px] font-black uppercase tracking-wide text-indigo-500">Licencias</div>
            <div className="text-2xl font-black text-indigo-700 tabular-nums mt-1">{nf(Number(empresa?.novedadPaga) || 0)}</div>
          </div>
          {licenciaCards.map(([label, value]) => (
            <div key={label} className="rounded-3xl bg-white shadow-sm border border-slate-100 p-4">
              <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</div>
              <div className="text-2xl font-black text-slate-800 tabular-nums mt-1">{nf(Number(value) || 0)}</div>
            </div>
          ))}
          <div className="rounded-3xl bg-rose-50 shadow-sm border border-rose-100 p-4">
            <div className="text-[10px] font-black uppercase tracking-wide text-rose-500">Ausencias (AA)</div>
            <div className="text-2xl font-black text-rose-700 tabular-nums mt-1">{nf(Number(empresa?.ausenciaHoras) || 0)}</div>
            <div className="text-[10px] font-bold text-rose-400 mt-1">
              {nf(Number(empresa?.ausenciaTurnos) || 0)} turnos · {nf(Number(empresa?.ausenciaLegajos) || 0)} legajos
            </div>
          </div>
        </div>

        <div className="rounded-3xl bg-white shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2 text-xs font-black text-slate-500">
            <button type="button" className="hover:text-indigo-600" onClick={() => setStack([])}>Empresa</button>
            {stack.map((s, i) => (
              <span key={s.level + s.id} className="flex items-center gap-2">
                <ChevronRight size={12} />
                <button type="button" className="hover:text-indigo-600" onClick={() => setStack(stack.slice(0, i + 1))}>{s.label}</button>
              </span>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400">
                <tr>
                  {[
                    'Nombre', 'SLA', 'Inactivo', 'Cerrado', 'Sin plan', 'Plan', 'Trabajadas', 'Trab. fuera', 'Cubiertas', 'Descubiertas',
                    'x Ausencia', 'x Retiro', 'x Falta plan', 'FT', 'EXT', 'ADV',
                    'Lic. total', 'Lic. V', 'Lic. E', 'Lic. L', 'Lic. ART', 'Lic. PG', 'Lic. SUS', 'Lic. SGS',
                    'AA hs', 'AA turnos', 'AA legajos',
                  ].map((h) => (
                    <th key={h} className="text-right first:text-left px-3 py-2 font-black">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((r: any) => {
                  const name = r.date || r.puestoName || r.objectiveName || r.clientName || 'Sin cliente';
                  const clickable = !current || current.level === 'cliente' || current.level === 'objetivo';
                  return (
                    <tr key={r.id || `${name}-${r.objectiveId}-${r.puestoId || ''}`} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2 font-bold text-slate-700">
                        {clickable ? (
                          <button type="button" className="hover:text-indigo-600" onClick={() => void openRow(r)}>{name}</button>
                        ) : name}
                      </td>
                      {[
                        r.slaActive, r.slaInactive, r.slaClosed, r.slaWithoutPlan, planOf(planMode, r), r.worked, r.workedOutside, r.covered, r.uncovered,
                        r.uncoveredAusencia, r.uncoveredRetiro, r.uncoveredFaltaPlan, r.ft, r.ext, r.adv,
                        r.novedadPaga, r.licV, r.licE, r.licL, r.licA, r.licPG, r.licSUS, r.licSGS,
                        r.ausenciaHoras, r.ausenciaTurnos, r.ausenciaLegajos,
                      ].map((n, i) => (
                        <td key={i} className="px-3 py-2 text-right tabular-nums text-slate-600">{nf(n)}</td>
                      ))}
                    </tr>
                  );
                })}
                {!visible.length && (
                  <tr><td colSpan={27} className="px-4 py-8 text-center text-slate-400 font-bold">
                    {empresa
                      ? 'El libro tiene totales de empresa, pero no hay detalle para este nivel.'
                      : canRebuild
                        ? 'Sin filas. Usá Recalcular para calcular el mes sin guardar.'
                        : 'Sin filas. El libro de este mes todavía no fue calculado.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
