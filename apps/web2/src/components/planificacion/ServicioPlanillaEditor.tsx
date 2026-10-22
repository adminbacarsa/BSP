import React, { useMemo, useState } from 'react';
import { CalendarDays, Plus, Trash2 } from 'lucide-react';
import type { EquivalenciaCodigo } from '@/lib/planificacion/equivalenciaCodigo';
import { PlanillaIaPanel } from '@/components/planificacion/PlanillaIaPanel';
import type { CuadroPlanilla } from '@/lib/planificacion/importarExcel';
import {
  adoptarCodigoVigente,
  alinearPuestos,
  compararConVigente,
  equivalenciasAlCodigoServicio,
  diasDeFechas,
  etiquetaDias,
  etiquetaFechas,
  fechaDelMes,
  letraDia,
  lineasConfirmacion,
  proponerServicioDesdePlanilla,
  tipoPuestoPropuesto,
  type HorarioCatalogo,
  separarPuesto,
  unirPuestos,
  renombrarPuesto,
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
  /** Catálogo de la empresa: horario real de cada código (NE, NO, NN, TT, MA…). */
  catalogo?: readonly HorarioCatalogo[];
  /** Valor actual de «Exige cobertura» del servicio (si falta, sí). */
  exigeCoberturaInicial?: boolean;
  onGuardar: (accion: 'crear' | 'actualizar', franjas: FranjaServicioPlanilla[], equivalencias: EquivalenciaCodigo[], opciones: { exigeCobertura: boolean }) => Promise<void>;
};

