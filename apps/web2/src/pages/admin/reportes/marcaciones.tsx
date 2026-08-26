import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { PageShell, PageHeader, ContentCard, MetricCard } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { slaService } from '@/services/slaService';
import {
  ccostoMappingService,
  type CcostoCatalogItem,
} from '@/services/ccostoMappingService';
import { getAuth } from 'firebase/auth';
import { mergeCcCatalog, parseMarcacionesExcelCcCatalog, parseMarcacionesExcelRows, detectMarcacionesMonth } from '@/lib/marcaciones/parseMarcacionesExcel';
import { runMarcacionesImport, type ImportMarcacionReport, IMPORT_SKIP_LABELS, exportImportDetailsCsv, type ImportSkipReason } from '@/lib/marcaciones/importMarcacionesRunner';
import { toast } from 'sonner';
import {
  ArrowLeft, Upload, Link2, Unlink, Search, CheckCircle2,
  AlertCircle, Loader2, Building2, MapPin, Filter, Play, FileSpreadsheet, Download,
} from 'lucide-react';

type ObjectiveOption = {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
};

type CcFilter = 'all' | 'pending' | 'linked';

function norm(s: string) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function ccHint(cc: string) {
  return norm(String(cc || '').replace(/^SP\s*-\s*/i, '').replace(/^BACAR SA\s*-\s*/i, ''));
}

function suggestScore(cc: string, objectiveName: string, clientName: string) {
  const hint = ccHint(cc);
  const target = norm(`${clientName} ${objectiveName}`);
  if (!hint || !target) return 0;
  if (target.includes(hint) || hint.includes(target)) return 95;
  const tokens = hint.split(/\s+/).filter(t => t.length > 2);
  let hits = 0;
  for (const t of tokens) if (target.includes(t)) hits += 1;
  return Math.min(90, hits * 18);
}

function flattenObjectives(clients: Array<{ id: string; name: string; objectives?: any[] }>): ObjectiveOption[] {
  const rows: ObjectiveOption[] = [];
  for (const client of clients) {
    const st = String((client as any).status || 'ACTIVE').toUpperCase();
    if (st === 'INACTIVE') continue;
    for (const obj of client.objectives || []) {
      if (!obj || obj.status === 'INACTIVE') continue;
      const id = String(obj.id ?? obj.objectiveId ?? '').trim();
      if (!id) continue;
      rows.push({
        id,
        name: String(obj.name ?? obj.nombre ?? 'Sin nombre'),
        clientId: client.id,
        clientName: client.name,
      });
    }
  }
  return rows.sort((a, b) =>
    a.clientName.localeCompare(b.clientName, 'es') || a.name.localeCompare(b.name, 'es'),
  );
}

