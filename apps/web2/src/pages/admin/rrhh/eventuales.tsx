import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  AlertTriangle, ArrowLeft, Building2, CircleDashed, Download, FileCheck2, FileSpreadsheet, FileX2, Home, Landmark, Mail, MapPin, Phone, Plus, Search, UserCheck, UserPlus, UserX, Users, X,
} from 'lucide-react';
import { toast } from 'sonner';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { EventualesMovil } from '@/components/movil/EventualesMovil';
import { useMovilMode } from '@/lib/movil/useMovilMode';
import { PageHeader, PageShell } from '@/components/ui';
import FichaEventual, { type DocumentoVista, type EmpresaPlataforma, type FichaEventualData, type MarcoVista } from '@/components/eventuales/FichaEventual';
import ArcaPendientesPanel from '@/components/eventuales/ArcaPendientesPanel';
import MarcosLotePanel from '@/components/eventuales/MarcosLotePanel';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { db, functions } from '@/lib/firebase';
import { RNOS_DEFAULT_FICHA } from '@/lib/eventuales/ficha.mjs';
import {
  contadoresFiltros, empresasPlataformaDeDocs, faltantesConvocable, FILTROS_LISTA, filtrarFichas, iniciales, plantillaNomina, siglaEmpresa, textoDisponibilidad, textoLegajo,
} from '@/lib/eventuales/fichaUx.mjs';
import { GRUPO_EVENTUALES_ID } from '@/lib/eventuales/grupo.mjs';
import { marcoDeBolsa } from '@/lib/eventuales/marcoTexto.mjs';

type Ficha = FichaEventualData;

type Form = {
  nombre: string; cuil: string; dni: string; fechaNacimiento: string; domicilio: string;
  telefono: string; mail: string; obraSocialRnos: string; empresasHabilitadas: string[];
  habilitacionNumero: string; habilitacionVencimiento: string; credencialVencimiento: string;
  aptoEstado: string; aptoVencimiento: string; observaciones: string;
  domicilioGeo: { lat: string; lon: string; display_name: string } | null;
};

const vacio = (): Form => ({
  nombre: '', cuil: '', dni: '', fechaNacimiento: '', domicilio: '', telefono: '', mail: '',
  obraSocialRnos: RNOS_DEFAULT_FICHA, empresasHabilitadas: [], habilitacionNumero: '', habilitacionVencimiento: '',
  credencialVencimiento: '', aptoEstado: '', aptoVencimiento: '', observaciones: '', domicilioGeo: null,
});

const formDe = (f: Ficha): Form => ({
  ...vacio(),
  nombre: f.nombre, cuil: f.id, dni: f.dni, fechaNacimiento: f.fechaNacimiento, domicilio: f.domicilio, telefono: f.telefono, mail: f.mail,
  obraSocialRnos: f.obraSocialRnos || RNOS_DEFAULT_FICHA, empresasHabilitadas: f.empresasHabilitadas,
  habilitacionNumero: f.habilitacionNumero, habilitacionVencimiento: f.habilitacionVencimiento, credencialVencimiento: f.credencialVencimiento,
  aptoEstado: f.aptoEstado, aptoVencimiento: f.aptoVencimiento, observaciones: f.observaciones,
});

const hoy = () => new Date().toISOString().slice(0, 10);
const fmtFechaLista = (iso: string) => {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : '';
};

const ICONO_FILTRO: Record<string, React.ElementType> = {
  DISPONIBLE: UserCheck, NO_DISPONIBLE: UserX, VENCE: AlertTriangle, INCOMPLETOS: CircleDashed, TODOS: Users,
};

