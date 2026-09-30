import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ArrowLeft, MapPin, Plus, Users } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/context/AuthContext';
import { db, functions } from '@/lib/firebase';
import { GRUPO_EVENTUALES_EMPRESA_IDS, GRUPO_EVENTUALES_ID } from '@/lib/eventuales/grupo.mjs';
import { RNOS_DEFAULT_FICHA, vencePronto } from '@/lib/eventuales/ficha.mjs';

type Ficha = {
  id: string;
  nombre: string;
  disponibilidad: string;
  mail: string;
  telefono: string;
  dni: string;
  domicilio: string;
  empresasHabilitadas: string[];
  habilitacionVencimiento: string;
  credencialVencimiento: string;
  aptoVencimiento: string;
  riesgoEncadenamiento: string;
  uid: string;
  obraSocialRnos: string;
};

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

const fmt = (iso?: string) => {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
};

const hoy = () => new Date().toISOString().slice(0, 10);

export default function EventualesPage() {
  const { isSuperAdmin, rolePermissions } = useAuth();
  const acciones = rolePermissions?.EVENTUALES || [];
  const puede = (accion: string) => isSuperAdmin || acciones.includes(accion);
  const [filtro, setFiltro] = useState('DISPONIBLE');
  const [empresa, setEmpresa] = useState('');
  const [buscar, setBuscar] = useState('');
  const [fichas, setFichas] = useState<Ficha[]>([]);
  const [elegida, setElegida] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [editando, setEditando] = useState('');
  const [baja, setBaja] = useState({ motivo: '', fecha: hoy() });
  const [guardando, setGuardando] = useState(false);

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
          disponibilidad: String(data.disponibilidad || ''),
          mail: String(data.mail || ''),
          telefono: String(data.telefono || ''),
          dni: String(data.dni || ''),
          domicilio: String(data.domicilio || ''),
          empresasHabilitadas: Array.isArray(data.empresasHabilitadas) ? data.empresasHabilitadas.map(String) : [],
          habilitacionVencimiento: String(hab.vencimiento || ''),
          credencialVencimiento: String(data.credencialVencimiento || ''),
          aptoVencimiento: String(apto.vencimiento || ''),
          riesgoEncadenamiento: String(data.riesgoEncadenamiento || ''),
          uid: String(data.uid || ''),
          obraSocialRnos: String(data.obraSocialRnos || ''),
        };
      }));
    });
  }, []);

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return fichas.filter((f) => {
      if (filtro === 'DISPONIBLE' && f.disponibilidad !== 'DISPONIBLE') return false;
      if (filtro === 'NO_DISPONIBLE' && f.disponibilidad !== 'NO_DISPONIBLE') return false;
      if (filtro === 'VENCE' && ![f.habilitacionVencimiento, f.credencialVencimiento, f.aptoVencimiento].some((fecha) => vencePronto(fecha, hoy()))) return false;
      if (empresa && !f.empresasHabilitadas.includes(empresa)) return false;
      if (q && !`${f.nombre} ${f.id} ${f.dni}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [fichas, filtro, empresa, buscar]);

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

  const confirmarBaja = async () => {
    if (!elegida) return;
    try {
      await llamar('gestionarEventual', { accion: 'baja', cuil: elegida, motivo: baja.motivo, fecha: baja.fecha });
      toast.success('Baja de la bolsa. El documento queda.');
      setBaja({ motivo: '', fecha: hoy() });
      abrirDetalle(elegida);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo dar de baja.');
    }
  };

  const reactivar = async () => {
    if (!elegida) return;
    await llamar('gestionarEventual', { accion: 'reactivar', cuil: elegida });
    toast.success('Volvió a la bolsa.');
    abrirDetalle(elegida);
  };

  const acceso = async () => {
    if (!elegida) return;
    const res = await llamar('crearAccesoEventual', { cuil: elegida });
    toast.success(`Acceso creado. ${String(res.activacion || '')}`);
  };

  const ficha = fichas.find((f) => f.id === elegida) || null;
  const contratos = (detalle?.contratos as { id: string; empresaId?: string; estado?: string; fechaAlta?: string; fechaBaja?: string; jornadas?: { fecha: string; horaInicio: string; horaFin: string; horas: number }[] }[]) || [];
  const arca = (detalle?.arca as { id: string; tipo?: string; estado?: string; fechaAlta?: string; nroTransaccion?: string; advertencias?: string[]; enviable?: boolean }[]) || [];
  const historial = (detalle?.historial as { id: string; action?: string; details?: string; at?: string }[]) || [];

  if (!puede('read')) {
    return <DashboardLayout><p className="p-8 text-slate-600">No tenés permiso para ver Eventuales. Lo asigna Configuración → Roles.</p></DashboardLayout>;
  }

  return (
    <DashboardLayout>
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl">
        <Link href="/admin/rrhh" className="mb-4 inline-flex items-center gap-2 text-sm text-slate-500"><ArrowLeft size={16} /> RRHH</Link>
        <div className="mb-4 flex items-center justify-between">
          <h1 className="flex items-center gap-2 text-2xl font-black text-slate-800"><Users /> Eventuales</h1>
          {puede('create') && <button type="button" onClick={() => { setEditando(''); setForm(vacio()); }} className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow-sm"><Plus size={16} /> Alta</button>}
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Nombre, CUIL o DNI" className="rounded-2xl border border-slate-200 px-3 py-2 text-sm shadow-sm" />
          {['DISPONIBLE', 'NO_DISPONIBLE', 'VENCE', 'TODOS'].map((op) => (
            <button key={op} type="button" onClick={() => setFiltro(op)} className={`rounded-2xl px-3 py-2 text-xs font-bold ${filtro === op ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 shadow-sm'}`}>{op === 'VENCE' ? 'Vencen en 30 días' : op}</button>
          ))}
          <select value={empresa} onChange={(e) => setEmpresa(e.target.value)} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm shadow-sm">
            <option value="">Todas las empresas</option>
            {GRUPO_EVENTUALES_EMPRESA_IDS.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        </div>
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <ul className="max-h-[70vh] overflow-auto rounded-3xl bg-white p-2 shadow-sm">
            {visibles.map((f) => (
              <li key={f.id}>
                <button type="button" onClick={() => abrirDetalle(f.id)} className={`w-full rounded-2xl px-3 py-2 text-left hover:bg-slate-50 ${elegida === f.id ? 'bg-indigo-50' : ''}`}>
                  <span className="block text-sm font-bold text-slate-800">{f.nombre || f.id}</span>
                  <span className="text-[11px] text-slate-500">{f.disponibilidad} · {f.empresasHabilitadas.join(', ') || 'sin empresa'}</span>
                </button>
              </li>
            ))}
            {visibles.length === 0 && <li className="p-4 text-sm text-slate-400">Sin resultados.</li>}
          </ul>
          <section className="rounded-3xl bg-white p-5 shadow-sm">
            {!ficha && <p className="text-sm text-slate-400">Elegí una persona de la bolsa.</p>}
            {ficha && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-black text-slate-800">{ficha.nombre}</h2>
                    <p className="text-xs text-slate-500">CUIL {ficha.id} · DNI {ficha.dni || '—'} · {ficha.disponibilidad}{ficha.uid ? ' · con acceso a la app' : ''}</p>
                    <p className="text-xs text-slate-500">{ficha.domicilio || 'Sin domicilio'} · {ficha.telefono || 'sin teléfono'} · {ficha.mail || 'sin mail'}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {puede('update') && <button type="button" className="rounded-2xl bg-slate-100 px-3 py-2 text-xs font-bold" onClick={() => { setEditando(ficha.id); setForm({ ...vacio(), nombre: ficha.nombre, cuil: ficha.id, dni: ficha.dni, domicilio: ficha.domicilio, telefono: ficha.telefono, mail: ficha.mail, obraSocialRnos: ficha.obraSocialRnos || RNOS_DEFAULT_FICHA, empresasHabilitadas: ficha.empresasHabilitadas, habilitacionVencimiento: ficha.habilitacionVencimiento, credencialVencimiento: ficha.credencialVencimiento, aptoVencimiento: ficha.aptoVencimiento }); }}>Editar</button>}
                    {puede('update') && <button type="button" className="rounded-2xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white" onClick={acceso}>Crear acceso a la app</button>}
                    {puede('update') && ficha.disponibilidad === 'NO_DISPONIBLE' && <button type="button" className="rounded-2xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white" onClick={reactivar}>Reactivar</button>}
                  </div>
                </div>
                {!ficha.obraSocialRnos && !(detalle?.rnos as { pendiente?: boolean } | undefined)?.pendiente && <p className="text-sm text-slate-500">Sin RNOS propio: se usa el de SUVICO {RNOS_DEFAULT_FICHA}.</p>}
                {(detalle?.rnos as { pendiente?: boolean } | undefined)?.pendiente && <p className="text-sm font-bold text-rose-600">RNOS pendiente. El alta ARCA no se puede enviar.</p>}
                {!!(detalle?.rnos as { sugerido?: boolean; sugerencia?: string; empresaId?: string } | undefined)?.sugerido && (
                  <p className="text-sm text-slate-600">En {(detalle?.rnos as { empresaId: string }).empresaId} tiene RNOS {(detalle?.rnos as { sugerencia: string }).sugerencia}.
                    {puede('update') && <button type="button" className="ml-2 underline" onClick={() => { setEditando(ficha.id); setForm({ ...vacio(), nombre: ficha.nombre, cuil: ficha.id, mail: ficha.mail, telefono: ficha.telefono, dni: ficha.dni, domicilio: ficha.domicilio, empresasHabilitadas: ficha.empresasHabilitadas, obraSocialRnos: (detalle?.rnos as { sugerencia: string }).sugerencia }); }}>Usar esa</button>}
                  </p>
                )}
                <p className="text-sm text-slate-700">Encadenamiento: {ficha.riesgoEncadenamiento || 'sin alerta'}. Habilitación {fmt(ficha.habilitacionVencimiento)} · credencial {fmt(ficha.credencialVencimiento)} · apto {fmt(ficha.aptoVencimiento)}.</p>
                {puede('delete') && ficha.disponibilidad !== 'NO_DISPONIBLE' && (
                  <div className="flex flex-wrap gap-2 rounded-2xl bg-slate-50 p-3">
                    <input value={baja.motivo} onChange={(e) => setBaja({ ...baja, motivo: e.target.value })} placeholder="Motivo de baja" className="rounded-xl border px-2 py-1 text-sm" />
                    <input type="date" value={baja.fecha} onChange={(e) => setBaja({ ...baja, fecha: e.target.value })} className="rounded-xl border px-2 py-1 text-sm" />
                    <button type="button" onClick={confirmarBaja} className="rounded-xl bg-rose-600 px-3 py-1 text-xs font-bold text-white">Dar de baja de la bolsa</button>
                  </div>
                )}
                <div>
                  <h3 className="text-sm font-black text-slate-700">Contratos y jornadas</h3>
                  {contratos.length === 0 && <p className="text-xs text-slate-400">Sin contratos.</p>}
                  {contratos.map((c) => (
                    <div key={c.id} className="mt-2 rounded-2xl border border-slate-100 p-3 text-xs text-slate-600">
                      <p className="font-bold">{c.empresaId} · {c.estado} · {fmt(c.fechaAlta)} → {fmt(c.fechaBaja)}</p>
                      {(c.jornadas || []).map((j, i) => <p key={i}>{fmt(j.fecha)} {j.horaInicio}–{j.horaFin} ({j.horas} h)</p>)}
                    </div>
                  ))}
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-700">ARCA</h3>
                  {arca.length === 0 && <p className="text-xs text-slate-400">Sin altas ni bajas.</p>}
                  {arca.map((a) => (
                    <p key={a.id} className="text-xs text-slate-600">
                      {a.tipo} · {a.estado} · {fmt(a.fechaAlta)} {a.nroTransaccion ? `· ${a.nroTransaccion}` : ''}
                      {(a.advertencias || []).includes('RETRIBUCION_PENDIENTE') && (
                        <span className="ml-1 font-bold text-amber-700">RETRIBUCION_PENDIENTE — no enviable hasta aprobar la escala</span>
                      )}
                    </p>
                  ))}
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-700">Historial</h3>
                  {historial.map((h) => <p key={h.id} className="text-xs text-slate-500">{h.action} · {h.details} · {h.at ? fmt(h.at) : ''}</p>)}
                </div>
              </div>
            )}
          </section>
        </div>
        {form && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
            <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-3xl bg-white p-5 shadow-lg">
              <h2 className="mb-3 text-lg font-black">{editando ? 'Editar ficha' : 'Alta en la bolsa'}</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {([
                  ['nombre', 'Nombre'], ['cuil', 'CUIL'], ['dni', 'DNI'], ['fechaNacimiento', 'Nacimiento'],
                  ['telefono', 'Teléfono'], ['mail', 'Mail'], ['obraSocialRnos', 'Obra social RNOS'],
                  ['habilitacionNumero', 'Habilitación 9236'], ['habilitacionVencimiento', 'Vence habilitación'],
                  ['credencialVencimiento', 'Vence credencial'], ['aptoEstado', 'Apto'], ['aptoVencimiento', 'Vence apto'],
                ] as const).map(([key, label]) => (
                  <label key={key} className="text-xs font-bold text-slate-500">{label}
                    <input value={String(form[key] || '')} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className="mt-1 w-full rounded-xl border px-2 py-1 text-sm font-normal text-slate-800" />
                  </label>
                ))}
              </div>
              <label className="mt-2 block text-xs font-bold text-slate-500">Domicilio
                <div className="mt-1 flex gap-2">
                  <input value={form.domicilio} onChange={(e) => setForm({ ...form, domicilio: e.target.value })} className="w-full rounded-xl border px-2 py-1 text-sm font-normal" />
                  <button type="button" onClick={ubicar} className="inline-flex items-center gap-1 rounded-xl bg-slate-100 px-2 text-xs"><MapPin size={14} /> Ubicar</button>
                </div>
              </label>
              <div className="mt-2 flex gap-3 text-xs">
                {GRUPO_EVENTUALES_EMPRESA_IDS.map((id) => (
                  <label key={id} className="flex items-center gap-1">
                    <input type="checkbox" checked={form.empresasHabilitadas.includes(id)} onChange={(e) => setForm({ ...form, empresasHabilitadas: e.target.checked ? [...form.empresasHabilitadas, id] : form.empresasHabilitadas.filter((x) => x !== id) })} />
                    {id}
                  </label>
                ))}
              </div>
              <label className="mt-2 block text-xs font-bold text-slate-500">Observaciones
                <textarea value={form.observaciones} onChange={(e) => setForm({ ...form, observaciones: e.target.value })} className="mt-1 w-full rounded-xl border px-2 py-1 text-sm font-normal" rows={2} />
              </label>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setForm(null)} className="rounded-2xl px-3 py-2 text-sm text-slate-500">Cancelar</button>
                <button type="button" disabled={guardando} onClick={guardar} className="rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white">{guardando ? 'Guardando…' : 'Guardar'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
    </DashboardLayout>
  );
}
