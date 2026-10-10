import React, { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { buscarLegajosExistentes, confirmarAltaLegajo, type AltaHecha } from '@/lib/rrhh/altaLegajoClient';
import {
  buscarEnPadron,
  decidirAlta,
  filasDesdeHoja,
  formDesdeFila,
  formVacio,
  padronEnSesion,
  recordarPadron,
  type AltaForm,
  type DecisionAlta,
  type FilaPadron,
} from '@/lib/planificacion/padronAlta';

export type PedidoAlta = {
  nombre: string;
  legajo: string;
  empresaId: string;
  empresaNombre: string;
  objectiveId: string;
  clientId: string;
};

type Props = {
  pedido: PedidoAlta;
  onCerrar: () => void;
  onCreado: (empleado: AltaHecha) => void;
};

function leerHoja(buf: ArrayBuffer): FilaPadron[] {
  const wb = XLSX.read(buf, { type: 'array', cellDates: false });
  const name = wb.SheetNames.find((n) => n.toUpperCase() === 'SP') || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' }) as unknown[][];
  return filasDesdeHoja(rows);
}

const inputCls = 'w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-[12px] text-slate-800';

export function AltaDesdePadronModal({ pedido, onCerrar, onCreado }: Props) {
  const ctx = { empresaId: pedido.empresaId, objectiveId: pedido.objectiveId, clientId: pedido.clientId };
  const [padron, setPadron] = useState<FilaPadron[] | null>(() => padronEnSesion());
  const [form, setForm] = useState<AltaForm | null>(null);
  const [enPadron, setEnPadron] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [decision, setDecision] = useState<DecisionAlta | null>(null);

  useEffect(() => {
    if (!padron) return;
    const hit = buscarEnPadron(padron, { legajo: pedido.legajo, nombre: pedido.nombre });
    setEnPadron(!!hit);
    setForm(hit ? formDesdeFila(hit.fila, ctx) : formVacio(pedido.nombre, pedido.legajo, ctx));
    // El padrón de la sesión no cambia mientras el modal está abierto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [padron, pedido.nombre, pedido.legajo]);

  const set = (k: keyof AltaForm, v: string) => setForm((prev) => (prev ? { ...prev, [k]: v } as AltaForm : prev));

  useEffect(() => {
    if (!form) return;
    let vivo = true;
    buscarLegajosExistentes(form)
      .then((existentes) => { if (vivo) setDecision(decidirAlta(form, existentes, form.empresaId)); })
      .catch(() => { if (vivo) setDecision(null); });
    return () => { vivo = false; };
  }, [form]);

  const onArchivo = async (file: File) => {
    try {
      const filas = leerHoja(await file.arrayBuffer());
      if (!filas.length) { setError('El archivo no tiene filas en la hoja SP.'); return; }
      recordarPadron(filas);
      setPadron(filas);
      setError('');
    } catch {
      setError('No se pudo leer el archivo.');
    }
  };

  const confirmar = async () => {
    if (!form || guardando) return;
    setGuardando(true);
    setError('');
    try {
      const res = await confirmarAltaLegajo(form);
      if ('mensaje' in res) { setError(res.mensaje); return; }
      if (res.avisos.length) toast.message(res.avisos[0]);
      toast.success(res.empleado.habilitado ? `${res.empleado.name} habilitado en esta empresa` : `Legajo creado: ${res.empleado.name}`);
      onCreado(res.empleado);
    } catch (e) {
      console.error(e);
      setError('No se pudo guardar el legajo.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[13000] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onCerrar} data-alta-padron>
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-auto rounded-3xl border border-slate-200 bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2">
          <UserPlus size={16} className="text-indigo-600" />
          <h3 className="text-sm font-black uppercase text-slate-800">Dar de alta</h3>
          <button type="button" onClick={onCerrar} className="ml-auto rounded-lg p-1 text-slate-400 hover:bg-slate-50" aria-label="Cerrar"><X size={14} /></button>
        </div>
        <p className="mb-3 text-[12px] text-slate-600">
          <b>{pedido.nombre}</b> no está en la empresa. El alta usa el mismo legajo que RRHH y queda con objetivo preferido en este servicio.
        </p>
        {!padron ? (
          <div className="space-y-2" data-alta-pedir-padron>
            <p className="text-[12px] text-slate-500">Elegí el padrón de empleados (.xlsx, hoja SP). Se lee en este navegador y no se sube a ningún lado. Vale para el resto de la sesión.</p>
            <input
              type="file"
              accept=".xlsx,.xls"
              data-alta-archivo
              className="block w-full text-[12px]"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onArchivo(f); }}
            />
          </div>
        ) : form && (
          <div className="space-y-2" data-alta-formulario data-alta-en-padron={enPadron ? '1' : '0'}>
            <p className={`rounded-xl px-3 py-2 text-[12px] ${enPadron ? 'border border-emerald-200 bg-emerald-50 text-emerald-900' : 'border border-amber-200 bg-amber-50 text-amber-900'}`}>
              {enPadron ? 'Encontrado en el padrón. Revisá los datos y confirmá.' : 'No está en el padrón. Completá el alta a mano.'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] font-bold text-slate-500">Apellido<input className={inputCls} value={form.apellido} onChange={(e) => set('apellido', e.target.value)} data-alta-apellido /></label>
              <label className="text-[11px] font-bold text-slate-500">Nombre<input className={inputCls} value={form.nombre} onChange={(e) => set('nombre', e.target.value)} data-alta-nombre /></label>
              <label className="text-[11px] font-bold text-slate-500">Legajo<input className={inputCls} value={form.legajo} onChange={(e) => set('legajo', e.target.value)} data-alta-legajo /></label>
              <label className="text-[11px] font-bold text-slate-500">DNI<input className={inputCls} value={form.dni} onChange={(e) => set('dni', e.target.value)} data-alta-dni /></label>
              <label className="text-[11px] font-bold text-slate-500">CUIL<input className={inputCls} value={form.cuil} onChange={(e) => set('cuil', e.target.value)} data-alta-cuil /></label>
              <label className="text-[11px] font-bold text-slate-500">Mail<input className={inputCls} value={form.mail} onChange={(e) => set('mail', e.target.value)} /></label>
              <label className="text-[11px] font-bold text-slate-500">Teléfono<input className={inputCls} value={form.telefono} onChange={(e) => set('telefono', e.target.value)} /></label>
              <label className="text-[11px] font-bold text-slate-500">Ingreso<input className={inputCls} value={form.ingreso} onChange={(e) => set('ingreso', e.target.value)} placeholder="aaaa-mm-dd" /></label>
              <label className="col-span-2 text-[11px] font-bold text-slate-500">Domicilio<input className={inputCls} value={form.domicilio} onChange={(e) => set('domicilio', e.target.value)} /></label>
              <label className="text-[11px] font-bold text-slate-500">Nacimiento<input className={inputCls} value={form.nacimiento} onChange={(e) => set('nacimiento', e.target.value)} placeholder="aaaa-mm-dd" /></label>
              <label className="text-[11px] font-bold text-slate-500">Género
                <select className={inputCls} value={form.genero} onChange={(e) => set('genero', e.target.value)}>
                  <option value="">Sin especificar</option>
                  <option value="M">M</option>
                  <option value="F">F</option>
                </select>
              </label>
            </div>
            <p className="text-[11px] text-slate-500">Puesto: Vigilador · empresa {pedido.empresaNombre || pedido.empresaId}</p>
            {decision && decision.accion !== 'crear' && decision.accion !== 'habilitar' && (
              <p className="text-[12px] font-bold text-rose-700">{decision.mensaje}</p>
            )}
            {decision && decision.accion !== 'bloquear' && decision.avisos.map((a) => (
              <p key={a} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-[12px] text-amber-950" data-alta-aviso>{a}</p>
            ))}
          </div>
        )}
        {error && <p className="mt-2 text-[12px] font-bold text-rose-700" data-alta-error>{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCerrar} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button
            type="button"
            data-alta-confirmar
            disabled={!form || guardando || decision?.accion === 'bloquear'}
            onClick={() => void confirmar()}
            className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-black text-white shadow-sm hover:bg-indigo-700 disabled:border disabled:border-slate-200 disabled:bg-white disabled:text-slate-400"
          >
            {guardando ? 'Guardando…' : decision?.accion === 'habilitar' ? 'Habilitar en esta empresa' : 'Confirmar alta'}
          </button>
        </div>
      </div>
    </div>
  );
}