const VISTA_NOMINA: Record<string, { texto: string; tono: string }> = {
  NUEVO: { texto: 'Nuevo', tono: 'bg-emerald-50 text-emerald-800' },
  ACTUALIZAR: { texto: 'Actualiza', tono: 'bg-indigo-50 text-indigo-800' },
  SIN_CAMBIO: { texto: 'Sin cambios', tono: 'bg-slate-100 text-slate-600' },
  CUIL_INVALIDO: { texto: 'CUIL inválido', tono: 'bg-rose-50 text-rose-800' },
  DUPLICADO: { texto: 'Duplicado', tono: 'bg-rose-50 text-rose-800' },
  PLANTA_PERMANENTE: { texto: 'Planta permanente', tono: 'bg-rose-50 text-rose-800' },
  EMPRESA_DESCONOCIDA: { texto: 'Empresa desconocida', tono: 'bg-rose-50 text-rose-800' },
  MAIL_INVALIDO: { texto: 'Mail inválido', tono: 'bg-rose-50 text-rose-800' },
  SIN_NOMBRE: { texto: 'Falta el nombre', tono: 'bg-rose-50 text-rose-800' },
  FECHA_INVALIDA: { texto: 'Fecha inválida', tono: 'bg-rose-50 text-rose-800' },
};

type VistaNomina = { cuil: string; nombre: string; codigo: string; motivo: string };
type ResumenNomina = {
  nuevo: number; actualizar: number; sinCambio: number; cuilInvalido: number; duplicado: number;
  planta: number; empresaDesconocida: number; mailInvalido: number; sinNombre?: number; fechaInvalida?: number;
};

