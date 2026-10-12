import React, { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { EquivalenciaCodigo } from '@/lib/planificacion/equivalenciaCodigo';
import { PlanillaIaPanel } from '@/components/planificacion/PlanillaIaPanel';
import type { CuadroPlanilla } from '@/lib/planificacion/importarExcel';
import {
  alinearPuestos,
  compararConVigente,
  etiquetaDias,
  lineasConfirmacion,
  proponerServicioDesdePlanilla,
  type DiaSemana,
  type FranjaServicioPlanilla,
  type FranjaVigente,
  type PropuestaServicio,
} from '@/lib/planificacion/servicioDesdePlanilla';

const DIAS: DiaSemana[] = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

type Props = {
  cuadro?: CuadroPlanilla | null;
  semilla?: PropuestaServicio | null;
  year: number;
  month: number;
  mesLabel: string;
  vigente: FranjaVigente[];
  servicioId: string;
  puedeCrear: boolean;
  puedeActualizar: boolean;
  hayOtroServicio?: boolean;
  empresaId?: string;
  objectiveId?: string;
  onGuardar: (accion: 'crear' | 'actualizar', franjas: FranjaServicioPlanilla[], equivalencias: EquivalenciaCodigo[]) => Promise<void>;
};

export function ServicioPlanillaEditor({ cuadro, semilla, year, month, mesLabel, vigente, servicioId, puedeCrear, puedeActualizar, hayOtroServicio, empresaId, objectiveId, onGuardar }: Props) {
  const propuesta = useMemo(() => {
    const base = semilla || (cuadro ? proponerServicioDesdePlanilla(cuadro, year, month) : { franjas: [], equivalencias: [], lectura: '' });
    return { ...base, franjas: alinearPuestos(base.franjas, vigente) };
  }, [cuadro, semilla, year, month, vigente]);
  const [franjas, setFranjas] = useState<FranjaServicioPlanilla[]>(propuesta.franjas);
  const [equivalencias, setEquivalencias] = useState<EquivalenciaCodigo[]>(propuesta.equivalencias);
  const [funciones, setFunciones] = useState<string[]>(propuesta.funciones || []);
  const baseKey = semilla
    ? `semilla|${servicioId}|${semilla.franjas.map((f) => f.id).join(',')}`
    : `${cuadro?.indice ?? 'x'}|${servicioId}`;
  const [baseId, setBaseId] = useState(baseKey);
  const [confirmando, setConfirmando] = useState<'crear' | 'actualizar' | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  if (baseId !== baseKey) {
    setBaseId(baseKey);
    setFranjas(propuesta.franjas);
    setEquivalencias(propuesta.equivalencias);
    setFunciones(propuesta.funciones || []);
    setConfirmando(null);
  }
  const diff = useMemo(() => compararConVigente(franjas, vigente), [franjas, vigente]);
  const lineas = confirmando ? lineasConfirmacion(diff, confirmando, mesLabel) : [];

  const patch = (id: string, parcial: Partial<FranjaServicioPlanilla>) => {
    setFranjas((prev) => prev.map((f) => (f.id === id ? { ...f, ...parcial } : f)));
  };
  const toggleDia = (id: string, dia: DiaSemana) => {
    setFranjas((prev) => prev.map((f) => {
      if (f.id !== id) return f;
      const base = f.dias.length ? f.dias : [...DIAS];
      const dias = base.includes(dia) ? base.filter((d) => d !== dia) : [...base, dia];
      const orden = DIAS.filter((d) => dias.includes(d));
      return { ...f, dias: orden.length === DIAS.length ? [] : orden };
    }));
  };

  const confirmar = async () => {
    if (!confirmando) return;
    setGuardando(true);
    setError('');
    try {
      await onGuardar(confirmando, franjas, equivalencias);
      setConfirmando(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el servicio');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-3" data-servicio-planilla>
      {(propuesta.resumen || (vigente.length ? propuesta.lectura : '')) ? (
        <div className="space-y-1">
          <p className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-700 shadow-sm" data-servicio-lectura>
            {propuesta.resumen || propuesta.lectura}
          </p>
          {funciones.map((f) => (
            <p key={f} className="rounded-2xl border border-indigo-100 bg-indigo-50 px-3 py-1.5 text-[12px] text-indigo-950" data-servicio-funcion>{f}</p>
          ))}
          {(propuesta.parciales || []).map((p) => (
            <p key={p} className="text-[11px] text-amber-800" data-servicio-parcial>{p}</p>
          ))}
        </div>
      ) : null}
      {cuadro && (
        <PlanillaIaPanel
          key={baseKey}
          cuadro={cuadro}
          propuesta={propuesta}
          empresaId={empresaId}
          objectiveId={objectiveId}
          year={year}
          month={month}
          onAplicar={(next) => {
            setFranjas(next.franjas);
            setEquivalencias(next.equivalencias);
            setFunciones(next.funciones);
          }}
        />
      )}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="overflow-auto rounded-2xl border border-slate-200 shadow-sm" data-servicio-propuesta>
          <table className="w-full text-left text-[12px]">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-2 py-1">Puesto</th>
                <th>Código</th>
                <th>Desde</th>
                <th>Hasta</th>
                <th>×</th>
                <th>Días</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {franjas.map((f) => (
                <tr key={f.id} className="border-t border-slate-100" data-servicio-franja={f.code}>
                  <td className="px-2 py-1"><input value={f.puesto} onChange={(e) => patch(f.id, { puesto: e.target.value })} className="w-24 rounded-lg border border-slate-200 px-1 py-0.5" /></td>
                  <td><input value={f.code} onChange={(e) => patch(f.id, { code: e.target.value.toUpperCase() })} className="w-14 rounded-lg border border-slate-200 px-1 py-0.5 font-black" /></td>
                  <td><input value={f.startTime} onChange={(e) => patch(f.id, { startTime: e.target.value })} className="w-16 rounded-lg border border-slate-200 px-1 py-0.5" /></td>
                  <td><input value={f.endTime} onChange={(e) => patch(f.id, { endTime: e.target.value })} className="w-16 rounded-lg border border-slate-200 px-1 py-0.5" /></td>
                  <td><input type="number" min={1} value={f.cantidad} onChange={(e) => patch(f.id, { cantidad: Math.max(1, Number(e.target.value) || 1) })} className="w-12 rounded-lg border border-slate-200 px-1 py-0.5" /></td>
                  <td className="whitespace-nowrap py-1" data-servicio-dias>
                    <div className="flex gap-px">
                      {DIAS.map((d) => {
                        const on = !f.dias.length || f.dias.includes(d);
                        return (
                          <button key={d} type="button" onClick={() => toggleDia(f.id, d)} className={`h-5 w-5 rounded text-[9px] font-black ${on ? 'bg-slate-900 text-white' : 'border border-slate-200 text-slate-400'}`}>{d}</button>
                        );
                      })}
                    </div>
                    <span className="text-[9px] text-slate-400">{etiquetaDias(f.dias)}</span>
                  </td>
                  <td>
                    <button type="button" aria-label="Quitar franja" onClick={() => setFranjas((prev) => prev.filter((x) => x.id !== f.id))} className="rounded-lg p-1 text-slate-400 hover:bg-slate-50 hover:text-rose-600"><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            onClick={() => setFranjas((prev) => [...prev, { id: `nueva_${Date.now()}`, puesto: prev[0]?.puesto || 'Puesto', code: 'M', startTime: '07:00', endTime: '15:00', cantidad: 1, dias: ['L', 'M', 'X', 'J', 'V'] }])}
            className="m-2 inline-flex items-center gap-1 rounded-xl border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
          >
            <Plus size={12} /> Franja
          </button>
        </div>
        <div className="space-y-1 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-[12px] shadow-sm" data-servicio-diff>
          <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Servicio de este mes</p>
          {!vigente.length && <p className="text-slate-500">No hay servicio en este mes.</p>}
          {diff.map((d) => (
            <p key={`${d.estado}|${d.puesto}|${d.code}|${d.detalle}`} data-servicio-estado={d.estado} className={d.estado === 'coincide' ? 'text-emerald-800' : d.estado === 'sobra' ? 'text-slate-500' : 'text-amber-800'}>
              <span className="font-black uppercase">{d.estado}</span> · {d.detalle}
            </p>
          ))}
        </div>
      </div>

      <div className="overflow-auto rounded-2xl border border-slate-200 shadow-sm">
        <p className="bg-slate-50 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-slate-400">Equivalencias</p>
        <table className="w-full text-left text-[12px]">
          <thead className="text-[10px] uppercase text-slate-400"><tr><th className="px-2 py-1">Planilla</th><th>Pasa a</th><th>Horario</th></tr></thead>
          <tbody>
            {equivalencias.map((e) => (
              <tr key={e.clave} className="border-t border-slate-100" data-equivalencia={e.clave}>
                <td className="px-2 py-1 font-black">{e.codigo}{e.color === 'red' ? ' · rojo' : ''}</td>
                <td><input value={e.code} onChange={(ev) => setEquivalencias((prev) => prev.map((x) => x.clave === e.clave ? { ...x, code: ev.target.value.toUpperCase() } : x))} className="w-16 rounded-lg border border-slate-200 px-1 py-0.5 font-black" /></td>
                <td className="text-slate-500">{e.startTime}–{e.endTime}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirmando && (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-3 text-[12px] text-indigo-950 shadow-sm" data-servicio-confirmar>
          {lineas.map((l) => <p key={l}>{l}</p>)}
          {error && <p className="mt-1 font-bold text-rose-700">{error}</p>}
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setConfirmando(null)} className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-bold text-slate-600">Volver</button>
            <button type="button" data-servicio-confirmar-ok disabled={guardando} onClick={() => { void confirmar(); }} className="rounded-xl bg-indigo-600 px-3 py-1.5 font-black text-white disabled:opacity-40">{guardando ? 'Guardando…' : 'Confirmar'}</button>
          </div>
        </div>
      )}

      {!confirmando && (
        <div className="flex flex-wrap gap-2">
          {!servicioId && !hayOtroServicio && (
            <button type="button" data-servicio-crear disabled={!puedeCrear || !franjas.length} onClick={() => { setError(''); setConfirmando('crear'); }} className="rounded-xl bg-indigo-600 px-3 py-2 text-[12px] font-black text-white disabled:opacity-40">Crear servicio</button>
          )}
          {!servicioId && !!hayOtroServicio && (
            <p className="text-[12px] font-bold text-amber-800">Este mes ya tiene servicio. Elegilo arriba para aplicar los cambios.</p>
          )}
          {!!servicioId && (
            <button type="button" data-servicio-aplicar disabled={!puedeActualizar || !franjas.length} onClick={() => { setError(''); setConfirmando('actualizar'); }} className="rounded-xl bg-indigo-600 px-3 py-2 text-[12px] font-black text-white disabled:opacity-40">Aplicar cambios al servicio del mes</button>
          )}
          {!puedeCrear && !servicioId && <p className="text-[12px] text-slate-500">Sin permiso para crear servicios.</p>}
          {!!servicioId && !puedeActualizar && <p className="text-[12px] text-slate-500">Sin permiso para modificar el servicio.</p>}
        </div>
      )}
    </div>
  );
}