export function ServicioPlanillaEditor({ cuadro, semilla, year, month, mesLabel, vigente, servicioId, puedeCrear, puedeActualizar, hayOtroServicio, empresaId, objectiveId, catalogo, exigeCoberturaInicial, onGuardar }: Props) {
  const [exigeCobertura, setExigeCobertura] = useState(exigeCoberturaInicial !== false);
  const propuesta = useMemo(() => {
    const base = semilla || (cuadro ? proponerServicioDesdePlanilla(cuadro, year, month, { catalogo, vigente }) : { franjas: [], equivalencias: [], lectura: '' });
    const alineadas = alinearPuestos(base.franjas, vigente);
    const franjas = adoptarCodigoVigente(alineadas, vigente);
    return { ...base, franjas, equivalencias: equivalenciasAlCodigoServicio(base.equivalencias, alineadas, franjas) };
  }, [cuadro, semilla, year, month, vigente, catalogo]);
  const [franjas, setFranjas] = useState<FranjaServicioPlanilla[]>(propuesta.franjas);
  const [equivalencias, setEquivalencias] = useState<EquivalenciaCodigo[]>(propuesta.equivalencias);
  const [funciones, setFunciones] = useState<string[]>(propuesta.funciones || []);
  const baseKey = semilla
    ? `semilla|${servicioId}|${semilla.franjas.map((f) => f.id).join(',')}`
    : `${cuadro?.indice ?? 'x'}|${servicioId}`;
  const [baseId, setBaseId] = useState(baseKey);
  const [confirmando, setConfirmando] = useState<'crear' | 'actualizar' | null>(null);
  const [calendarioDe, setCalendarioDe] = useState<string | null>(null);
  const diasMes = new Date(Date.UTC(year, month, 0)).getUTCDate();
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
  const sinHorario = franjas.filter((f) => f.definirHorario || !f.startTime || !f.endTime);
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

  /** Pasa la franja a fechas del mes, arrancando por los días de la semana que ya tenía. */
  const abrirCalendario = (f: FranjaServicioPlanilla) => {
    if (calendarioDe === f.id) { setCalendarioDe(null); return; }
    if (!f.fechas?.length) {
      const base = f.dias.length ? f.dias : DIAS;
      const fechas: string[] = [];
      for (let d = 1; d <= diasMes; d++) if (base.includes(letraDia(year, month, d))) fechas.push(fechaDelMes(year, month, d));
      patch(f.id, { fechas, dias: diasDeFechas(fechas) });
    }
    setCalendarioDe(f.id);
  };
  const toggleFecha = (id: string, fecha: string) => {
    setFranjas((prev) => prev.map((f) => {
      if (f.id !== id) return f;
      const set = new Set(f.fechas || []);
      if (set.has(fecha)) set.delete(fecha); else set.add(fecha);
      const fechas = [...set].sort();
      return { ...f, fechas, dias: diasDeFechas(fechas) };
    }));
  };
  const volverASemana = (f: FranjaServicioPlanilla) => {
    patch(f.id, { fechas: undefined, dias: f.dias });
    setCalendarioDe(null);
  };

  const confirmar = async () => {
    if (!confirmando) return;
    setGuardando(true);
    setError('');
    try {
      await onGuardar(confirmando, franjas, equivalencias, { exigeCobertura });
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
            const alineadas = alinearPuestos(next.franjas, vigente);
            const adoptadas = adoptarCodigoVigente(alineadas, vigente);
            setFranjas(adoptadas);
            setEquivalencias(equivalenciasAlCodigoServicio(next.equivalencias, alineadas, adoptadas));
            setFunciones(next.funciones);
          }}
        />
      )}
      {sinHorario.length > 0 && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900" data-servicio-horario-pendiente data-servicio-aviso-extra={franjas.some((f) => f.id.startsWith('extra|')) ? '1' : undefined}>
          {franjas.some((f) => f.id.startsWith('extra|')) && (
            <span className="block">Hay turnos de más sobre los puestos de 24 h. La planilla no dice su horario: definilo en la fila marcada (y el nombre del puesto si querés, por ejemplo EN o RO).</span>
          )}
          <span className="block">{sinHorario.map((f) => `${f.code} · ${f.puesto}`).join(', ')} no tiene horario conocido. Definilo en la fila marcada. No se inventa un M/T/N de 8 h ni un N12.</span>
        </p>
      )}
      {franjas.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-servicio-tipos>
          {[...new Set(franjas.map((f) => f.puesto))].filter((p) => p.trim()).map((puesto, _i, todos) => {
            const propias = franjas.filter((f) => f.puesto === puesto);
            const t = tipoPuestoPropuesto(puesto, propias);
            const pax = Math.max(1, ...propias.map((f) => Math.round(f.cantidad) || 1));
            const trabajaFeriados = !propias.some((f) => f.trabajaFeriados === false);
            const marcarFeriados = (trabaja: boolean) => setFranjas((prev) => prev.map((f) => (f.puesto === puesto ? { ...f, trabajaFeriados: trabaja } : f)));
            return (
              <span key={puesto} data-servicio-tipo={t.tipo} data-servicio-feriados-puesto={trabajaFeriados ? '+F' : '−F'} title={t.motivo} className={`flex flex-wrap items-center gap-1 rounded-xl border px-2 py-1 text-[11px] ${t.tipo === '24hs' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                <input
                  key={`n-${puesto}`}
                  defaultValue={puesto}
                  aria-label={`Nombre de ${puesto}`}
                  data-servicio-puesto-nombre={puesto}
                  onBlur={(e) => setFranjas((prev) => renombrarPuesto(prev, puesto, e.target.value))}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  className="w-24 rounded border border-transparent bg-transparent px-0.5 font-black hover:border-slate-300 focus:border-indigo-400 focus:bg-white"
                />
                <span>· {t.tipo === '24hs' ? `×${pax} pax · 24 HS` : 'Custom'}</span>
                <span className="text-slate-500">({t.motivo})</span>
                <span className="inline-flex overflow-hidden rounded-lg border border-slate-300">
                  <button type="button" data-servicio-puesto-feriados={`${puesto}|+`} title="Se trabaja en feriados" onClick={() => marcarFeriados(true)} className={`px-1.5 py-0.5 font-black ${trabajaFeriados ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500'}`}>+F</button>
                  <button type="button" data-servicio-puesto-feriados={`${puesto}|-`} title="No se trabaja en feriados: no exigen cobertura ni suman horas vendidas" onClick={() => marcarFeriados(false)} className={`px-1.5 py-0.5 font-black ${trabajaFeriados ? 'bg-white text-slate-500' : 'bg-slate-800 text-white'}`}>−F</button>
                </span>
                {pax > 1 && (
                  <button type="button" data-servicio-separar={puesto} onClick={() => setFranjas((prev) => separarPuesto(prev, puesto))} className="rounded-lg border border-slate-300 bg-white px-1.5 py-0.5 font-bold text-slate-700 hover:bg-slate-50">
                    Separar en {pax} puestos ×1
                  </button>
                )}
                {todos.length > 1 && (
                  <select
                    value=""
                    data-servicio-unir={puesto}
                    onChange={(e) => { const otro = e.target.value; if (otro) setFranjas((prev) => unirPuestos(prev, puesto, otro)); }}
                    className="rounded-lg border border-slate-300 bg-white px-1 py-0.5 font-bold text-slate-700"
                  >
                    <option value="">Unir con…</option>
                    {todos.filter((x) => x !== puesto).map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                )}
                <button
                  type="button"
                  data-servicio-quitar-puesto={puesto}
                  title={`Quitar ${puesto} y sus franjas del servicio`}
                  onClick={() => { if (window.confirm(`¿Quitar ${puesto} del servicio? Se borran sus ${propias.length} franja(s) al aplicar.`)) setFranjas((prev) => prev.filter((x) => x.puesto !== puesto)); }}
                  className="rounded-lg border border-rose-200 bg-white px-1.5 py-0.5 font-bold text-rose-600 hover:bg-rose-50"
                >
                  Quitar
                </button>
              </span>
            );
          })}
        </div>
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
                  <td><input value={f.startTime} onChange={(e) => patch(f.id, { startTime: e.target.value, definirHorario: false })} className={`w-16 rounded-lg border px-1 py-0.5 ${f.definirHorario ? 'border-amber-400 bg-amber-50' : 'border-slate-200'}`} title={f.definirHorario ? 'Este código no tiene horario conocido: definilo' : undefined} data-servicio-definir-horario={f.definirHorario ? '1' : undefined} /></td>
                  <td><input value={f.endTime} onChange={(e) => patch(f.id, { endTime: e.target.value, definirHorario: false })} className={`w-16 rounded-lg border px-1 py-0.5 ${f.definirHorario ? 'border-amber-400 bg-amber-50' : 'border-slate-200'}`} title={f.definirHorario ? 'Este código no tiene horario conocido: definilo' : undefined} /></td>
                  <td><input type="number" min={1} value={f.cantidad} onChange={(e) => patch(f.id, { cantidad: Math.max(1, Number(e.target.value) || 1) })} className="w-12 rounded-lg border border-slate-200 px-1 py-0.5" /></td>
                  <td className="py-1" data-servicio-dias>
                    <div className="flex items-center gap-1">
                      {f.fechas?.length ? (
                        <span className="text-[11px] font-bold text-indigo-800" data-servicio-fechas>Fechas: {etiquetaFechas(f.fechas)}</span>
                      ) : (
                        <div className="flex gap-px">
                          {DIAS.map((d) => {
                            const on = !f.dias.length || f.dias.includes(d);
                            return (
                              <button key={d} type="button" onClick={() => toggleDia(f.id, d)} className={`h-5 w-5 rounded text-[9px] font-black ${on ? 'bg-slate-900 text-white' : 'border border-slate-200 text-slate-400'}`}>{d}</button>
                            );
                          })}
                        </div>
                      )}
                      {!f.fechas?.length && (
                        <button
                          type="button"
                          data-servicio-feriados={f.id}
                          onClick={() => patch(f.id, { feriados: !f.feriados })}
                          title="Además de esos días, corre los feriados nacionales"
                          className={`h-5 rounded px-1 text-[9px] font-black ${f.feriados ? 'bg-rose-600 text-white' : 'border border-slate-200 text-slate-400'}`}
                        >+F</button>
                      )}
                      <button
                        type="button"
                        data-servicio-calendario={f.id}
                        onClick={() => abrirCalendario(f)}
                        title="Elegir fechas del mes"
                        aria-label="Elegir fechas del mes"
                        className={`flex h-5 w-5 items-center justify-center rounded ${calendarioDe === f.id || f.fechas?.length ? 'bg-indigo-600 text-white' : 'border border-slate-200 text-slate-500 hover:text-indigo-600'}`}
                      >
                        <CalendarDays size={11} aria-hidden />
                      </button>
                    </div>
                    {!f.fechas?.length && <span className="text-[9px] text-slate-400">{etiquetaDias(f.dias)}</span>}
                    {calendarioDe === f.id && (
                      <div className="mt-1 w-[15.5rem] rounded-xl border border-indigo-200 bg-white p-2 shadow-sm" data-servicio-calendario-panel>
                        <div className="grid grid-cols-7 gap-0.5">
                          {DIAS.map((d) => <span key={d} className="text-center text-[9px] font-black text-slate-400">{d}</span>)}
                          {Array.from({ length: (DIAS.indexOf(letraDia(year, month, 1)) + 7) % 7 }, (_, i) => <span key={`v${i}`} />)}
                          {Array.from({ length: diasMes }, (_, i) => {
                            const fecha = fechaDelMes(year, month, i + 1);
                            const on = (f.fechas || []).includes(fecha);
                            return (
                              <button key={fecha} type="button" data-servicio-fecha={i + 1} onClick={() => toggleFecha(f.id, fecha)} className={`h-6 rounded text-[10px] font-black tabular-nums ${on ? 'bg-indigo-600 text-white' : 'border border-slate-200 text-slate-500 hover:bg-indigo-50'}`}>{i + 1}</button>
                            );
                          })}
                        </div>
                        <div className="mt-1.5 flex justify-between text-[10px]">
                          <button type="button" className="font-bold text-slate-500 hover:underline" onClick={() => volverASemana(f)}>Volver a días de la semana</button>
                          <button type="button" className="font-black text-indigo-700 hover:underline" onClick={() => setCalendarioDe(null)}>Listo</button>
                        </div>
                      </div>
                    )}
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
          <button
            type="button"
            data-servicio-agregar-puesto
            title="Puesto nuevo de 24 h (M, T y N; el D12/N12 se agrega solo al aplicar)"
            onClick={() => setFranjas((prev) => {
              const usados = new Set(prev.map((f) => f.puesto));
              let n = 1;
              while (usados.has(`Puesto ${n}`)) n += 1;
              const puesto = `Puesto ${n}`;
              const t = Date.now();
              return [...prev,
                { id: `nueva_${t}_m`, puesto, code: 'M', startTime: '07:00', endTime: '15:00', cantidad: 1, dias: [] },
                { id: `nueva_${t}_t`, puesto, code: 'T', startTime: '15:00', endTime: '23:00', cantidad: 1, dias: [] },
                { id: `nueva_${t}_n`, puesto, code: 'N', startTime: '23:00', endTime: '07:00', cantidad: 1, dias: [] },
              ];
            })}
            className="m-2 ml-0 inline-flex items-center gap-1 rounded-xl border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
          >
            <Plus size={12} /> Puesto de 24 h
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

      <label className="flex items-start gap-2 rounded-2xl border border-rose-100 bg-rose-50/60 px-3 py-2 text-[12px] text-slate-700" data-servicio-exige-cobertura>
        <input type="checkbox" className="mt-0.5" checked={exigeCobertura} onChange={(e) => setExigeCobertura(e.target.checked)} />
        <span>
          <b>Exige cobertura</b>
          <span className="block text-[11px] text-slate-500">Si está apagado, la grilla muestra solo los turnos que se usan: no hay huecos, fila Cobertura ni propuestas. Las horas se siguen contando.</span>
        </span>
      </label>
      {!confirmando && (
        <div className="flex flex-wrap gap-2">
          {!servicioId && !hayOtroServicio && (
            <button type="button" data-servicio-crear disabled={!puedeCrear || !franjas.length || sinHorario.length > 0} onClick={() => { setError(''); setConfirmando('crear'); }} className="rounded-xl bg-indigo-600 px-3 py-2 text-[12px] font-black text-white disabled:opacity-40">Crear servicio</button>
          )}
          {!servicioId && !!hayOtroServicio && (
            <p className="text-[12px] font-bold text-amber-800">Este mes ya tiene servicio. Elegilo arriba para aplicar los cambios.</p>
          )}
          {!!servicioId && (
            <button type="button" data-servicio-aplicar disabled={!puedeActualizar || !franjas.length || sinHorario.length > 0} onClick={() => { setError(''); setConfirmando('actualizar'); }} className="rounded-xl bg-indigo-600 px-3 py-2 text-[12px] font-black text-white disabled:opacity-40">Aplicar cambios al servicio del mes</button>
          )}
          {!puedeCrear && !servicioId && <p className="text-[12px] text-slate-500">Sin permiso para crear servicios.</p>}
          {!!servicioId && !puedeActualizar && <p className="text-[12px] text-slate-500">Sin permiso para modificar el servicio.</p>}
        </div>
      )}
    </div>
  );
}