export default function MarcacionesCcMappingPage() {
  const { canReadModule } = useAuth();
  const { empresaId, empresa } = useEmpresa();
  const fileRef = useRef<HTMLInputElement>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<CcostoCatalogItem[]>([]);
  const [sourceFile, setSourceFile] = useState('');
  const [objectives, setObjectives] = useState<ObjectiveOption[]>([]);

  const [selectedCc, setSelectedCc] = useState<string | null>(null);
  const [selectedObjectiveId, setSelectedObjectiveId] = useState('');
  const [ccFilter, setCcFilter] = useState<CcFilter>('pending');
  const [ccSearch, setCcSearch] = useState('');
  const [objSearch, setObjSearch] = useState('');
  const [clientFilter, setClientFilter] = useState('');

  const [recentLinks, setRecentLinks] = useState<Array<{ ccosto: string; objectiveName: string; clientName: string; at: string }>>([]);

  const [importRows, setImportRows] = useState<ReturnType<typeof parseMarcacionesExcelRows>>([]);
  const [importFileName, setImportFileName] = useState('');
  const [importReport, setImportReport] = useState<ImportMarcacionReport | null>(null);
  const [importRunning, setImportRunning] = useState(false);
  const [importProgress, setImportProgress] = useState({ label: '', pct: 0 });
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [importDetailFilter, setImportDetailFilter] = useState<string>('all');

  const migracionCompleta = (empresa as { migracionCompleta?: boolean })?.migracionCompleta === true;
  const canEdit = canReadModule('REPORTS');

  const loadAll = useCallback(async () => {
    if (!empresaId) return;
    setLoading(true);
    try {
      const [clients, mapping] = await Promise.all([
        slaService.getClients({ empresaId, scopeEmpresa: true }),
        ccostoMappingService.get(empresaId),
      ]);
      setObjectives(flattenObjectives(clients));
      if (mapping?.items?.length) {
        setItems(mapping.items);
        setSourceFile(mapping.sourceFile || '');
        setRecentLinks(
          mapping.items
            .filter(i => i.objectiveId && i.objectiveName)
            .slice(0, 5)
            .map(i => ({
              ccosto: i.ccosto,
              objectiveName: i.objectiveName || '',
              clientName: i.clientName || '',
              at: i.linkedAt || '',
            })),
        );
      } else {
        setItems([]);
        setSourceFile('');
      }
    } catch (e) {
      console.error(e);
      toast.error('No se pudo cargar el catálogo de centros de costo');
    } finally {
      setLoading(false);
    }
  }, [empresaId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const linkedCount = useMemo(() => items.filter(i => i.objectiveId).length, [items]);
  const pendingCount = items.length - linkedCount;

  const filteredImportDetails = useMemo(() => {
    if (!importReport?.skippedDetails?.length) return [];
    if (importDetailFilter === 'all') return importReport.skippedDetails;
    return importReport.skippedDetails.filter(d => d.reason === importDetailFilter);
  }, [importReport, importDetailFilter]);

  const downloadImportDetailsCsv = () => {
    if (!importReport?.skippedDetails?.length) return;
    const rows = importDetailFilter === 'all'
      ? importReport.skippedDetails
      : importReport.skippedDetails.filter(d => d.reason === importDetailFilter);
    const blob = new Blob([exportImportDetailsCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `marcaciones-omitidas-${importDetailFilter}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`CSV exportado (${rows.length.toLocaleString('es-AR')} filas)`);
  };

  const clientOptions = useMemo(() => {
    const map = new Map<string, string>();
    objectives.forEach(o => map.set(o.clientId, o.clientName));
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [objectives]);

  const filteredCc = useMemo(() => {
    let list = items;
    if (ccFilter === 'pending') list = list.filter(i => !i.objectiveId);
    else if (ccFilter === 'linked') list = list.filter(i => !!i.objectiveId);
    const q = norm(ccSearch);
    if (q) list = list.filter(i => norm(i.ccosto).includes(q));
    return list;
  }, [items, ccFilter, ccSearch]);

  useEffect(() => {
    if (!selectedCc || ccFilter === 'linked') return;
    const stillVisible = filteredCc.some(i => i.ccosto === selectedCc);
    if (!stillVisible) {
      setSelectedCc(filteredCc[0]?.ccosto ?? null);
      setSelectedObjectiveId('');
    }
  }, [filteredCc, selectedCc, ccFilter]);

  const filteredObjectives = useMemo(() => {
    let list = objectives;
    if (clientFilter) list = list.filter(o => o.clientId === clientFilter);
    const q = norm(objSearch);
    if (q) {
      list = list.filter(o =>
        norm(o.name).includes(q) || norm(o.clientName).includes(q),
      );
    }
    if (selectedCc) {
      list = [...list].sort((a, b) =>
        suggestScore(selectedCc, b.name, b.clientName) - suggestScore(selectedCc, a.name, a.clientName),
      );
    }
    return list;
  }, [objectives, clientFilter, objSearch, selectedCc]);

  const selectedCcItem = items.find(i => i.ccosto === selectedCc) ?? null;
  const selectedObjective = objectives.find(o => o.id === selectedObjectiveId) ?? null;

  const persist = async (
    nextItems: CcostoCatalogItem[],
    nextSource?: string,
    opts?: { successMessage?: string; silent?: boolean },
  ): Promise<boolean> => {
    if (!empresaId) {
      toast.error('No hay empresa activa en sesión');
      return false;
    }
    if (!canEdit) {
      toast.error('Sin permiso de edición en Reportes — no se puede guardar el vínculo');
      return false;
    }
    setSaving(true);
    try {
      await ccostoMappingService.save(empresaId, nextItems, {
        sourceFile: nextSource ?? (sourceFile || undefined),
      });
      setItems(nextItems);
      if (nextSource !== undefined) setSourceFile(nextSource);
      if (!opts?.silent) {
        toast.success(opts?.successMessage || 'Catálogo guardado');
      }
      return true;
    } catch (e) {
      console.error(e);
      toast.error('Error al guardar el mapeo en Firestore');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseMarcacionesExcelCcCatalog(buffer);
      if (!parsed.length) {
        toast.error('No se encontraron centros de costo en el Excel');
        return;
      }
      const merged = mergeCcCatalog(
        items.map(i => ({ ccosto: i.ccosto, count: i.count })),
        parsed,
      );
      const prevByCc = new Map(items.map(i => [i.ccosto, i]));
      const nextItems: CcostoCatalogItem[] = merged.map(row => {
        const prev = prevByCc.get(row.ccosto);
        return prev
          ? { ...prev, count: row.count }
          : { ccosto: row.ccosto, count: row.count };
      });
      await persist(nextItems, file.name);
      toast.success(`${parsed.length} centros de costo cargados desde Excel`);
    } catch (e) {
      console.error(e);
      toast.error('No se pudo leer el archivo Excel');
    }
  };

  const handleLink = async (ccosto: string, objective: ObjectiveOption): Promise<boolean> => {
    if (!ccosto || !objective) return false;
    const actor = getAuth().currentUser?.displayName
      || getAuth().currentUser?.email?.split('@')[0]
      || 'admin';
    const next = items.map(item => {
      if (item.ccosto !== ccosto) return item;
      return {
        ...item,
        objectiveId: objective.id,
        clientId: objective.clientId,
        objectiveName: objective.name,
        clientName: objective.clientName,
        linkedAt: new Date().toISOString(),
        linkedBy: actor,
      };
    });
    const ok = await persist(next, undefined, {
      successMessage: `Vinculado: ${ccosto} → ${objective.clientName} / ${objective.name}`,
    });
    if (ok) {
      setRecentLinks(prev => [
        { ccosto, objectiveName: objective.name, clientName: objective.clientName, at: new Date().toISOString() },
        ...prev.filter(r => r.ccosto !== ccosto).slice(0, 9),
      ]);
      const pending = items.filter(i => i.ccosto !== ccosto && !i.objectiveId);
      const nextPending = pending[0]?.ccosto ?? null;
      if (nextPending) {
        setSelectedCc(nextPending);
        setSelectedObjectiveId('');
      }
    }
    return ok;
  };

  const handleObjectivePick = async (obj: ObjectiveOption) => {
    setSelectedObjectiveId(obj.id);
    if (!selectedCc) {
      toast.info('Primero elegí un centro de costo en el panel izquierdo');
      return;
    }
    if (selectedCcItem?.objectiveId === obj.id) {
      toast.info('Este CC ya está vinculado a ese objetivo');
      return;
    }
    await handleLink(selectedCc, obj);
  };

  const confirmLinkSelection = async () => {
    if (!selectedCc || !selectedObjective) {
      toast.warning('Elegí un CC (izquierda) y un objetivo (derecha)');
      return;
    }
    await handleLink(selectedCc, selectedObjective);
  };

  const handleImportFileSelect = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const rows = parseMarcacionesExcelRows(buffer);
      if (!rows.length) {
        toast.error('No se encontraron marcaciones válidas en el Excel');
        return;
      }
      setImportRows(rows);
      setImportFileName(file.name);
      setImportReport(null);
      const month = detectMarcacionesMonth(rows);
      toast.success(`${rows.length.toLocaleString('es-AR')} marcaciones listas${month ? ` (${String(month.month).padStart(2, '0')}/${month.year})` : ''}`);
    } catch (e) {
      console.error(e);
      toast.error('No se pudo leer el Excel de marcaciones');
    }
  };

  const executeImport = async (dryRun: boolean) => {
    if (!empresaId || !importRows.length) {
      toast.warning('Subí primero el Excel de marcaciones');
      return;
    }
    if (linkedCount === 0) {
      toast.warning('Vinculá al menos un centro de costo antes de importar');
      return;
    }
    if (!dryRun && !confirm(
      importReport?.summary.toApply
        ? `¿Aplicar ${importReport.summary.toApply.toLocaleString('es-AR')} fichadas sobre turnos planificados?\n\nEsta acción escribe en Firestore.`
        : `¿Importar hasta ${importRows.length.toLocaleString('es-AR')} marcaciones del Excel?\n\nPrimero se emparejan con turnos; solo las que coincidan se graban.`,
    )) {
      return;
    }
    setImportRunning(true);
    setImportProgress({ label: 'Iniciando…', pct: 0 });
    try {
      const report = await runMarcacionesImport({
        rows: importRows,
        mappingItems: items,
        empresaId,
        migracionCompleta,
        dryRun,
        overwriteExisting,
        onProgress: (label, pct) => setImportProgress({ label, pct }),
      });
      setImportReport(report);
      setImportDetailFilter('all');
      if (dryRun) {
        toast.info(`Simulación: ${report.summary.toApply.toLocaleString('es-AR')} fichadas aplicables`);
      } else {
        toast.success(`${report.summary.applied.toLocaleString('es-AR')} fichadas importadas`);
      }
    } catch (e) {
      console.error(e);
      toast.error('Error en la importación');
    } finally {
      setImportRunning(false);
    }
  };

  const handleUnlink = async (ccosto: string) => {
    if (!canEdit) return;
    const next = items.map(item => {
      if (item.ccosto !== ccosto) return item;
      return { ccosto: item.ccosto, count: item.count };
    });
    const ok = await persist(next, undefined, { successMessage: 'Vínculo eliminado' });
    if (ok) {
      setRecentLinks(prev => prev.filter(r => r.ccosto !== ccosto));
      if (selectedCc === ccosto) setSelectedObjectiveId('');
    }
  };

  if (!canReadModule('REPORTS')) {
    return (
      <DashboardLayout>
        <PageShell>
          <ContentCard className="p-8 text-center">
            <p className="text-sm font-bold text-slate-500">Sin permiso para acceder a Reportes.</p>
          </ContentCard>
        </PageShell>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <Head>
        <title>Marcaciones — Mapeo CC | COSP</title>
      </Head>
      <PageShell className={selectedCc && items.length > 0 ? 'pb-28' : ''}>
        <PageHeader
          title="Importación de Marcaciones"
          subtitle="Vinculá centros de costo del Excel con objetivos del CRM antes de importar fichadas reales."
          icon={Link2}
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/admin/reportes"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-slate-200 bg-white text-xs font-black uppercase tracking-wide text-slate-600 hover:bg-slate-50 shadow-sm"
              >
                <ArrowLeft size={14} /> Reportes
              </Link>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) handleFileUpload(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                disabled={!canEdit || saving}
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-indigo-600 text-white text-xs font-black uppercase tracking-wide hover:bg-indigo-700 shadow-lg active:scale-95 disabled:opacity-50"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                Cargar Excel
              </button>
            </div>
          )}
        />

        {sourceFile && (
          <p className="text-xs font-medium text-slate-500 mb-4 -mt-4">
            Archivo fuente: <span className="font-bold text-slate-700">{sourceFile}</span>
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <MetricCard title="Centros de costo" value={items.length} icon={MapPin} color="#6366f1" />
          <MetricCard title="Vinculados" value={linkedCount} icon={CheckCircle2} color="#10b981" subtext={items.length ? `${Math.round((linkedCount / items.length) * 100)}% del catálogo` : undefined} />
          <MetricCard title="Pendientes" value={pendingCount} icon={AlertCircle} color="#f59e0b" alert={pendingCount > 0} />
        </div>

        {items.length > 0 && (
          <ContentCard className="mb-6 p-4 bg-indigo-50 border-indigo-200">
            <p className="text-sm font-black text-indigo-900">Cómo vincular</p>
            <p className="text-xs text-indigo-800 mt-1">
              Por defecto solo ves <strong>pendientes</strong> (sin vincular). Al guardar, el CC desaparece de la lista.
              Revisá los ya hechos en la pestaña <strong>OK</strong>.
            </p>
          </ContentCard>
        )}

        {recentLinks.length > 0 && (
          <ContentCard className="mb-6 p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Últimos vínculos guardados</p>
            <ul className="space-y-1">
              {recentLinks.slice(0, 5).map(r => (
                <li key={`${r.ccosto}-${r.at}`} className="text-xs font-medium text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 size={12} className="shrink-0" />
                  <span className="truncate"><strong>{r.ccosto}</strong> → {r.clientName} / {r.objectiveName}</span>
                </li>
              ))}
            </ul>
          </ContentCard>
        )}

        {loading ? (
          <ContentCard className="p-12 flex items-center justify-center gap-3">
            <Loader2 className="animate-spin text-indigo-500" size={24} />
            <span className="text-sm font-bold text-slate-500">Cargando catálogo…</span>
          </ContentCard>
        ) : items.length === 0 ? (
          <ContentCard className="p-10 text-center space-y-4">
            <Upload size={40} className="mx-auto text-indigo-400" />
            <p className="text-sm font-bold text-slate-600">
              Subí el Excel de marcaciones para listar los centros de costo y emparejarlos con objetivos.
            </p>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-indigo-600 text-white text-xs font-black uppercase tracking-wide hover:bg-indigo-700 shadow-lg"
            >
              <Upload size={14} /> Seleccionar Excel
            </button>
          </ContentCard>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <ContentCard className="p-0 overflow-hidden flex flex-col min-h-[520px]">
              <div className="p-4 border-b border-slate-100 bg-slate-50/80 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-xs font-black uppercase tracking-widest text-slate-700">Centros de costo</h2>
                  <div className="flex gap-1 flex-wrap justify-end">
                    {([
                      { id: 'pending' as CcFilter, label: `Pendientes (${pendingCount})` },
                      { id: 'linked' as CcFilter, label: `OK (${linkedCount})` },
                      { id: 'all' as CcFilter, label: `Todos (${items.length})` },
                    ]).map(({ id, label }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setCcFilter(id)}
                        className={`px-2.5 py-1 rounded-xl text-[10px] font-black uppercase ${ccFilter === id ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-500'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={ccSearch}
                    onChange={e => setCcSearch(e.target.value)}
                    placeholder="Buscar CC…"
                    className="w-full pl-9 pr-3 py-2.5 rounded-2xl border border-slate-200 text-sm font-medium bg-white"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                {filteredCc.length === 0 ? (
                  <div className="p-8 text-center">
                    {ccFilter === 'pending' ? (
                      <>
                        <CheckCircle2 size={32} className="mx-auto text-emerald-500 mb-2" />
                        <p className="text-sm font-black text-emerald-800">¡Todos los CC están vinculados!</p>
                        <p className="text-xs text-slate-500 mt-1">Usá la pestaña OK para revisar o corregir.</p>
                      </>
                    ) : (
                      <p className="text-sm font-bold text-slate-500">Sin resultados en este filtro.</p>
                    )}
                  </div>
                ) : filteredCc.map(item => {
                  const active = selectedCc === item.ccosto;
                  const linked = !!item.objectiveId;
                  return (
                    <button
                      key={item.ccosto}
                      type="button"
                      onClick={() => {
                        setSelectedCc(item.ccosto);
                        if (item.objectiveId) setSelectedObjectiveId(item.objectiveId);
                        else setSelectedObjectiveId('');
                      }}
                      className={`w-full text-left px-4 py-3 transition-colors hover:bg-indigo-50/60 ${active ? 'bg-indigo-50 border-l-4 border-indigo-500' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-800 truncate">{item.ccosto}</p>
                          {linked ? (
                            <p className="text-[11px] text-emerald-700 font-medium truncate mt-0.5">
                              → {item.clientName} / {item.objectiveName}
                            </p>
                          ) : (
                            <p className="text-[11px] text-amber-600 font-medium mt-0.5">Sin vincular</p>
                          )}
                        </div>
                        <div className="shrink-0 flex flex-col items-end gap-1">
                          <span className="text-[10px] font-black text-slate-400">{item.count} marc.</span>
                          {linked ? (
                            <CheckCircle2 size={14} className="text-emerald-500" />
                          ) : (
                            <AlertCircle size={14} className="text-amber-500" />
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </ContentCard>

            <ContentCard className="p-0 overflow-hidden flex flex-col min-h-[520px]">
              <div className="p-4 border-b border-slate-100 bg-slate-50/80 space-y-3">
                <h2 className="text-xs font-black uppercase tracking-widest text-slate-700">Objetivos CRM</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="relative">
                    <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <select
                      value={clientFilter}
                      onChange={e => setClientFilter(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 rounded-2xl border border-slate-200 text-xs font-bold bg-white appearance-none"
                    >
                      <option value="">Todos los clientes</option>
                      {clientOptions.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={objSearch}
                      onChange={e => setObjSearch(e.target.value)}
                      placeholder="Buscar objetivo…"
                      className="w-full pl-9 pr-3 py-2.5 rounded-2xl border border-slate-200 text-sm font-medium bg-white"
                    />
                  </div>
                </div>
                {selectedCc && (
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 space-y-2">
                    <p className="text-[11px] font-medium text-indigo-800">
                      CC activo: <strong>{selectedCc}</strong>
                      {selectedCcItem?.objectiveName
                        ? ` — vinculado a ${selectedCcItem.clientName} / ${selectedCcItem.objectiveName}`
                        : ' — elegí un objetivo (se guarda al hacer click)'}
                    </p>
                    {selectedCc && selectedObjective && !selectedCcItem?.objectiveId && (
                      <button
                        type="button"
                        disabled={!canEdit || saving}
                        onClick={confirmLinkSelection}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-wide hover:bg-emerald-700 shadow-md disabled:opacity-40"
                      >
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
                        Vincular aquí
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                {filteredObjectives.slice(0, 200).map(obj => {
                  const active = selectedObjectiveId === obj.id;
                  const score = selectedCc ? suggestScore(selectedCc, obj.name, obj.clientName) : 0;
                  return (
                    <button
                      key={obj.id}
                      type="button"
                      disabled={saving}
                      onClick={() => handleObjectivePick(obj)}
                      className={`w-full text-left px-4 py-3 transition-colors hover:bg-emerald-50/60 ${active ? 'bg-emerald-50 border-l-4 border-emerald-500' : ''} ${saving ? 'opacity-60' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[10px] font-black uppercase text-slate-400 truncate">{obj.clientName}</p>
                          <p className="text-sm font-bold text-slate-800 truncate">{obj.name}</p>
                        </div>
                        {selectedCc && score >= 36 && (
                          <span className="shrink-0 text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                            ~{score}%
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
                {filteredObjectives.length > 200 && (
                  <p className="p-3 text-[11px] text-slate-500 text-center">
                    Mostrando 200 de {filteredObjectives.length}. Refiná la búsqueda.
                  </p>
                )}
              </div>
            </ContentCard>
          </div>
        )}

        {selectedCc && items.length > 0 && (
          <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-md shadow-lg px-4 py-3 lg:pl-72">
            <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Vinculación</p>
                <p className="text-sm font-bold text-slate-800 truncate">{selectedCc}</p>
                {selectedObjective ? (
                  <p className="text-xs text-emerald-700 font-medium truncate">
                    → {selectedObjective.clientName} / {selectedObjective.name}
                  </p>
                ) : (
                  <p className="text-xs text-amber-600 font-medium">Elegí un objetivo en el panel derecho</p>
                )}
              </div>
              <button
                type="button"
                disabled={!canEdit || !selectedObjective || saving}
                onClick={confirmLinkSelection}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-emerald-600 text-white text-xs font-black uppercase tracking-wide hover:bg-emerald-700 shadow-lg disabled:opacity-40 active:scale-95 shrink-0"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
                Vincular y guardar
              </button>
              {selectedCcItem?.objectiveId && (
                <button
                  type="button"
                  disabled={!canEdit || saving}
                  onClick={() => handleUnlink(selectedCcItem.ccosto)}
                  className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl border border-rose-200 text-rose-700 text-xs font-black uppercase shrink-0 hover:bg-rose-50 disabled:opacity-40"
                >
                  <Unlink size={14} /> Desvincular
                </button>
              )}
            </div>
          </div>
        )}

        {items.length > 0 && pendingCount > 0 && (
          <ContentCard className="mt-6 p-4 flex items-start gap-3 bg-amber-50 border-amber-200">
            <Filter size={18} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-black text-amber-900">Faltan {pendingCount} centros de costo por vincular</p>
              <p className="text-xs text-amber-800 mt-1">
                Podés importar igual: las filas con CC sin mapeo se omiten. Completá el catálogo para maximizar cobertura.
              </p>
            </div>
          </ContentCard>
        )}

        {linkedCount > 0 && (
          <ContentCard className="mt-8 p-6 border-2 border-emerald-200 bg-gradient-to-br from-white to-emerald-50/40 shadow-lg rounded-3xl">
            <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Paso 2</p>
                <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
                  <FileSpreadsheet size={20} className="text-emerald-600" />
                  Importar fichadas reales
                </h2>
                <p className="text-xs text-slate-600 mt-1 max-w-xl">
                  Subí el mismo Excel de marcaciones. El sistema empareja por <strong>DNI + CC + fecha</strong> contra turnos planificados
                  y aplica ingreso/egreso como Centro de Control ({linkedCount} CC mapeados).
                </p>
              </div>
              <input
                ref={importFileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) handleImportFileSelect(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                disabled={!canEdit || importRunning}
                onClick={() => importFileRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-emerald-600 text-white text-xs font-black uppercase tracking-wide hover:bg-emerald-700 shadow-lg disabled:opacity-50"
              >
                <Upload size={14} /> Excel marcaciones
              </button>
            </div>

            {importFileName && (
              <p className="text-xs font-medium text-slate-600 mb-3">
                Archivo: <strong>{importFileName}</strong>
                {importRows.length > 0 && ` · ${importRows.length.toLocaleString('es-AR')} filas válidas`}
              </p>
            )}

            <label className="flex items-center gap-2 text-xs font-bold text-slate-600 mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={overwriteExisting}
                onChange={e => setOverwriteExisting(e.target.checked)}
                className="rounded border-slate-300"
              />
              Sobrescribir turnos que ya tienen fichada
            </label>

            <div className="flex flex-wrap gap-2 mb-4">
              <button
                type="button"
                disabled={!canEdit || !importRows.length || importRunning}
                onClick={() => executeImport(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-indigo-200 bg-white text-indigo-700 text-xs font-black uppercase hover:bg-indigo-50 disabled:opacity-40"
              >
                {importRunning ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                Simular
              </button>
              <button
                type="button"
                disabled={!canEdit || !importRows.length || importRunning}
                onClick={() => executeImport(false)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-indigo-600 text-white text-xs font-black uppercase hover:bg-indigo-700 shadow-lg disabled:opacity-40"
              >
                {importRunning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                Aplicar fichadas
              </button>
            </div>

            {importRunning && (
              <div className="mb-4">
                <div className="flex justify-between text-[10px] font-black uppercase text-slate-500 mb-1">
                  <span>{importProgress.label}</span>
                  <span>{importProgress.pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                  <div className="h-full bg-indigo-500 transition-all" style={{ width: `${importProgress.pct}%` }} />
                </div>
              </div>
            )}

            {importReport && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <div className="rounded-2xl bg-white border border-slate-200 p-3">
                  <p className="text-[9px] font-black uppercase text-slate-400">Total Excel</p>
                  <p className="text-xl font-black text-slate-800">{importReport.summary.totalRows.toLocaleString('es-AR')}</p>
                </div>
                <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3">
                  <p className="text-[9px] font-black uppercase text-emerald-700">Aplicables</p>
                  <p className="text-xl font-black text-emerald-800">{importReport.summary.toApply.toLocaleString('es-AR')}</p>
                </div>
                <div className="rounded-2xl bg-indigo-50 border border-indigo-200 p-3">
                  <p className="text-[9px] font-black uppercase text-indigo-700">Importadas</p>
                  <p className="text-xl font-black text-indigo-800">{importReport.summary.applied.toLocaleString('es-AR')}</p>
                </div>
                <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3">
                  <p className="text-[9px] font-black uppercase text-amber-700">Omitidas</p>
                  <p className="text-xl font-black text-amber-800">{importReport.summary.skipped.toLocaleString('es-AR')}</p>
                </div>
              </div>
            )}

            {importReport && (
              <div className="space-y-4 text-xs">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="font-black uppercase text-slate-500 mb-3">Motivos omitidos (detalle)</p>
                    <ul className="space-y-2 text-slate-700">
                      {(Object.keys(IMPORT_SKIP_LABELS) as ImportSkipReason[]).map(key => {
                        const n = importReport.summary.byReason[key] || 0;
                        if (!n) return null;
                        return (
                          <li key={key} className="flex justify-between gap-2 border-b border-slate-100 pb-1">
                            <span>{IMPORT_SKIP_LABELS[key]}</span>
                            <span className="font-black text-slate-900">{n.toLocaleString('es-AR')}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  {importReport.byObjectiveIssue.length > 0 && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 overflow-auto max-h-64">
                      <p className="font-black uppercase text-slate-500 mb-3">Por objetivo (planificación)</p>
                      <table className="w-full text-left">
                        <thead>
                          <tr className="text-[10px] uppercase text-slate-400">
                            <th className="pb-2 pr-2">Objetivo</th>
                            <th className="pb-2 px-1 text-right">Sin crono.</th>
                            <th className="pb-2 px-1 text-right">Sin celda</th>
                            <th className="pb-2 pl-1 text-right">Otro obj.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importReport.byObjectiveIssue.slice(0, 15).map(row => (
                            <tr key={row.objectiveId} className="border-t border-slate-100">
                              <td className="py-1.5 pr-2">
                                <p className="font-bold text-slate-800 truncate">{row.objectiveName}</p>
                                <p className="text-[10px] text-slate-400 truncate">{row.clientName}</p>
                              </td>
                              <td className="py-1.5 px-1 text-right font-black text-rose-600">{row.cronograma_no_publicado || '—'}</td>
                              <td className="py-1.5 px-1 text-right font-black text-amber-600">{row.sin_celda_planificada || '—'}</td>
                              <td className="py-1.5 pl-1 text-right font-black text-indigo-600">{row.turno_otro_objetivo || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <p className="font-black uppercase text-slate-500">
                      Detalle omitidos ({filteredImportDetails.length.toLocaleString('es-AR')})
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={importDetailFilter}
                        onChange={e => setImportDetailFilter(e.target.value)}
                        className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold bg-slate-50"
                      >
                        <option value="all">Todos los motivos</option>
                        {(Object.keys(IMPORT_SKIP_LABELS) as ImportSkipReason[]).map(key => (
                          <option key={key} value={key}>
                            {IMPORT_SKIP_LABELS[key]} ({importReport.summary.byReason[key] || 0})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={downloadImportDetailsCsv}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 font-black uppercase text-[10px] hover:bg-slate-50"
                      >
                        <Download size={12} /> Exportar CSV
                      </button>
                    </div>
                  </div>
                  <div className="overflow-auto max-h-80 rounded-xl border border-slate-100">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 sticky top-0">
                        <tr className="text-[10px] uppercase text-slate-400">
                          <th className="p-2">Fecha</th>
                          <th className="p-2">DNI</th>
                          <th className="p-2">CCosto</th>
                          <th className="p-2">Objetivo mapeado</th>
                          <th className="p-2">Motivo</th>
                          <th className="p-2">Detalle</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredImportDetails.slice(0, 150).map(d => (
                          <tr key={`${d.rowIndex}-${d.reason}-${d.date}`} className="border-t border-slate-100 hover:bg-slate-50/80">
                            <td className="p-2 whitespace-nowrap font-medium">{d.date}</td>
                            <td className="p-2 whitespace-nowrap">{d.dni}</td>
                            <td className="p-2 max-w-[160px] truncate" title={d.ccosto}>{d.ccosto}</td>
                            <td className="p-2 max-w-[140px] truncate" title={d.objectiveName}>{d.objectiveName || '—'}</td>
                            <td className="p-2 whitespace-nowrap font-bold text-amber-800">
                              {IMPORT_SKIP_LABELS[d.reason as ImportSkipReason] || d.reason}
                            </td>
                            <td className="p-2 max-w-[220px] truncate text-slate-600" title={d.detail}>{d.detail || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {filteredImportDetails.length > 150 && (
                    <p className="text-[10px] text-slate-500 mt-2">
                      Mostrando 150 de {filteredImportDetails.length.toLocaleString('es-AR')}. Exportá CSV para el listado completo.
                    </p>
                  )}
                </div>
              </div>
            )}
          </ContentCard>
        )}
      </PageShell>
    </DashboardLayout>
  );
}
