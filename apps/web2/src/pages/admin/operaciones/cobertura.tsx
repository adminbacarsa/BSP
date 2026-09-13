import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useEmpresa } from '@/context/EmpresaContext';
import { useAuth } from '@/context/AuthContext';
import { app, db } from '@/lib/firebase';
import { belongsToEmpresaView } from '@/lib/multiempresa';
import {
  buildCoverageChains,
  findOrphanCoverageHints,
  planningDeepLink,
  type CoverageChain,
  type CoverageChainRole,
} from '@/lib/operaciones/coverageAudit';
import {
  collection,
  getDocs,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';

const ROLE_LABEL: Record<CoverageChainRole, string> = {
  titular: 'Titular',
  vacancy: 'Vacante',
  coverer: 'Cubridor',
  other: 'Otro',
};

const ROLE_TONE: Record<CoverageChainRole, string> = {
  titular: 'bg-rose-50 border-rose-200 text-rose-900',
  vacancy: 'bg-amber-50 border-amber-200 text-amber-900',
  coverer: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  other: 'bg-slate-50 border-slate-200 text-slate-700',
};

function todayArIso(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Cordoba' });
}

function dayBoundsAr(dateStr: string): { start: Date; end: Date } {
  const start = new Date(`${dateStr}T00:00:00-03:00`);
  const end = new Date(`${dateStr}T23:59:59.999-03:00`);
  return { start, end };
}

function ChainCard({
  chain,
  dateStr,
  novedadMsg,
}: {
  chain: CoverageChain;
  dateStr: string;
  novedadMsg?: string | null;
}) {
  const [open, setOpen] = useState(true);
  const planHref = planningDeepLink({
    objectiveId: chain.objectiveId,
    clientId: chain.clientId,
    dateStr,
  });

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-slate-50/80 transition-colors"
      >
        <div className="mt-0.5 text-indigo-600">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-sm font-black text-slate-800 truncate">{chain.objectiveName}</span>
            {chain.coverageType && (
              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                {chain.coverageType}
              </span>
            )}
            {chain.resolvedBy && (
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {chain.resolvedBy}
              </span>
            )}
            {chain.incomplete && (
              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                Incompleta
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600">
            <span className="font-bold text-rose-700">{chain.titularName}</span>
            <span className="mx-1.5 text-slate-300">→</span>
            <span className="font-bold text-emerald-700">{chain.covererName}</span>
          </p>
          <p className="text-[10px] font-mono text-slate-400 mt-1 truncate">{chain.coverageEventId}</p>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
          <div className="flex flex-col gap-2">
            {chain.nodes.map((n, idx) => (
              <div key={n.id} className="flex items-stretch gap-2">
                <div className="flex flex-col items-center w-6 shrink-0">
                  <div className={`w-2.5 h-2.5 rounded-full mt-3 ${
                    n.role === 'titular' ? 'bg-rose-500'
                      : n.role === 'vacancy' ? 'bg-amber-500'
                        : n.role === 'coverer' ? 'bg-emerald-500' : 'bg-slate-400'
                  }`} />
                  {idx < chain.nodes.length - 1 && <div className="flex-1 w-px bg-slate-200 my-1" />}
                </div>
                <div className={`flex-1 rounded-xl border p-3 ${ROLE_TONE[n.role]}`}>
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-[10px] font-black uppercase tracking-wide">{ROLE_LABEL[n.role]}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white/70">{n.code}</span>
                    {n.isAbsent && (
                      <span className="text-[9px] font-black uppercase text-rose-700">Ausente</span>
                    )}
                  </div>
                  <p className="text-sm font-bold leading-tight">{n.employeeName}</p>
                  <p className="text-[11px] opacity-80 mt-0.5">
                    {n.positionName || n.objectiveName}
                    {n.origin !== '—' ? ` · ${n.origin}` : ''}
                  </p>
                  <p className="text-[10px] font-mono opacity-50 mt-1 truncate">{n.id}</p>
                </div>
              </div>
            ))}
          </div>

          {chain.missingRoles.length > 0 && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
              Faltan nodos: {chain.missingRoles.map((r) => ROLE_LABEL[r]).join(', ')}.
              Posible histórico pre-ledger o doc reescrito (RET/volante).
            </p>
          )}

          {novedadMsg && (
            <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2">
              <span className="font-black text-slate-500 uppercase text-[9px] mr-2">Novedad</span>
              {novedadMsg}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Link
              href={planHref}
              className="inline-flex items-center gap-1.5 text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-xl hover:bg-indigo-100"
            >
              <ExternalLink size={12} /> Abrir Planificación
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CoberturaAuditPage() {
  const router = useRouter();
  const { empresaId, empresa } = useEmpresa();
  const { isSuperAdmin } = useAuth();
  const migracionCompleta = !!(empresa as any)?.migracionCompleta;

  const [dateStr, setDateStr] = useState(todayArIso);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [shifts, setShifts] = useState<any[]>([]);
  const [novedadesByEvent, setNovedadesByEvent] = useState<Record<string, string>>({});
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [lastBackfill, setLastBackfill] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!empresaId || !dateStr) return;
    setLoading(true);
    try {
      const { start, end } = dayBoundsAr(dateStr);
      const turnosQ = query(
        collection(db, 'turnos'),
        where('empresaId', '==', empresaId),
        where('startTime', '>=', Timestamp.fromDate(start)),
        where('startTime', '<=', Timestamp.fromDate(end)),
      );
      const snap = await getDocs(turnosQ);
      const docs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((t) => belongsToEmpresaView(t, empresaId, migracionCompleta))
        .filter((t) => !t.draft && !t.isVirtual);

      setShifts(docs);

      const eventIds = new Set(
        docs.map((t) => String(t.coverageEventId || '').trim()).filter(Boolean),
      );
      const novMap: Record<string, string> = {};
      if (eventIds.size > 0) {
        const novQ = query(
          collection(db, 'novedades'),
          where('empresaId', '==', empresaId),
          where('type', '==', 'COBERTURA_RESUELTA'),
        );
        const novSnap = await getDocs(novQ);
        for (const d of novSnap.docs) {
          const n = d.data();
          const eid = String(n.coverageEventId || '').trim();
          if (!eid || !eventIds.has(eid)) continue;
          novMap[eid] = String(n.message || n.description || n.title || '');
        }
      }
      setNovedadesByEvent(novMap);
    } catch (e: any) {
      console.error('[cobertura-audit]', e);
      toast.error(e?.message || 'Error cargando coberturas');
      setShifts([]);
      setNovedadesByEvent({});
    } finally {
      setLoading(false);
    }
  }, [empresaId, dateStr, migracionCompleta]);

  useEffect(() => {
    void load();
  }, [load]);

  const chains = useMemo(() => buildCoverageChains(shifts), [shifts]);
  const orphans = useMemo(() => findOrphanCoverageHints(shifts), [shifts]);

  const filteredChains = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return chains;
    return chains.filter((c) =>
      c.titularName.toLowerCase().includes(q)
      || c.covererName.toLowerCase().includes(q)
      || c.objectiveName.toLowerCase().includes(q)
      || c.coverageEventId.toLowerCase().includes(q)
      || (c.coverageType || '').toLowerCase().includes(q),
    );
  }, [chains, filter]);

  const filteredOrphans = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return orphans;
    return orphans.filter((o) =>
      o.employeeName.toLowerCase().includes(q)
      || o.objectiveName.toLowerCase().includes(q)
      || o.hint.toLowerCase().includes(q),
    );
  }, [orphans, filter]);

  const runBackfill = async (dryRun: boolean) => {
    if (!empresaId) return;
    setBackfillBusy(true);
    try {
      const fn = httpsCallable(getFunctions(app, 'us-central1'), 'backfillCoverageLedger');
      const res = await fn({ empresaId, dateStr, dryRun });
      const data = res.data as {
        matched?: number;
        updated?: number;
        skipped?: number;
        dryRun?: boolean;
        samples?: string[];
      };
      const msg = dryRun
        ? `Dry-run: ${data.matched ?? 0} cadenas candidatas (${data.skipped ?? 0} omitidas)`
        : `Backfill: ${data.updated ?? 0} docs actualizados (${data.matched ?? 0} cadenas)`;
      setLastBackfill(msg);
      toast.success(msg);
      if (!dryRun) await load();
    } catch (e: any) {
      toast.error(e?.message || 'Backfill falló');
    } finally {
      setBackfillBusy(false);
    }
  };

  const dateLabel = (() => {
    try {
      const [y, m, d] = dateStr.split('-').map(Number);
      if (!y || !m || !d) return dateStr;
      return new Date(y, m - 1, d).toLocaleDateString('es-AR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  })();

  return (
    <DashboardLayout>
      <Head>
        <title>Auditoría de coberturas | COSP</title>
      </Head>
      <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <button
              type="button"
              onClick={() => router.push('/admin/operaciones')}
              className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-500 hover:text-indigo-600 mb-2"
            >
              <ArrowLeft size={12} /> Operaciones
            </button>
            <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
              <GitBranch className="text-indigo-600" size={22} />
              Auditoría de coberturas
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Cadena por <span className="font-mono text-xs">coverageEventId</span>: titular → vacante → cubridor.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Recargar
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 flex flex-wrap gap-3 items-end">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-black uppercase text-slate-400">Día (AR)</span>
            <input
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </label>
          <label className="flex flex-col gap-1 flex-1 min-w-[180px]">
            <span className="text-[10px] font-black uppercase text-slate-400">Buscar</span>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Apellido, objetivo, eventId…"
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>
          </label>
          <div className="text-xs text-slate-500 pb-2 capitalize">{dateLabel}</div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'Cadenas ledger', val: chains.length, tone: 'text-indigo-700 bg-indigo-50' },
            { label: 'Incompletas', val: chains.filter((c) => c.incomplete).length, tone: 'text-amber-700 bg-amber-50' },
            { label: 'Sin eventId', val: orphans.length, tone: 'text-rose-700 bg-rose-50' },
            { label: 'Turnos día', val: shifts.length, tone: 'text-slate-700 bg-slate-50' },
          ].map((k) => (
            <div key={k.label} className={`rounded-2xl border border-slate-100 p-3 ${k.tone}`}>
              <div className="text-lg font-black leading-none">{k.val}</div>
              <div className="text-[10px] font-bold uppercase mt-1 opacity-80">{k.label}</div>
            </div>
          ))}
        </div>

        {isSuperAdmin && (
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 flex flex-wrap items-center gap-3">
            <Sparkles size={16} className="text-indigo-600 shrink-0" />
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm font-bold text-indigo-900">Backfill (P2)</p>
              <p className="text-[11px] text-indigo-800/80">
                Une coberturas del día sin <span className="font-mono">coverageEventId</span> por heurística (causado/cubre).
              </p>
              {lastBackfill && <p className="text-[11px] font-mono text-indigo-700 mt-1">{lastBackfill}</p>}
            </div>
            <button
              type="button"
              disabled={backfillBusy || loading}
              onClick={() => void runBackfill(true)}
              className="px-3 py-2 rounded-xl bg-white border border-indigo-200 text-xs font-black text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
            >
              Dry-run
            </button>
            <button
              type="button"
              disabled={backfillBusy || loading}
              onClick={() => void runBackfill(false)}
              className="px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-black hover:bg-indigo-700 disabled:opacity-50"
            >
              {backfillBusy ? '…' : 'Aplicar'}
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
            <Loader2 className="animate-spin" size={18} /> Cargando…
          </div>
        ) : (
          <>
            <section className="space-y-3">
              <h2 className="text-xs font-black uppercase text-slate-500 tracking-wide">
                Con ledger ({filteredChains.length})
              </h2>
              {filteredChains.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
                  No hay turnos con coverageEventId en este día.
                </div>
              ) : (
                filteredChains.map((c) => (
                  <ChainCard
                    key={c.coverageEventId}
                    chain={c}
                    dateStr={dateStr}
                    novedadMsg={novedadesByEvent[c.coverageEventId]}
                  />
                ))
              )}
            </section>

            {filteredOrphans.length > 0 && (
              <section className="space-y-3 pt-2">
                <h2 className="text-xs font-black uppercase text-amber-700 tracking-wide">
                  Sin ledger — candidatos a backfill ({filteredOrphans.length})
                </h2>
                <div className="rounded-2xl border border-amber-100 bg-amber-50/40 divide-y divide-amber-100 overflow-hidden">
                  {filteredOrphans.map((o) => (
                    <div key={o.id} className="px-4 py-3 flex flex-wrap gap-2 items-baseline">
                      <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-200/80 text-amber-900">
                        {o.kind.replace(/_/g, ' ')}
                      </span>
                      <span className="text-sm font-bold text-slate-800">{o.employeeName}</span>
                      <span className="text-[11px] text-slate-500">{o.objectiveName} · {o.code}</span>
                      <span className="text-[11px] text-amber-900/80 w-full sm:w-auto">{o.hint}</span>
                      <span className="text-[10px] font-mono text-slate-400 w-full">{o.id}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
