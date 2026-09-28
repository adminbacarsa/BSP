import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { ChevronRight, Database, Download, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { db } from '@/lib/firebase';
import {
  fetchHoursLedgerMonthly,
  HOURS_LEDGER_PLAN_OPTIONS,
  planHoursOf,
  previewHoursLedgerMonth,
  type HoursLedgerMonthRow,
  type HoursLedgerPlanMode,
} from '@/lib/hoursLedger/hoursLedgerRead';

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

  const periodKey = `${year}-${String(month).padStart(2, '0')}`;

  const loadStored = useCallback(async () => {
    if (!empresaId) return;
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
    }
  }, [empresaId, periodKey]);

  useEffect(() => { void loadStored(); }, [loadStored]);

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

  const empresa = monthly.find((r) => r.level === 'empresa');
  const clients = monthly.filter((r) => r.level === 'cliente');
  const current = stack[stack.length - 1];

  const visible = useMemo(() => {
    if (!current) return clients;
    if (current.level === 'cliente') {
      return monthly.filter((r) => r.level === 'objetivo' && r.clientId === current.id);
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
          prev.planPublished += d.planPublished || 0;
          prev.planDraft += d.planDraft || 0;
          prev.worked += d.worked || 0;
          prev.covered += d.covered || 0;
          prev.uncovered += d.uncovered || 0;
          prev.ft += d.ft || 0;
          prev.ext += d.ext || 0;
          prev.adv += d.adv || 0;
          prev.novedadPaga += d.novedadPaga || 0;
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
      'Plan publicado': Math.round(r.planPublished || 0),
      'Plan borrador': Math.round(r.planDraft || 0),
      Trabajadas: Math.round(r.worked || 0),
      Cubiertas: Math.round(r.covered || 0),
      Descubiertas: Math.round(r.uncovered || 0),
      FT: Math.round(r.ft || 0),
      EXT: Math.round(r.ext || 0),
      ADV: Math.round(r.adv || 0),
      'Novedad paga': Math.round(r.novedadPaga || 0),
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
    ['Plan', empresa ? planOf(planMode, empresa) : 0],
    ['Trabajadas', empresa?.worked],
    ['Cubiertas', empresa?.covered],
    ['Descubiertas', empresa?.uncovered],
    ['FT / EXT / ADV', (empresa?.ft || 0) + (empresa?.ext || 0) + (empresa?.adv || 0)],
    ['Novedades pagas', empresa?.novedadPaga],
  ] as const;

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
            <button type="button" onClick={exportExcel} disabled={!monthly.length} className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black shadow-sm hover:bg-slate-50 disabled:opacity-40">
              <Download size={14} className="inline mr-1" /> Excel
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {cards.map(([label, value]) => (
            <div key={label} className="rounded-3xl bg-white shadow-sm border border-slate-100 p-4">
              <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</div>
              <div className="text-2xl font-black text-slate-800 tabular-nums mt-1">{nf(Number(value) || 0)}</div>
            </div>
          ))}
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
                  {['Nombre', 'SLA', 'Inactivo', 'Cerrado', 'Plan', 'Trabajadas', 'Cubiertas', 'Descubiertas', 'FT', 'EXT', 'ADV', 'Nov. paga'].map((h) => (
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
                      {[r.slaActive, r.slaInactive, r.slaClosed, planOf(planMode, r), r.worked, r.covered, r.uncovered, r.ft, r.ext, r.adv, r.novedadPaga].map((n, i) => (
                        <td key={i} className="px-3 py-2 text-right tabular-nums text-slate-600">{nf(n)}</td>
                      ))}
                    </tr>
                  );
                })}
                {!visible.length && (
                  <tr><td colSpan={12} className="px-4 py-8 text-center text-slate-400 font-bold">
                    {canRebuild ? 'Sin filas. Usá Recalcular para calcular el mes sin guardar.' : 'Sin filas. El libro de este mes todavía no fue calculado.'}
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
