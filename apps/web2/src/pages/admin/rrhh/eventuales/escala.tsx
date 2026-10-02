import { useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  AlertTriangle, ArrowLeft, Check, ExternalLink, FileUp, GitCompare, History, Pencil, ScrollText, ShieldCheck, Upload, X, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { PageHeader, PageShell } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { useMovilMode } from '@/lib/movil/useMovilMode';
import { db, functions } from '@/lib/firebase';
import {
  CAMPOS_CELDA, CCT_422_ID, ETIQUETA_CAMPO, PARAMETROS_EDITABLES, celdasBajaConfianza, derivadosFila, diffEscalas, parametrosDe, resumenEscala, rotuloFuente, rotuloVigencia,
} from '@/lib/eventuales/escalaCct.mjs';

type Campo = { valor: number | null; confianza: 'ALTA' | 'MEDIA' | 'BAJA'; motivo?: string };
type Fila = { codigo: string; label: string; codigoArca: string | null; basico: Campo; presentismo: Campo; viatico: Campo; noRemunerativo: Campo; total: Campo; totalCalculado: number | null; sumaCierra: boolean | null };
type Tramo = { mes: string; vigenciaDesde: string; vigenciaHasta: string; mesConfianza: string; mesMotivo?: string; categorias: Fila[]; aeroportuario: Campo | null; adicionalVacacionesPorDia: Campo | null };
type Historial = { at: string; por: string; porEmail: string | null; motivo: string; cambios: { mes: string | null; codigo: string | null; campo: string; antes: unknown; despues: unknown }[] };
type Escala = Record<string, any> & { id: string; estado: string; tramos: Tramo[]; historial?: Historial[]; fuente?: Record<string, string | null>; version?: number | null };

type CampoKey = 'basico' | 'presentismo' | 'viatico' | 'noRemunerativo' | 'total';
const CAMPOS = CAMPOS_CELDA as CampoKey[];
const ETIQUETA = ETIQUETA_CAMPO as Record<string, string>;
const PARAMETROS = PARAMETROS_EDITABLES as string[];

type Pendiente = { key: string; mes: string | null; codigo: string | null; campo: string; valor: number | null; antes: number | null; etiqueta: string };

const ESTADO_UI: Record<string, { texto: string; tono: string }> = {
  PROPUESTA: { texto: 'Propuesta · pendiente de aprobación', tono: 'bg-amber-50 text-amber-800 border-amber-200' },
  APROBADA: { texto: 'Vigente · aprobada', tono: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  REEMPLAZADA: { texto: 'Reemplazada', tono: 'bg-slate-100 text-slate-600 border-slate-200' },
  RECHAZADA: { texto: 'Rechazada', tono: 'bg-rose-50 text-rose-800 border-rose-200' },
};

const CONF_TONO: Record<string, string> = { MEDIA: 'bg-amber-50 ring-1 ring-inset ring-amber-300', BAJA: 'bg-rose-50 ring-1 ring-inset ring-rose-300' };
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const fmt = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('es-AR', { maximumFractionDigits: 2 }));
const fmtMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1] || mes} ${mes.slice(0, 4)}`;
const fmtFechaHora = (v: unknown) => {
  const d = typeof v === 'string' ? new Date(v) : (v as { toDate?: () => Date })?.toDate?.();
  if (!d || Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const orden = (a: Escala, b: Escala) => String(b.vigenciaDesde || '').localeCompare(String(a.vigenciaDesde || '')) || String(b.creadoEn?.toMillis?.() || b.creadoEn || '').localeCompare(String(a.creadoEn?.toMillis?.() || a.creadoEn || ''));

function leerArchivoBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').replace(/^data:[^;]+;base64,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function EscalaSalarialPage() {
  const router = useRouter();
  const movil = useMovilMode();
  const { isSuperAdmin, rolePermissions } = useAuth();
  const { empresaId } = useEmpresa();
  const acciones = rolePermissions?.EVENTUALES || [];
  const puedeVer = isSuperAdmin || acciones.includes('read');
  const puedeEditar = isSuperAdmin || acciones.includes('update');

  const [escalas, setEscalas] = useState<Escala[]>([]);
  const [cargando, setCargando] = useState(true);
  const [elegidaId, setElegidaId] = useState('');
  const [mes, setMes] = useState('');
  const [pendientes, setPendientes] = useState<Record<string, Pendiente>>({});
  const [editando, setEditando] = useState<{ key: string; valor: string } | null>(null);
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState('');
  const [confirmar, setConfirmar] = useState<'aprobar' | 'rechazar' | null>(null);
  const [verComparar, setVerComparar] = useState(false);
  const [verHistorial, setVerHistorial] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (movil) void router.replace('/admin/rrhh/eventuales/?panel=escala');
  }, [movil, router]);

  useEffect(() => {
    if (!puedeVer) return;
    const q = query(collection(db, 'escalas_cct'), where('cct', '==', CCT_422_ID));
    return onSnapshot(q, (snap) => {
      setEscalas(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Escala)).sort(orden));
      setCargando(false);
    }, () => { toast.error('No se pudo leer la escala salarial.'); setCargando(false); });
  }, [puedeVer]);

  const vigente = useMemo(() => escalas.find((e) => e.estado === 'APROBADA') || null, [escalas]);
  const elegida = useMemo(() => escalas.find((e) => e.id === elegidaId) || escalas.find((e) => e.estado === 'PROPUESTA') || vigente || escalas[0] || null, [escalas, elegidaId, vigente]);

  useEffect(() => {
    if (!elegida) return;
    if (!elegida.tramos.some((t) => t.mes === mes)) setMes(elegida.tramos[0]?.mes || '');
  }, [elegida, mes]);
  useEffect(() => { setPendientes({}); setEditando(null); setMotivo(''); setVerComparar(false); }, [elegida?.id]);

  const tramo = elegida?.tramos.find((t) => t.mes === mes) || null;
  const parametros = useMemo(() => (elegida ? parametrosDe(elegida) : null), [elegida]);
  const bajas = useMemo(() => (elegida ? celdasBajaConfianza(elegida) as { mes: string; codigo: string; campo: string; confianza: string; motivo: string | null }[] : []), [elegida]);
  const bajaDe = (m: string, codigo: string, campo: string) => bajas.find((b) => b.mes === m && b.codigo === codigo && b.campo === campo) || null;
  const anterior = useMemo(() => {
    if (!elegida) return null;
    if (elegida.derivadaDe) return escalas.find((e) => e.id === elegida.derivadaDe) || null;
    if (elegida.reemplazaA) return escalas.find((e) => e.id === elegida.reemplazaA) || null;
    return escalas.find((e) => e.id !== elegida.id && ['APROBADA', 'REEMPLAZADA'].includes(e.estado) && String(e.vigenciaDesde || '') <= String(elegida.vigenciaDesde || '')) || null;
  }, [elegida, escalas]);
  const diff = useMemo(() => (elegida ? diffEscalas(anterior, elegida) as { mes: string | null; codigo: string | null; campo: string; antes: unknown; despues: unknown }[] : []), [anterior, elegida]);

  const editable = puedeEditar && !!elegida && ['PROPUESTA', 'APROBADA'].includes(elegida.estado);
  const nPend = Object.keys(pendientes).length;

  const valorMostrado = (key: string, actual: number | null) => (pendientes[key] ? pendientes[key].valor : actual);
  const abrirEdicion = (key: string, actual: number | null) => {
    if (!editable) return;
    setEditando({ key, valor: valorMostrado(key, actual) == null ? '' : String(valorMostrado(key, actual)) });
  };
  const confirmarEdicion = (p: Omit<Pendiente, 'key' | 'valor'> & { key: string }) => {
    if (!editando || editando.key !== p.key) return;
    const raw = editando.valor.trim();
    const valor = raw === '' ? null : Number(raw.replace(/\./g, '').replace(',', '.'));
    setEditando(null);
    if (raw !== '' && (!Number.isFinite(valor) || (valor as number) < 0)) { toast.error('Valor inválido.'); return; }
    if (valor === p.antes) { setPendientes((prev) => { const n = { ...prev }; delete n[p.key]; return n; }); return; }
    setPendientes((prev) => ({ ...prev, [p.key]: { ...p, valor } }));
  };
  const quitarPendiente = (key: string) => setPendientes((prev) => { const n = { ...prev }; delete n[key]; return n; });

  const llamar = async (label: string, data: Record<string, unknown>) => {
    setGuardando(label);
    try {
      const fn = httpsCallable(functions, 'gestionarEscalaCct');
      const res = await fn(data);
      return res.data as Record<string, unknown>;
    } finally {
      setGuardando('');
    }
  };

  const guardarCambios = async () => {
    if (!elegida || !nPend) return;
    if (motivo.trim().length < 3) { toast.error('Indicá el motivo de la corrección.'); return; }
    try {
      const cambios = Object.values(pendientes).map((p) => ({ mes: p.mes, codigo: p.codigo, campo: p.campo, valor: p.valor }));
      const r = await llamar('editar', { accion: 'editar', docId: elegida.id, cambios, motivo: motivo.trim() });
      setPendientes({}); setMotivo('');
      if (r.derivada) {
        toast.success('La vigente no se toca: la corrección quedó como propuesta nueva. Aprobala para que rija.');
        setElegidaId(String(r.docId));
      } else {
        toast.success(`${r.cambios} cambio${Number(r.cambios) === 1 ? '' : 's'} guardado${Number(r.cambios) === 1 ? '' : 's'} en la propuesta.`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    }
  };

  const aprobar = async () => {
    if (!elegida) return;
    setConfirmar(null);
    try {
      const r = await llamar('aprobar', { accion: 'aprobar', docId: elegida.id, motivo: motivo.trim() || null });
      toast.success(`Escala aprobada (versión ${r.version}). ${r.filas} filas listas para el anexo.`);
      setMotivo('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo aprobar.');
    }
  };

  const rechazar = async () => {
    if (!elegida) return;
    if (motivo.trim().length < 3) { toast.error('Indicá el motivo del rechazo.'); return; }
    setConfirmar(null);
    try {
      await llamar('rechazar', { accion: 'rechazar', docId: elegida.id, motivo: motivo.trim() });
      toast.success('Propuesta rechazada.');
      setMotivo('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo rechazar.');
    }
  };

  const importarPdf = async (file: File) => {
    setGuardando('importar');
    try {
      const esPdf = /\.pdf$/i.test(file.name);
      const payload: Record<string, unknown> = { guardar: true, fileName: file.name, empresaId: empresaId || null };
      if (esPdf) payload.pdfBase64 = await leerArchivoBase64(file);
      else payload.textoAnexo = await file.text();
      const fn = httpsCallable(functions, 'extraerEscalaCct422');
      const res = await fn(payload);
      const data = res.data as { docId?: string; yaExistia?: boolean; propuesta?: { confianzaGlobal?: string; advertencias?: string[] } };
      if (data.yaExistia) toast.info('Ese documento ya estaba cargado.');
      else toast.success(`Propuesta creada (confianza ${data.propuesta?.confianzaGlobal || '—'}${data.propuesta?.advertencias?.length ? `, ${data.propuesta.advertencias.length} advertencias` : ''}).`);
      if (data.docId) setElegidaId(data.docId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo leer el documento.');
    } finally {
      setGuardando('');
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  if (movil) return <Head><title>Escala salarial | COSP V1.0</title></Head>;
  if (!puedeVer) {
    return <DashboardLayout><p className="p-8 text-slate-600">No tenés permiso para ver Eventuales. Lo asigna Configuración → Roles.</p></DashboardLayout>;
  }

  const celda = (f: Fila, campo: CampoKey) => {
    if (!tramo) return null;
    const key = `${tramo.mes}|${f.codigo}|${campo}`;
    const actual = f[campo]?.valor ?? null;
    const baja = bajaDe(tramo.mes, f.codigo, campo);
    const pend = pendientes[key];
    const tono = pend ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-300' : baja ? CONF_TONO[baja.confianza] || '' : '';
    if (editando?.key === key) {
      return (
        <td key={campo} className="px-1 py-0.5 text-right">
          <input autoFocus value={editando.valor} onChange={(e) => setEditando({ key, valor: e.target.value })}
            onBlur={() => confirmarEdicion({ key, mes: tramo.mes, codigo: f.codigo, campo, antes: actual, etiqueta: `${fmtMes(tramo.mes)} · ${f.label} · ${ETIQUETA[campo]}` })}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditando(null); }}
            inputMode="decimal" className="w-28 rounded-lg border border-indigo-300 px-2 py-1 text-right text-xs font-bold tabular-nums outline-none" />
        </td>
      );
    }
    return (
      <td key={campo} title={baja ? `${baja.confianza}${baja.motivo ? ` · ${baja.motivo}` : ''}` : (editable ? 'Clic para corregir' : '')}
        onClick={() => abrirEdicion(key, actual)}
        className={`px-2 py-1.5 text-right text-xs font-semibold tabular-nums text-slate-800 ${tono} ${editable ? 'cursor-pointer hover:bg-slate-50' : ''}`}>
        {fmt(valorMostrado(key, actual))}
        {baja && !pend && <AlertTriangle size={10} className="ml-1 inline text-amber-600" aria-label="baja confianza" />}
      </td>
    );
  };

  const celdaTramo = (campo: 'aeroportuario' | 'adicionalVacacionesPorDia') => {
    if (!tramo) return null;
    const key = `${tramo.mes}|*|${campo}`;
    const actual = tramo[campo]?.valor ?? null;
    const baja = bajaDe(tramo.mes, '*', campo);
    const pend = pendientes[key];
    if (editando?.key === key) {
      return (
        <input autoFocus value={editando.valor} onChange={(e) => setEditando({ key, valor: e.target.value })}
          onBlur={() => confirmarEdicion({ key, mes: tramo.mes, codigo: '*', campo, antes: actual, etiqueta: `${fmtMes(tramo.mes)} · ${ETIQUETA[campo]}` })}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditando(null); }}
          inputMode="decimal" className="w-28 rounded-lg border border-indigo-300 px-2 py-1 text-right text-xs font-bold tabular-nums outline-none" />
      );
    }
    return (
      <button type="button" disabled={!editable} onClick={() => abrirEdicion(key, actual)}
        className={`rounded-lg px-2 py-1 text-xs font-bold tabular-nums ${pend ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-300' : baja ? CONF_TONO[baja.confianza] : 'bg-slate-50'} ${editable ? 'hover:bg-slate-100' : ''}`}>
        {fmt(valorMostrado(key, actual))}
      </button>
    );
  };

  const parametroCelda = (ruta: string) => {
    if (!parametros) return null;
    const partes = ruta.replace(/^parametros\./, '').split('.');
    const actual = partes.reduce<any>((acc, k) => acc?.[k], parametros) ?? null;
    const key = `param|${ruta}`;
    const pend = pendientes[key];
    const falta = ruta === 'parametros.recargos.nocturnoPct' && valorMostrado(key, actual) == null;
    if (editando?.key === key) {
      return (
        <input autoFocus value={editando.valor} onChange={(e) => setEditando({ key, valor: e.target.value })}
          onBlur={() => confirmarEdicion({ key, mes: null, codigo: null, campo: ruta, antes: actual, etiqueta: ETIQUETA[ruta] || ruta })}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditando(null); }}
          inputMode="decimal" className="w-20 rounded-lg border border-indigo-300 px-2 py-1 text-right text-xs font-bold tabular-nums outline-none" />
      );
    }
    return (
      <button type="button" disabled={!editable} onClick={() => abrirEdicion(key, actual)} title={falta ? 'El acta no fija el recargo nocturno: completalo con motivo. Hasta entonces el anexo avisa.' : ''}
        className={`rounded-lg px-2 py-1 text-xs font-bold tabular-nums ${pend ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-300' : falta ? CONF_TONO.BAJA : 'bg-slate-50'} ${editable ? 'hover:bg-slate-100' : ''}`}>
        {falta ? 'a completar' : fmt(valorMostrado(key, actual))}
      </button>
    );
  };

  const estadoUi = elegida ? ESTADO_UI[elegida.estado] || ESTADO_UI.PROPUESTA : null;
  const bajasDelMes = tramo ? bajas.filter((b) => b.mes === tramo.mes).length : 0;

  return (
    <DashboardLayout>
      <Head><title>Escala salarial | COSP V1.0</title></Head>
      <PageShell className="!pb-10">
        <div className="mx-auto max-w-7xl space-y-4">
          <Link href="/admin/rrhh/eventuales" className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-700"><ArrowLeft size={14} /> Eventuales</Link>
          <PageHeader
            title="Escala salarial"
            subtitle="CCT 422/05 (SUVICO – CAESI) · solo para el bruto del anexo del eventual"
            icon={ScrollText}
            className="!mb-2"
            actions={puedeEditar ? (
              <div className="flex flex-wrap items-center gap-2">
                <input ref={fileRef} type="file" accept=".pdf,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importarPdf(f); }} />
                <button type="button" disabled={guardando === 'importar'} onClick={() => fileRef.current?.click()} title="Leer un PDF (SUVICO o anexo de la disposición) y dejarlo como propuesta"
                  className="inline-flex h-9 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50">
                  <FileUp size={14} /> {guardando === 'importar' ? 'Leyendo…' : 'Leer PDF'}
                </button>
              </div>
            ) : undefined}
          />

          <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
            <aside className="space-y-2">
              <p className="px-1 text-[11px] font-black uppercase tracking-wide text-slate-500">Versiones</p>
              {cargando && <p className="rounded-2xl border border-slate-200 bg-white p-4 text-xs font-semibold text-slate-500 shadow-sm">Cargando…</p>}
              {!cargando && escalas.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-xs font-semibold text-slate-500 shadow-sm">
                  Todavía no hay ninguna escala. El job diario propone la que publique la fuente oficial; también podés leer el PDF con el botón de arriba.
                </div>
              )}
              {escalas.map((e) => {
                const r = resumenEscala(e) as ReturnType<typeof resumenEscala>;
                const ui = ESTADO_UI[e.estado] || ESTADO_UI.PROPUESTA;
                const on = elegida?.id === e.id;
                return (
                  <button key={e.id} type="button" onClick={() => setElegidaId(e.id)} data-escala={e.id} data-estado={e.estado}
                    className={`w-full rounded-2xl border p-3 text-left shadow-sm transition ${on ? 'border-indigo-400 bg-indigo-50/50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-black text-slate-900">{r.vigencia}</span>
                      {e.version != null && <span className="rounded-full bg-slate-900 px-1.5 text-[9px] font-black text-white">v{e.version}</span>}
                    </div>
                    <p className={`mt-1 inline-block rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${ui.tono}`}>{ui.texto}</p>
                    <p className="mt-1 truncate text-[11px] font-semibold text-slate-600" title={r.fuente}>{r.fuente}</p>
                    <p className="mt-0.5 text-[10px] font-medium text-slate-400">
                      {r.meses} meses · {r.categorias} categorías · {r.extraccion === 'TEXTO_OFICIAL' ? 'texto oficial' : r.extraccion === 'GEMINI_VISION' ? 'PDF escaneado' : 'manual'}
                      {r.bajaConfianza ? ` · ${r.bajaConfianza} a revisar` : ''}{r.ediciones ? ` · ${r.ediciones} correcciones` : ''}
                    </p>
                  </button>
                );
              })}
            </aside>

            <section className="space-y-3">
              {!elegida && !cargando && (
                <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500 shadow-sm">Sin escala para mostrar.</div>
              )}
              {elegida && estadoUi && (
                <>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-lg border px-2 py-0.5 text-[11px] font-black ${estadoUi.tono}`} data-estado-actual={elegida.estado}>{estadoUi.texto}</span>
                          {elegida.version != null && <span className="text-[11px] font-bold text-slate-500">versión {elegida.version}</span>}
                          <span className="text-[11px] font-bold text-slate-500">confianza {elegida.confianzaGlobal || '—'}</span>
                          {bajas.length > 0 && <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800"><AlertTriangle size={11} /> {bajas.length} celdas a revisar</span>}
                        </div>
                        <h2 className="mt-1 text-base font-black text-slate-900">Vigencia {rotuloVigencia(elegida)}</h2>
                        <p className="text-xs font-semibold text-slate-600">
                          Fuente: {rotuloFuente(elegida)}
                          {elegida.fuente?.expediente ? ` · ${elegida.fuente.expediente}` : ''}
                          {elegida.fuente?.url && (
                            <a href={elegida.fuente.url} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 text-indigo-700 hover:underline">documento <ExternalLink size={11} /></a>
                          )}
                        </p>
                        <p className="text-[11px] font-medium text-slate-500">
                          {elegida.extraccion === 'TEXTO_OFICIAL' ? 'Leída del anexo oficial con capa de texto' : elegida.extraccion === 'GEMINI_VISION' ? `Leída del PDF escaneado${elegida.modelo ? ` (${elegida.modelo})` : ''}` : 'Carga manual'}
                          {elegida.origen === 'JOB_DIARIO' ? ' · encontrada por el job diario' : elegida.origen === 'SEED' ? ' · carga inicial' : elegida.origen === 'CORRECCION_RRHH' ? ' · corrección sobre la vigente' : ''}
                          {elegida.creadoEn ? ` · ${fmtFechaHora(elegida.creadoEn)}` : ''}
                          {elegida.estado === 'APROBADA' && elegida.aprobadoEn ? ` · aprobada ${fmtFechaHora(elegida.aprobadoEn)}${elegida.aprobadoPorEmail ? ` por ${elegida.aprobadoPorEmail}` : ''}` : ''}
                          {elegida.estado === 'RECHAZADA' && elegida.rechazoMotivo ? ` · rechazo: ${elegida.rechazoMotivo}` : ''}
                          {elegida.noRemunerativoSeIncorporaAlBasicoDesde ? ` · el no remunerativo se incorpora al básico desde ${elegida.noRemunerativoSeIncorporaAlBasicoDesde.slice(0, 7)}` : ''}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => setVerComparar((v) => !v)} className={`inline-flex h-8 items-center gap-1 rounded-xl border px-2.5 text-[11px] font-bold shadow-sm ${verComparar ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
                          <GitCompare size={13} /> Qué cambió{diff.length ? ` (${diff.length})` : ''}
                        </button>
                        <button type="button" onClick={() => setVerHistorial((v) => !v)} className={`inline-flex h-8 items-center gap-1 rounded-xl border px-2.5 text-[11px] font-bold shadow-sm ${verHistorial ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
                          <History size={13} /> Historial{elegida.historial?.length ? ` (${elegida.historial.length})` : ''}
                        </button>
                        {puedeEditar && elegida.estado === 'PROPUESTA' && (
                          <>
                            <button type="button" disabled={!!guardando || nPend > 0} onClick={() => setConfirmar('aprobar')} title={nPend ? 'Guardá o descartá los cambios pendientes antes de aprobar' : 'Aprobar: el anexo empieza a usar esta escala'}
                              className="inline-flex h-8 items-center gap-1 rounded-xl bg-emerald-600 px-3 text-[11px] font-black text-white shadow-sm hover:bg-emerald-700 active:scale-95 disabled:opacity-50">
                              <ShieldCheck size={13} /> Aprobar
                            </button>
                            <button type="button" disabled={!!guardando} onClick={() => setConfirmar('rechazar')}
                              className="inline-flex h-8 items-center gap-1 rounded-xl border border-rose-200 bg-white px-3 text-[11px] font-black text-rose-700 shadow-sm hover:bg-rose-50 active:scale-95 disabled:opacity-50">
                              <XCircle size={13} /> Rechazar
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {Array.isArray(elegida.advertencias) && elegida.advertencias.length > 0 && (
                      <details className="mt-2 rounded-xl bg-amber-50 p-2 text-[11px] font-semibold text-amber-900">
                        <summary className="cursor-pointer">{elegida.advertencias.length} advertencias del extractor</summary>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4">{elegida.advertencias.map((a: string, i: number) => <li key={i}>{a}</li>)}</ul>
                      </details>
                    )}
                  </div>

                  {verComparar && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-comparar>
                      <p className="text-xs font-black text-slate-900">
                        {anterior ? `Cambios contra ${anterior.version != null ? `v${anterior.version}` : 'la anterior'} (${rotuloVigencia(anterior)})` : 'Primera versión: no hay anterior contra la cual comparar.'}
                      </p>
                      {anterior && diff.length === 0 && <p className="mt-1 text-xs font-semibold text-slate-500">Sin diferencias.</p>}
                      {diff.length > 0 && (
                        <div className="mt-2 max-h-72 overflow-auto">
                          <table className="w-full text-[11px]">
                            <thead><tr className="text-left text-slate-500"><th className="py-1 pr-2">Mes</th><th className="py-1 pr-2">Categoría</th><th className="py-1 pr-2">Concepto</th><th className="py-1 pr-2 text-right">Antes</th><th className="py-1 text-right">Ahora</th></tr></thead>
                            <tbody>
                              {diff.slice(0, 300).map((d, i) => (
                                <tr key={i} className="border-t border-slate-100">
                                  <td className="py-1 pr-2 font-semibold">{d.mes ? fmtMes(d.mes) : '—'}</td>
                                  <td className="py-1 pr-2">{d.codigo && d.codigo !== '*' ? (elegida.tramos.flatMap((t) => t.categorias).find((c) => c.codigo === d.codigo)?.label || d.codigo) : d.codigo === '*' ? 'Tramo' : 'Parámetro'}</td>
                                  <td className="py-1 pr-2">{ETIQUETA[d.campo] || d.campo}</td>
                                  <td className="py-1 pr-2 text-right tabular-nums text-slate-500">{typeof d.antes === 'number' ? fmt(d.antes) : String(d.antes ?? '—')}</td>
                                  <td className="py-1 text-right font-bold tabular-nums">{typeof d.despues === 'number' ? fmt(d.despues) : String(d.despues ?? '—')}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {verHistorial && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-historial>
                      <p className="text-xs font-black text-slate-900">Correcciones de esta versión</p>
                      {!elegida.historial?.length && <p className="mt-1 text-xs font-semibold text-slate-500">Sin correcciones: tal como la leyó el extractor.</p>}
                      <ul className="mt-2 space-y-2">
                        {(elegida.historial || []).slice().reverse().map((h, i) => (
                          <li key={i} className="rounded-xl bg-slate-50 p-2 text-[11px]">
                            <p className="font-bold text-slate-800">{fmtFechaHora(h.at)} · {h.porEmail || h.por} · <span className="font-semibold text-slate-600">{h.motivo}</span></p>
                            <ul className="mt-1 space-y-0.5 pl-3 text-slate-600">
                              {h.cambios.map((c, j) => (
                                <li key={j}>{c.mes ? `${fmtMes(c.mes)} · ` : ''}{c.codigo && c.codigo !== '*' ? `${elegida.tramos.flatMap((t) => t.categorias).find((x) => x.codigo === c.codigo)?.label || c.codigo} · ` : ''}{ETIQUETA[c.campo] || c.campo}: <span className="tabular-nums">{typeof c.antes === 'number' ? fmt(c.antes) : String(c.antes ?? '—')}</span> → <span className="font-bold tabular-nums">{typeof c.despues === 'number' ? fmt(c.despues) : String(c.despues ?? '—')}</span></li>
                              ))}
                            </ul>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 p-2">
                      {elegida.tramos.map((t) => (
                        <button key={t.mes} type="button" onClick={() => setMes(t.mes)} data-mes={t.mes}
                          className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${mes === t.mes ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>
                          {fmtMes(t.mes)}{bajas.some((b) => b.mes === t.mes && b.campo !== 'mes') ? ' ·' : ''}
                        </button>
                      ))}
                      {tramo && (
                        <span className="ml-auto text-[11px] font-semibold text-slate-500">
                          {tramo.vigenciaDesde.slice(8, 10)}/{tramo.vigenciaDesde.slice(5, 7)} → {tramo.vigenciaHasta.slice(8, 10)}/{tramo.vigenciaHasta.slice(5, 7)}
                          {tramo.mesConfianza !== 'ALTA' ? ` · mes ${tramo.mesConfianza.toLowerCase()}${tramo.mesMotivo === 'MES_POR_POSICION' ? ' (asignado por posición en el anexo)' : ''}` : ''}
                          {bajasDelMes ? ` · ${bajasDelMes} celdas a revisar` : ''}
                        </span>
                      )}
                    </div>
                    {tramo && (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[980px] text-xs" data-tabla-escala={tramo.mes}>
                          <thead>
                            <tr className="bg-slate-50 text-left text-[10px] font-black uppercase tracking-wide text-slate-500">
                              <th className="px-2 py-2">Categoría</th>
                              <th className="px-2 py-2">ARCA</th>
                              <th className="px-2 py-2 text-right">Básico</th>
                              <th className="px-2 py-2 text-right">Presentismo</th>
                              <th className="px-2 py-2 text-right">Viático 106</th>
                              <th className="px-2 py-2 text-right">No rem.</th>
                              <th className="px-2 py-2 text-right">Total</th>
                              <th className="px-2 py-2 text-right text-indigo-700">Valor hora</th>
                              <th className="px-2 py-2 text-right text-indigo-700">Extra 50 %</th>
                              <th className="px-2 py-2 text-right text-indigo-700">Extra 100 %</th>
                              <th className="px-2 py-2 text-right text-indigo-700">Nocturna</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tramo.categorias.map((f) => {
                              const der = derivadosFila(f, parametros) as { valorHora: number | null; horaExtra50: number | null; horaExtra100: number | null; horaNocturna: number | null };
                              return (
                                <tr key={f.codigo} className={`border-t border-slate-100 ${f.codigo === 'VIGILADOR' ? 'bg-indigo-50/30' : ''}`} data-categoria={f.codigo}>
                                  <td className="px-2 py-1.5 font-bold text-slate-900">{f.label}{f.sumaCierra === false && <span title="La suma de las columnas no coincide con el total impreso" className="ml-1 text-amber-600">≠</span>}</td>
                                  <td className="px-2 py-1.5 font-semibold tabular-nums text-slate-500">{f.codigoArca || '—'}</td>
                                  {CAMPOS.map((campo) => celda(f, campo))}
                                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-indigo-800">{fmt(der.valorHora)}</td>
                                  <td className="px-2 py-1.5 text-right tabular-nums text-indigo-800">{fmt(der.horaExtra50)}</td>
                                  <td className="px-2 py-1.5 text-right tabular-nums text-indigo-800">{fmt(der.horaExtra100)}</td>
                                  <td className="px-2 py-1.5 text-right tabular-nums text-indigo-800">{der.horaNocturna == null ? <span className="text-amber-600" title="Falta el recargo nocturno">—</span> : fmt(der.horaNocturna)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 px-3 py-2 text-[11px] font-semibold text-slate-600">
                          <span>Adicional aeroportuario (mensual): {celdaTramo('aeroportuario')}</span>
                          <span>Adicional vacaciones por día (tope 21): {celdaTramo('adicionalVacacionesPorDia')}</span>
                          <span className="text-slate-400">Valor hora = básico / {parametros?.divisorHoras ?? 200}. Presentismo, viático y no rem. son mensuales y el anexo los prorratea por día trabajado (/{parametros?.prorrateoDias ?? 30}).</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-xs font-black text-slate-900">Parámetros del cálculo del anexo</p>
                    <p className="text-[11px] font-medium text-slate-500">Lo que el acta no trae y el bruto necesita. El recargo nocturno 21:00–06:00 no está fijado en el acta: completalo con motivo; hasta entonces el anexo avisa.</p>
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-[11px] font-semibold text-slate-600">
                      {PARAMETROS.map((ruta) => (
                        <span key={ruta} className="inline-flex items-center gap-1" data-parametro={ruta}>{ETIQUETA[ruta] || ruta}: {parametroCelda(ruta)}</span>
                      ))}
                    </div>
                  </div>

                  {(nPend > 0 || (puedeEditar && elegida.estado === 'PROPUESTA')) && (
                    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4 shadow-sm" data-cambios-pendientes={nPend}>
                      {nPend > 0 && (
                        <>
                          <p className="inline-flex items-center gap-1 text-xs font-black text-indigo-900"><Pencil size={13} /> {nPend} cambio{nPend === 1 ? '' : 's'} sin guardar{elegida.estado === 'APROBADA' ? ' · la vigente no se toca: nace una propuesta nueva para aprobar' : ''}</p>
                          <ul className="mt-1 space-y-0.5 text-[11px] text-indigo-900">
                            {Object.values(pendientes).map((p) => (
                              <li key={p.key} className="flex items-center gap-2">
                                <span>{p.etiqueta}: <span className="tabular-nums text-slate-500">{fmt(p.antes)}</span> → <span className="font-bold tabular-nums">{p.valor == null ? 'vacío' : fmt(p.valor)}</span></span>
                                <button type="button" onClick={() => quitarPendiente(p.key)} aria-label="Descartar" className="text-slate-400 hover:text-rose-600"><X size={12} /></button>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                      <label className="mt-2 block text-[11px] font-bold text-slate-700">Motivo {nPend > 0 ? '(obligatorio para guardar)' : '(para aprobar o rechazar)'}
                        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: corregido contra el acta firmada / verificado con el estudio contable" className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold outline-none focus:border-indigo-400" />
                      </label>
                      {nPend > 0 && (
                        <div className="mt-2 flex gap-2">
                          <button type="button" disabled={!!guardando} onClick={() => void guardarCambios()} className="inline-flex h-9 items-center gap-1 rounded-xl bg-indigo-600 px-3 text-xs font-black text-white shadow-sm hover:bg-indigo-700 active:scale-95 disabled:opacity-50">
                            <Check size={14} /> {guardando === 'editar' ? 'Guardando…' : elegida.estado === 'APROBADA' ? 'Crear propuesta corregida' : 'Guardar correcciones'}
                          </button>
                          <button type="button" onClick={() => { setPendientes({}); setEditando(null); }} className="inline-flex h-9 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 shadow-sm hover:bg-slate-50">Descartar</button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        </div>
      </PageShell>

      {confirmar && elegida && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-lg">
            <h3 className="text-base font-black text-slate-900">{confirmar === 'aprobar' ? 'Aprobar esta escala' : 'Rechazar esta propuesta'}</h3>
            <p className="mt-1 text-xs font-semibold text-slate-600">
              {confirmar === 'aprobar'
                ? `Vigencia ${rotuloVigencia(elegida)} · ${rotuloFuente(elegida)}. Desde ahora el bruto del anexo del eventual sale de esta escala para esas fechas${vigente ? '; la vigente anterior que solape queda reemplazada' : ''}. No afecta liquidación ni payroll.`
                : 'La propuesta queda rechazada con el motivo indicado. No se pierde: sigue en la lista.'}
            </p>
            {bajas.length > 0 && confirmar === 'aprobar' && <p className="mt-2 rounded-xl bg-amber-50 p-2 text-[11px] font-bold text-amber-900">Hay {bajas.length} celdas con confianza media/baja. Revisalas antes o aprobá igual bajo tu responsabilidad.</p>}
            {parametros?.recargos?.nocturnoPct == null && confirmar === 'aprobar' && <p className="mt-2 rounded-xl bg-amber-50 p-2 text-[11px] font-bold text-amber-900">El recargo nocturno no está cargado: los anexos con horas nocturnas van a avisarlo.</p>}
            <label className="mt-3 block text-[11px] font-bold text-slate-700">Motivo{confirmar === 'rechazar' ? ' (obligatorio)' : ' (opcional)'}
              <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold outline-none focus:border-indigo-400" />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmar(null)} className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50">Cancelar</button>
              <button type="button" disabled={!!guardando} onClick={() => void (confirmar === 'aprobar' ? aprobar() : rechazar())}
                className={`inline-flex h-9 items-center gap-1 rounded-xl px-3 text-xs font-black text-white shadow-sm active:scale-95 disabled:opacity-50 ${confirmar === 'aprobar' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}`}>
                {confirmar === 'aprobar' ? <><Upload size={14} /> {guardando ? 'Aprobando…' : 'Aprobar y publicar'}</> : <><XCircle size={14} /> {guardando ? 'Rechazando…' : 'Rechazar'}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