function EstadoIcono({ icon: Icon, ok, title }: { icon: React.ElementType; ok: boolean; title: string }) {
  return <span title={title} aria-label={title} className={`inline-flex h-5 w-5 items-center justify-center rounded-md ${ok ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}><Icon size={11} /></span>;
}

export default function EventualesPage() {
  const { isSuperAdmin, rolePermissions } = useAuth();
  const { empresaId: empresaActivaId, empresa: empresaActiva } = useEmpresa();
  const movil = useMovilMode();
  const acciones = rolePermissions?.EVENTUALES || [];
  const puede = (accion: string) => isSuperAdmin || acciones.includes(accion);

  const [filtro, setFiltro] = useState('DISPONIBLE');
  const [buscar, setBuscar] = useState('');
  const [mostrarArca, setMostrarArca] = useState(false);
  const [todaLaBolsa, setTodaLaBolsa] = useState(false);
  const [fichas, setFichas] = useState<Ficha[]>([]);
  const [empresas, setEmpresas] = useState<EmpresaPlataforma[]>([]);
  const [elegida, setElegida] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<Record<string, unknown> | null>(null);
  const [marcos, setMarcos] = useState<Record<string, MarcoVista>>({});
  const [documentos, setDocumentos] = useState<DocumentoVista[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [editando, setEditando] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [asignarAbierto, setAsignarAbierto] = useState(false);
  const [empresasAsignar, setEmpresasAsignar] = useState<string[]>([]);
  const [importando, setImportando] = useState(false);
  const [habilitando, setHabilitando] = useState('');
  const [reporteNomina, setReporteNomina] = useState<{
    dryRun: boolean;
    resumen: ResumenNomina;
    vista: VistaNomina[];
    filas: Record<string, unknown>[];
  } | null>(null);

  const nombreEmpresaActiva = empresaActiva?.name || empresas.find((e) => e.id === empresaActivaId)?.nombre || 'la empresa';
  const nombreEmpresa = (id: string) => empresas.find((e) => e.id === id)?.nombre || (id === empresaActivaId ? nombreEmpresaActiva : 'Empresa');

  useEffect(() => {
    getDocs(collection(db, 'empresas'))
      .then((snap) => setEmpresas(empresasPlataformaDeDocs(snap.docs.map((d) => ({ id: d.id, data: d.data() }))) as EmpresaPlataforma[]))
      .catch(() => toast.error('No se pudieron cargar las empresas de la plataforma.'));
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'eventuales_bolsa'), where('grupoId', '==', GRUPO_EVENTUALES_ID));
    return onSnapshot(q, (snap) => {
      setFichas(snap.docs.map((d) => {
        const data = d.data();
        const hab = data.habilitacion9236 || {};
        const apto = data.aptoPsicofisico || {};
        return {
          id: d.id,
          nombre: String(data.nombre || ''),
          disponibilidad: String(data.disponibilidad || 'DISPONIBLE'),
          mail: String(data.mail || ''),
          telefono: String(data.telefono || ''),
          dni: String(data.dni || ''),
          domicilio: String(data.domicilio || ''),
          empresasHabilitadas: Array.isArray(data.empresasHabilitadas) ? data.empresasHabilitadas.map(String) : [],
          habilitacionNumero: String(hab.numero || ''),
          habilitacionVencimiento: String(hab.vencimiento || ''),
          credencialVencimiento: String(data.credencialVencimiento || ''),
          aptoEstado: String(apto.estado || ''),
          aptoVencimiento: String(apto.vencimiento || ''),
          riesgoEncadenamiento: String(data.riesgoEncadenamiento || ''),
          uid: String(data.uid || ''),
          obraSocialRnos: String(data.obraSocialRnos || ''),
          fechaNacimiento: String(data.fechaNacimiento || ''),
          observaciones: String(data.observaciones || ''),
          localidad: String(data.localidad || ''),
          legajoPlanilla: String(data.legajoPlanilla || ''),
          primerIngreso: String(data.primerIngreso || ''),
          arcaHistorial: Array.isArray(data.arcaHistorial) ? data.arcaHistorial : [],
          marcos: (data.marcos && typeof data.marcos === 'object' ? data.marcos : {}) as Ficha['marcos'],
          exigirMarco: data.exigirMarco !== false,
          exigirAltaArca: data.exigirAltaArca !== false,
        };
      }));
    });
  }, []);

  const visibles = useMemo(
    () => (filtrarFichas({ fichas, empresaId: empresaActivaId, todaLaBolsa, filtro, buscar, hoy: hoy() }) as Ficha[]).sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [fichas, empresaActivaId, todaLaBolsa, filtro, buscar],
  );
  const contadores = useMemo(() => contadoresFiltros({ fichas, empresaId: empresaActivaId, todaLaBolsa, hoy: hoy() }) as Record<string, number>, [fichas, empresaActivaId, todaLaBolsa]);

  const llamar = async (nombre: string, data: Record<string, unknown>) => {
    const fn = httpsCallable(functions, nombre);
    const res = await fn(data);
    return res.data as Record<string, unknown>;
  };

  const abrirDetalle = async (id: string) => {
    setElegida(id);
    setDetalle(null);
    try {
      setDetalle(await llamar('gestionarEventual', { accion: 'detalle', cuil: id }));
      const lista = await llamar('gestionarMarcoEventual', { accion: 'listar', cuil: id }) as { marcos?: (MarcoVista & { empresaId: string })[]; documentos?: DocumentoVista[] };
      const map: Record<string, MarcoVista> = {};
      (lista.marcos || []).forEach((row) => { map[row.empresaId] = row; });
      setMarcos(map);
      setDocumentos(lista.documentos || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo abrir la ficha.');
    }
  };

  const guardar = async () => {
    if (!form) return;
    setGuardando(true);
    try {
      await llamar('gestionarEventual', { accion: editando ? 'editar' : 'crear', cuilAnterior: editando, ...form });
      toast.success(editando ? 'Ficha actualizada.' : 'Alta en la bolsa.');
      setForm(null);
      setEditando('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setGuardando(false);
    }
  };

  const ubicar = async () => {
    if (!form?.domicilio.trim()) return;
    const { geocodeAddress } = await import('@/lib/employees/geocodeAddress');
    const geo = await geocodeAddress(form.domicilio.trim());
    if (!geo) { toast.error('No se ubicó el domicilio.'); return; }
    setForm({ ...form, domicilioGeo: geo, domicilio: geo.display_name || form.domicilio });
    toast.success('Domicilio ubicado.');
  };

  const darBaja = async (motivo: string, fecha: string) => {
    if (!elegida) return;
    try {
      await llamar('gestionarEventual', { accion: 'baja', cuil: elegida, motivo, fecha });
      toast.success('Baja de la bolsa. Los documentos quedan.');
      abrirDetalle(elegida);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo dar de baja.');
    }
  };

  const reactivar = async () => {
    if (!elegida) return;
    try {
      await llamar('gestionarEventual', { accion: 'reactivar', cuil: elegida });
      toast.success('Volvió a la bolsa.');
      abrirDetalle(elegida);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo reactivar.');
    }
  };

  const acceso = async () => {
    if (!elegida) return;
    try {
      const res = await llamar('crearAccesoEventual', { cuil: elegida });
      toast.success(`Acceso creado. Link de activación: ${String(res.activacion || '')}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo crear el acceso.');
    }
  };

  const habilitarEnActiva = async (cuil: string) => {
    setHabilitando(cuil);
    try {
      await llamar('gestionarEventual', { accion: 'habilitarEmpresa', cuil, empresaId: empresaActivaId, habilitar: true });
      toast.success(`Habilitado en ${nombreEmpresaActiva}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo habilitar.');
    } finally {
      setHabilitando('');
    }
  };

  const descargarPlantillaNomina = async () => {
    const XLSX = await import('xlsx');
    const plantilla = plantillaNomina();
    const wb = XLSX.utils.book_new();
    const datos = [plantilla.encabezados, plantilla.encabezados.map((h) => plantilla.ejemplo[h] ?? '')];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(datos), plantilla.hoja);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(plantilla.instrucciones), 'Instrucciones');
    XLSX.writeFile(wb, 'nomina-eventuales.xlsx');
  };

  const importarNomina = async (file: File | null, dryRun: boolean, filasYaLeidas?: Record<string, unknown>[]) => {
    setImportando(true);
    try {
      let filas = filasYaLeidas;
      if (!filas && file) {
        const XLSX = await import('xlsx');
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const nombre = wb.SheetNames.find((n) => n.toLowerCase() !== 'instrucciones') || wb.SheetNames[0];
        filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[nombre], { defval: '', raw: false });
      }
      const res = await llamar('gestionarEventual', { accion: 'importarContacto', dryRun, filas: filas || [] }) as {
        resumen: ResumenNomina;
        vista: VistaNomina[];
      };
      setReporteNomina({ dryRun, resumen: res.resumen, vista: res.vista || [], filas: filas || [] });
      if (!dryRun) toast.success(`${res.resumen.nuevo || 0} nuevos y ${res.resumen.actualizar || 0} actualizados.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo leer el Excel.');
    } finally {
      setImportando(false);
    }
  };

  const confirmarAsignar = async () => {
    try {
      const res = await llamar('gestionarEventual', { accion: 'asignarEmpresas', cuils: seleccion, empresasHabilitadas: empresasAsignar }) as { asignados?: number };
      toast.success(`${res.asignados || 0} fichas con empresas habilitadas.`);
      setAsignarAbierto(false);
      setSeleccion([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudieron asignar las empresas.');
    }
  };

  const ficha = fichas.find((f) => f.id === elegida) || null;

  if (movil) {
    return (
      <>
        <Head><title>Eventuales | COSP V1.0</title></Head>
        {puede('read') ? <EventualesMovil /> : <p className="p-6 text-sm font-semibold text-slate-600">No tenés permiso para ver Eventuales.</p>}
      </>
    );
  }

  if (!puede('read')) {
    return <DashboardLayout><p className="p-8 text-slate-600">No tenés permiso para ver Eventuales. Lo asigna Configuración → Roles.</p></DashboardLayout>;
  }

  return (
    <DashboardLayout>
      <Head><title>Eventuales | COSP V1.0</title></Head>
      <PageShell className="!pb-10">
        <div className="mx-auto max-w-7xl space-y-4">
          <Link href="/admin/rrhh" className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-700"><ArrowLeft size={14} /> RRHH</Link>
          <PageHeader
            title="Eventuales"
            subtitle={todaLaBolsa ? 'Toda la bolsa del grupo' : `Habilitados para ${nombreEmpresaActiva}`}
            icon={Users}
            className="!mb-2"
            actions={(
              <div className="flex flex-wrap items-center gap-2">
                {puede('create') && (
                  <button type="button" onClick={() => { setEditando(''); setForm({ ...vacio(), empresasHabilitadas: empresaActivaId ? [empresaActivaId] : [] }); }} title="Alta en la bolsa" aria-label="Alta en la bolsa"
                    className="inline-flex h-9 items-center gap-1 rounded-xl bg-indigo-600 px-3 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 active:scale-95">
                    <Plus size={16} /> Alta
                  </button>
                )}
                {puede('update') && (
                  <button type="button" title="Importar nómina de eventuales" aria-label="Importar nómina de eventuales" onClick={() => setReporteNomina({ dryRun: true, resumen: { nuevo: 0, actualizar: 0, sinCambio: 0, cuilInvalido: 0, duplicado: 0, planta: 0, empresaDesconocida: 0, mailInvalido: 0 }, vista: [], filas: [] })}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50">
                    <FileSpreadsheet size={16} />
                  </button>
                )}
                <MarcosLotePanel compacto empresaId={empresaActivaId} nombreEmpresa={nombreEmpresaActiva} fichas={fichas} seleccionados={seleccion} puedeEditar={puede('update')} llamar={llamar} />
                <button
                  type="button"
                  onClick={() => setMostrarArca((v) => !v)}
                  title="Altas, bajas y anulaciones de ARCA"
                  className={`inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-xs font-semibold shadow-sm ${mostrarArca ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
                  <Landmark size={16} />
                  ARCA pendientes
                </button>
              </div>
            )}
          />

          {mostrarArca ? (
            <ArcaPendientesPanel empresaId={empresaActivaId} empresaNombre={nombreEmpresaActiva} puedeConfirmar={puede('update')} />
          ) : (
          <>
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
            <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
              <Search size={14} className="text-slate-400" />
              <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Nombre, CUIL o DNI" className="w-full bg-transparent text-sm outline-none" />
              {buscar && <button type="button" onClick={() => setBuscar('')} aria-label="Limpiar búsqueda" className="text-slate-400"><X size={14} /></button>}
            </label>
            <div className="flex flex-wrap gap-1">
              {FILTROS_LISTA.map((f) => {
                const Icon = ICONO_FILTRO[f.id] || Users;
                const on = filtro === f.id;
                return (
                  <button key={f.id} type="button" onClick={() => setFiltro(f.id)} title={f.label}
                    className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[11px] font-bold transition ${on ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>
                    <Icon size={12} /> <span className="hidden sm:inline">{f.label}</span>
                    <span className={`rounded-full px-1.5 text-[9px] font-black ${on ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>{contadores[f.id] ?? 0}</span>
                  </button>
                );
              })}
            </div>
            <label className="ml-auto inline-flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-[11px] font-bold text-slate-600" title="Ver a todos los eventuales del grupo, aunque no estén habilitados en esta empresa">
              <span className={`relative h-5 w-9 rounded-full transition ${todaLaBolsa ? 'bg-indigo-600' : 'bg-slate-300'}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${todaLaBolsa ? 'left-[18px]' : 'left-0.5'}`} />
              </span>
              <input type="checkbox" className="hidden" checked={todaLaBolsa} onChange={(e) => setTodaLaBolsa(e.target.checked)} />
              Toda la bolsa del grupo
            </label>
          </div>

          {seleccion.length > 0 && puede('update') && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-800">
              {seleccion.length} seleccionados
              <button type="button" onClick={() => { setEmpresasAsignar([empresaActivaId].filter(Boolean)); setAsignarAbierto(true); }} className="inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-3 py-1.5 text-white shadow-sm"><Building2 size={13} /> Asignar empresas habilitadas</button>
              <button type="button" onClick={() => setSeleccion([])} className="ml-auto inline-flex items-center gap-1 text-indigo-600"><X size={13} /> Quitar selección</button>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
            <ul className={`max-h-[72vh] overflow-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm ${elegida ? 'hidden lg:block' : ''}`}>
              {visibles.map((f) => {
                const faltan = faltantesConvocable(f, hoy(), todaLaBolsa ? '' : empresaActivaId) as { id: string; texto: string }[];
                const marcoActiva = marcoDeBolsa(f, empresaActivaId, hoy());
                const habilitadaAca = f.empresasHabilitadas.includes(empresaActivaId);
                const activo = elegida === f.id;
                return (
                  <li key={f.id} className={`flex items-center gap-2 rounded-xl px-2 py-1.5 transition ${activo ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                    {puede('update') && (
                      <input type="checkbox" checked={seleccion.includes(f.id)} title="Seleccionar" aria-label={`Seleccionar a ${f.nombre}`}
                        onChange={(e) => setSeleccion(e.target.checked ? [...seleccion, f.id] : seleccion.filter((id) => id !== f.id))}
                        className="h-4 w-4 shrink-0 rounded border-slate-300 accent-indigo-600" />
                    )}
                    <button type="button" onClick={() => abrirDetalle(f.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-black ${f.disponibilidad === 'NO_DISPONIBLE' ? 'bg-slate-200 text-slate-500' : 'bg-indigo-100 text-indigo-700'}`}>{iniciales(f.nombre)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-slate-800">{f.nombre || f.id}</span>
                        <span className="flex flex-wrap items-center gap-1 text-[10px] text-slate-400">
                          <span className="tabular-nums">{f.id}</span>
                          {textoLegajo(f.legajoPlanilla) && <span className="font-bold text-slate-500">{textoLegajo(f.legajoPlanilla)}</span>}
                          {f.primerIngreso && <span>1º {fmtFechaLista(f.primerIngreso)}</span>}
                          {f.disponibilidad === 'NO_DISPONIBLE' && <span className="rounded-full bg-slate-200 px-1.5 font-black text-slate-600">{textoDisponibilidad(f.disponibilidad)}</span>}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1">
                          <EstadoIcono icon={Mail} ok={!!f.mail} title={f.mail ? `Mail: ${f.mail}` : 'Falta mail'} />
                          <EstadoIcono icon={Phone} ok={!!f.telefono} title={f.telefono ? `Teléfono: ${f.telefono}` : 'Falta teléfono'} />
                          <EstadoIcono icon={Home} ok={!!f.domicilio} title={f.domicilio ? `Domicilio: ${f.domicilio}` : 'Falta domicilio'} />
                          {habilitadaAca && (marcoActiva.estado === 'MARCO_VIGENTE'
                            ? <EstadoIcono icon={FileCheck2} ok title={`Marco vigente en ${nombreEmpresaActiva}`} />
                            : <EstadoIcono icon={FileX2} ok={false} title={marcoActiva.estado === 'VENCIDO' ? `Marco vencido en ${nombreEmpresaActiva}` : `Sin contrato marco en ${nombreEmpresaActiva}`} />)}
                          {f.empresasHabilitadas.map((id) => (
                            <span key={id} title={`Habilitado en ${nombreEmpresa(id)}`} className={`rounded-md px-1.5 py-0.5 text-[9px] font-black ${id === empresaActivaId ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{siglaEmpresa(nombreEmpresa(id))}</span>
                          ))}
                          {f.empresasHabilitadas.length === 0 && <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[9px] font-black text-amber-700" title="Sin empresa habilitada">Sin empresa</span>}
                          {faltan.some((c) => c.id === 'CREDENCIAL' || c.id === 'APTO') && <span title={faltan.filter((c) => c.id === 'CREDENCIAL' || c.id === 'APTO').map((c) => c.texto).join(', ')} className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-rose-50 text-rose-600"><AlertTriangle size={11} /></span>}
                        </span>
                      </span>
                    </button>
                    {todaLaBolsa && !habilitadaAca && puede('update') && (
                      <button type="button" onClick={() => habilitarEnActiva(f.id)} disabled={habilitando === f.id} title={`Habilitar en ${nombreEmpresaActiva}`} aria-label={`Habilitar en ${nombreEmpresaActiva}`}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-indigo-200 bg-white text-indigo-600 shadow-sm hover:bg-indigo-50 disabled:opacity-50">
                        <UserPlus size={14} />
                      </button>
                    )}
                  </li>
                );
              })}
              {visibles.length === 0 && (
                <li className="p-6 text-center text-xs text-slate-400">
                  {todaLaBolsa ? 'Nadie en la bolsa cumple ese filtro.' : `Nadie habilitado en ${nombreEmpresaActiva} cumple ese filtro. Probá «Toda la bolsa del grupo».`}
                </li>
              )}
            </ul>

            <div className={!elegida ? 'hidden lg:block' : ''}>
              {!ficha && <div className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-400">Elegí una persona de la lista.</div>}
              {ficha && (
                <FichaEventual
                  ficha={ficha}
                  detalle={detalle}
                  marcos={marcos}
                  documentos={documentos}
                  empresas={empresas}
                  empresaActivaId={empresaActivaId}
                  puede={puede}
                  llamar={llamar}
                  recargar={() => abrirDetalle(ficha.id)}
                  onEditar={() => { setEditando(ficha.id); setForm(formDe(ficha)); }}
                  onAcceso={acceso}
                  onBaja={darBaja}
                  onReactivar={reactivar}
                  onVolver={() => setElegida(null)}
                />
              )}
            </div>
          </div>
          </>
          )}
        </div>

        {asignarAbierto && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-lg">
              <h2 className="flex items-center gap-2 text-lg font-black text-slate-800"><Building2 size={18} /> Empresas habilitadas</h2>
              <p className="mt-1 text-xs text-slate-500">{seleccion.length} personas. Reemplaza las empresas que tenían habilitadas.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {empresas.map((e) => {
                  const on = empresasAsignar.includes(e.id);
                  return (
                    <button key={e.id} type="button" onClick={() => setEmpresasAsignar(on ? empresasAsignar.filter((x) => x !== e.id) : [...empresasAsignar, e.id])}
                      className={`rounded-full border px-3 py-1.5 text-xs font-bold ${on ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>{e.nombre}</button>
                  );
                })}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setAsignarAbierto(false)} className="rounded-xl px-3 py-2 text-sm text-slate-500">Cancelar</button>
                <button type="button" onClick={confirmarAsignar} disabled={!empresasAsignar.length} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Asignar</button>
              </div>
            </div>
          </div>
        )}

        {reporteNomina && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
            <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-5 shadow-lg">
              <h2 className="flex items-center gap-2 text-lg font-black text-slate-800"><FileSpreadsheet size={18} /> Importar nómina de eventuales</h2>
              <p className="mt-1 text-xs text-slate-500">Nada se escribe hasta Aplicar. Una celda vacía no borra el dato que ya está.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => void descargarPlantillaNomina()} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50">
                  <Download size={14} /> Descargar plantilla
                </button>
                <label className="inline-flex cursor-pointer items-center gap-1 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-indigo-700">
                  <FileSpreadsheet size={14} /> {importando ? 'Leyendo…' : 'Elegir archivo'}
                  <input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={importando} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importarNomina(f, true); }} />
                </label>
              </div>
              {reporteNomina.filas.length > 0 && (
                <>
                  <ul className="mt-3 grid grid-cols-2 gap-1 text-sm text-slate-700 sm:grid-cols-4">
                    <li className="rounded-xl bg-emerald-50 p-2 text-center"><b className="block text-lg text-emerald-700">{reporteNomina.resumen.nuevo || 0}</b>nuevos</li>
                    <li className="rounded-xl bg-indigo-50 p-2 text-center"><b className="block text-lg text-indigo-700">{reporteNomina.resumen.actualizar || 0}</b>actualizan</li>
                    <li className="rounded-xl bg-slate-50 p-2 text-center"><b className="block text-lg">{reporteNomina.resumen.sinCambio || 0}</b>sin cambios</li>
                    <li className="rounded-xl bg-rose-50 p-2 text-center"><b className="block text-lg text-rose-700">{(reporteNomina.resumen.cuilInvalido || 0) + (reporteNomina.resumen.duplicado || 0) + (reporteNomina.resumen.planta || 0) + (reporteNomina.resumen.empresaDesconocida || 0) + (reporteNomina.resumen.mailInvalido || 0) + (reporteNomina.resumen.sinNombre || 0) + (reporteNomina.resumen.fechaInvalida || 0)}</b>con error</li>
                  </ul>
                  <ul className="mt-3 max-h-52 overflow-auto divide-y divide-slate-100 rounded-xl border border-slate-100 text-xs">
                    {reporteNomina.vista.map((row, i) => {
                      const vista = VISTA_NOMINA[row.codigo] || { texto: row.codigo, tono: 'bg-slate-100 text-slate-600' };
                      return (
                        <li key={`${row.cuil}_${i}`} className="flex items-center gap-2 px-2 py-1.5">
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${vista.tono}`}>{vista.texto}</span>
                          <span className="min-w-0 flex-1 truncate text-slate-700">{row.nombre || row.cuil || '—'}{row.motivo ? ` · ${row.motivo}` : ''}</span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setReporteNomina(null)} className="rounded-xl px-3 py-2 text-sm text-slate-500">Cerrar</button>
                {reporteNomina.dryRun && ((reporteNomina.resumen.nuevo || 0) + (reporteNomina.resumen.actualizar || 0)) > 0 && (
                  <button type="button" disabled={importando} onClick={() => importarNomina(null, false, reporteNomina.filas)} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Aplicar</button>
                )}
              </div>
            </div>
          </div>
        )}

        {form && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
            <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-2xl bg-white p-5 shadow-lg">
              <h2 className="mb-3 flex items-center gap-2 text-lg font-black text-slate-800"><UserPlus size={18} /> {editando ? 'Editar ficha' : 'Alta en la bolsa'}</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {([
                  ['nombre', 'Nombre'], ['cuil', 'CUIL'], ['dni', 'DNI'], ['fechaNacimiento', 'Nacimiento'],
                  ['telefono', 'Teléfono'], ['mail', 'Mail'], ['obraSocialRnos', 'Obra social (RNOS)'],
                  ['habilitacionNumero', 'Habilitación 9236'], ['habilitacionVencimiento', 'Vence habilitación'],
                  ['credencialVencimiento', 'Vence credencial'], ['aptoEstado', 'Apto'], ['aptoVencimiento', 'Vence apto'],
                ] as const).map(([key, label]) => (
                  <label key={key} className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}
                    <input type={key.toLowerCase().includes('vencimiento') || key === 'fechaNacimiento' ? 'date' : 'text'} value={String(form[key] || '')} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 px-2 py-1.5 text-sm font-normal normal-case text-slate-800" />
                  </label>
                ))}
              </div>
              <label className="mt-2 block text-[10px] font-black uppercase tracking-wider text-slate-400">Domicilio
                <div className="mt-1 flex gap-2">
                  <input value={form.domicilio} onChange={(e) => setForm({ ...form, domicilio: e.target.value })} className="w-full rounded-xl border border-slate-200 px-2 py-1.5 text-sm font-normal normal-case text-slate-800" />
                  <button type="button" onClick={ubicar} title="Ubicar en el mapa" className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2 text-xs font-bold text-slate-600"><MapPin size={14} /></button>
                </div>
              </label>
              <p className="mt-3 text-[10px] font-black uppercase tracking-wider text-slate-400">Empresas habilitadas</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {empresas.map((e) => {
                  const on = form.empresasHabilitadas.includes(e.id);
                  return (
                    <button key={e.id} type="button" onClick={() => setForm({ ...form, empresasHabilitadas: on ? form.empresasHabilitadas.filter((x) => x !== e.id) : [...form.empresasHabilitadas, e.id] })}
                      className={`rounded-full border px-3 py-1.5 text-xs font-bold ${on ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>{e.nombre}</button>
                  );
                })}
              </div>
              <label className="mt-3 block text-[10px] font-black uppercase tracking-wider text-slate-400">Observaciones
                <textarea value={form.observaciones} onChange={(e) => setForm({ ...form, observaciones: e.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 px-2 py-1.5 text-sm font-normal normal-case text-slate-800" rows={2} />
              </label>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setForm(null)} className="rounded-xl px-3 py-2 text-sm text-slate-500">Cancelar</button>
                <button type="button" disabled={guardando} onClick={guardar} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{guardando ? 'Guardando…' : 'Guardar'}</button>
              </div>
            </div>
          </div>
        )}
      </PageShell>
    </DashboardLayout>
  );
}
