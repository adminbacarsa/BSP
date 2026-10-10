import React, { useMemo, useState } from 'react';
import { AlertTriangle, FileSpreadsheet, X } from 'lucide-react';
import {
  compararServicio,
  cruzarGuardias,
  detectarCuadros,
  faltanEnPlanilla,
  proponerReglas,
  resumenPreview,
  sugerirCuadros,
  unirCuadros,
  vistaPrevia,
  type CeldaActual,
  type CruceFila,
  type CuadroPlanilla,
  type EmpleadoCruce,
  type ItemPreview,
  type ReglaMapeo,
  type TurnoServicio,
} from '@/lib/planificacion/importarExcel';

export type ImportarExcelContexto = {
  year: number;
  month: number;
  mesLabel: string;
  objectiveName: string;
  turnos: TurnoServicio[];
  empleados: EmpleadoCruce[];
  dotacion: EmpleadoCruce[];
  actuales: CeldaActual[];
  diasCerrados: string[];
  reglasGuardadas: ReglaMapeo[];
  sinServicio: boolean;
  empresaId: string;
};

type Props = {
  ctx: ImportarExcelContexto;
  onAplicar: (items: ItemPreview[], reglas: ReglaMapeo[]) => void;
  onCancelar: () => void;
};

const LICENCIAS = ['V', 'E', 'A', 'L', 'AA', 'PG', 'SUS'];
const FRANCOS = ['F', 'FF', 'FP'];

function valorRegla(r: ReglaMapeo): string {
  if (r.accion === 'ignorar') return 'ignorar';
  if (r.accion === 'doce') return 'doce';
  if (r.accion === 'ret') return 'RET';
  return r.code || 'ignorar';
}

function reglaDesdeValor(r: ReglaMapeo, valor: string): ReglaMapeo {
  if (valor === 'ignorar') return { ...r, accion: 'ignorar', code: '', nota: 'Ignorado a mano' };
  if (valor === 'doce') return { ...r, accion: 'doce', code: ['N', 'T', 'M'].includes(r.codigo) ? r.codigo : 'M', nota: 'Jornada de 12 h' };
  if (valor === 'RET') return { ...r, accion: 'ret', code: 'RET', nota: 'Retén' };
  if (FRANCOS.includes(valor)) return { ...r, accion: 'franco', code: valor, nota: 'Franco' };
  if (LICENCIAS.includes(valor)) return { ...r, accion: 'licencia', code: valor, nota: 'Licencia' };
  return { ...r, accion: 'turno', code: valor, nota: 'Turno del servicio' };
}

function cruceResuelto(cruce: CruceFila[], decisiones: Record<number, string>): CruceFila[] {
  return cruce.map((c) => {
    const d = decisiones[c.fila];
    if (d === 'saltar') return { ...c, estado: 'no', employeeId: null };
    if (d) {
      const emp = c.candidatos.find((x) => x.id === d);
      return { ...c, estado: 'encontrado', employeeId: d, nota: emp ? '' : c.nota };
    }
    if (c.estado === 'encontrado') return c;
    return { ...c, estado: 'no', employeeId: null };
  });
}

export function ImportarExcelModal({ ctx, onAplicar, onCancelar }: Props) {
  const [paso, setPaso] = useState(1);
  const [archivo, setArchivo] = useState('');
  const [error, setError] = useState('');
  const [cuadros, setCuadros] = useState<CuadroPlanilla[]>([]);
  const [elegidos, setElegidos] = useState<number[]>([]);
  const [decisiones, setDecisiones] = useState<Record<number, string>>({});
  const [reglas, setReglas] = useState<ReglaMapeo[]>([]);
  const [busqueda, setBusqueda] = useState<Record<number, string>>({});

  const seleccion = useMemo(
    () => unirCuadros(cuadros.filter((c) => elegidos.includes(c.indice))),
    [cuadros, elegidos],
  );
  const cruce = useMemo(
    () => (seleccion.filas.length ? cruzarGuardias(seleccion.filas, ctx.empleados, ctx.empresaId) : []),
    [seleccion, ctx.empleados, ctx.empresaId],
  );
  const cruceOk = useMemo(() => cruceResuelto(cruce, decisiones), [cruce, decisiones]);
  const faltan = useMemo(() => faltanEnPlanilla(cruceOk, ctx.dotacion), [cruceOk, ctx.dotacion]);
  const comparacion = useMemo(
    () => compararServicio(seleccion, ctx.turnos, reglas.length ? reglas : proponerReglas(seleccion, ctx.reglasGuardadas)),
    [seleccion, ctx.turnos, ctx.reglasGuardadas, reglas],
  );
  const items = useMemo(() => vistaPrevia({
    year: ctx.year,
    month: ctx.month,
    cuadro: seleccion,
    reglas,
    cruce: cruceOk,
    incluirDudosos: false,
    turnos: ctx.turnos,
    actuales: ctx.actuales,
    diasCerrados: ctx.diasCerrados,
  }), [ctx, seleccion, reglas, cruceOk]);
  const resumen = resumenPreview(items);
  const codigosSla = useMemo(() => [...new Set(ctx.turnos.map((t) => t.code).filter(Boolean))], [ctx.turnos]);

  const leer = async (file: File) => {
    setError('');
    setArchivo(file.name);
    try {
      const { celdasDesdeArrayBuffer } = await import('@/lib/planificacion/importarExcelXlsx');
      const buf = await file.arrayBuffer();
      const hallados = detectarCuadros(celdasDesdeArrayBuffer(buf), ctx.year, ctx.month);
      if (!hallados.length) {
        setCuadros([]);
        setError('No encontré una grilla de días 1 a 31 en la primera hoja.');
        return;
      }
      setCuadros(hallados);
      setElegidos(sugerirCuadros(hallados));
      setDecisiones({});
      setReglas([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer el archivo.');
    }
  };

  const irACodigos = () => {
    const base = proponerReglas(seleccion, reglas.length ? reglas : ctx.reglasGuardadas);
    setReglas(base);
    setPaso(4);
  };

  const opciones = ['ignorar', 'doce', 'RET', ...FRANCOS, ...LICENCIAS, ...codigosSla, 'M', 'T', 'N', 'D12', 'N12', 'ESC', 'REF'];
  const opcionesUnicas = [...new Set(opciones)];

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-4" data-importar-excel-modal>
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <FileSpreadsheet className="text-indigo-600" size={18} />
          <div className="min-w-0">
            <h2 className="text-sm font-black text-slate-800">Importar planilla · {ctx.objectiveName}</h2>
            <p className="text-[11px] text-slate-500">{ctx.mesLabel} · paso {paso} de 5 · queda en borrador hasta Guardar cronograma</p>
          </div>
          <button type="button" onClick={onCancelar} className="ml-auto rounded-xl p-2 text-slate-400 hover:bg-slate-50" aria-label="Cerrar">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" data-import-paso={paso}>
          {paso === 1 && (
            <div className="space-y-3">
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center hover:bg-slate-100">
                <span className="text-sm font-bold text-slate-700">Subir .xlsx</span>
                <span className="mt-1 text-[11px] text-slate-500">{archivo || 'La primera hoja, con la fila de días y el cuadro de referencias.'}</span>
                <input
                  data-importar-archivo
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void leer(f); }}
                />
              </label>
              {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">{error}</p>}
              {cuadros.map((c) => (
                <label key={c.indice} className="flex items-start gap-3 rounded-2xl border border-slate-200 px-3 py-2 shadow-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={elegidos.includes(c.indice)}
                    onChange={(e) => setElegidos((prev) => e.target.checked ? [...prev, c.indice].sort((a, b) => a - b) : prev.filter((i) => i !== c.indice))}
                  />
                  <span className="text-[12px] text-slate-700">
                    <span className="font-black">Cuadro {c.indice + 1}</span>
                    {c.titulo ? ` · ${c.titulo}` : ''} · {c.filas.length} guardias · letras {c.letras || '—'}
                    {c.avisoMes && <span className="mt-1 flex items-center gap-1 text-amber-800"><AlertTriangle size={12} />{c.avisoMes}</span>}
                  </span>
                </label>
              ))}
            </div>
          )}

          {paso === 2 && (
            <div className="space-y-2 text-[12px] text-slate-700">
              <p className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 font-black uppercase tracking-wide">
                {comparacion.veredicto === 'coincide' && 'Coincide con el servicio de este mes'}
                {comparacion.veredicto === 'difiere' && 'Difiere del servicio de este mes'}
                {comparacion.veredicto === 'sin_servicio' && 'No hay servicio en este mes'}
              </p>
              {comparacion.planilla.map((f) => (
                <p key={`${f.puesto}|${f.code}|${f.startTime}`}>{f.puesto || 'Sin puesto'} · {f.code} {f.startTime}–{f.endTime} ×{f.cantidad}</p>
              ))}
              {comparacion.diferencias.map((d) => <p key={d} className="text-amber-800">{d}</p>)}
              <p className="text-slate-500">Crear o corregir el servicio desde acá queda para otra vuelta. Se sigue con el que ya está, o sin servicio.</p>
            </div>
          )}

          {paso === 3 && (
            <div className="space-y-2">
              {cruce.map((c) => (
                <div key={c.fila} className="rounded-2xl border border-slate-200 px-3 py-2 text-[12px] shadow-sm" data-importar-guardia={c.estado}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-black text-slate-800">{c.nombrePlanilla}</span>
                    {c.legajo && <span className="text-slate-400">legajo {c.legajo}</span>}
                    <span className={c.estado === 'encontrado' ? 'text-emerald-700' : c.estado === 'dudoso' ? 'text-amber-700' : 'text-rose-700'}>
                      {c.estado === 'encontrado' ? 'Encontrado' : c.estado === 'dudoso' ? 'Dudoso' : 'No encontrado'}
                    </span>
                  </div>
                  {c.nota && <p className="text-slate-500">{c.nota}</p>}
                  {c.estado !== 'encontrado' && (
                    <div className="mt-1 flex flex-wrap gap-2">
                      <select
                        className="rounded-xl border border-slate-200 px-2 py-1"
                        value={decisiones[c.fila] || ''}
                        onChange={(e) => setDecisiones((prev) => ({ ...prev, [c.fila]: e.target.value }))}
                      >
                        <option value="">Saltear</option>
                        {c.candidatos.map((k) => <option key={k.id} value={k.id}>{k.nombre}</option>)}
                      </select>
                      <input
                        value={busqueda[c.fila] || ''}
                        onChange={(e) => setBusqueda((prev) => ({ ...prev, [c.fila]: e.target.value }))}
                        placeholder="Buscar en la empresa"
                        className="rounded-xl border border-slate-200 px-2 py-1"
                      />
                    </div>
                  )}
                  {(busqueda[c.fila] || '').trim().length >= 3 && (
                    <div className="mt-1 max-h-28 overflow-y-auto rounded-xl border border-slate-100">
                      {ctx.empleados.filter((e) => e.nombre.toUpperCase().includes((busqueda[c.fila] || '').toUpperCase())).slice(0, 8).map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          className="block w-full px-2 py-1 text-left hover:bg-slate-50"
                          onClick={() => setDecisiones((prev) => ({ ...prev, [c.fila]: e.id }))}
                        >
                          {e.nombre}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {faltan.length > 0 && (
                <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                  En la dotación y no en la planilla: {faltan.map((e) => e.nombre).join(', ')}
                </p>
              )}
            </div>
          )}

          {paso === 4 && (
            <table className="w-full text-left text-[12px]">
              <thead className="text-[10px] uppercase tracking-wide text-slate-400">
                <tr><th className="py-1">Planilla</th><th>Veces</th><th>Pasa a</th><th>Nota</th></tr>
              </thead>
              <tbody>
                {reglas.map((r) => (
                  <tr key={r.clave} className="border-t border-slate-100">
                    <td className="py-1 font-black">{r.codigo}{r.color === 'red' ? ' · rojo' : ''}</td>
                    <td>{r.muestras}</td>
                    <td>
                      <select
                        className="rounded-xl border border-slate-200 px-2 py-1"
                        value={valorRegla(r)}
                        onChange={(e) => setReglas((prev) => prev.map((x) => x.clave === r.clave ? reglaDesdeValor(x, e.target.value) : x))}
                      >
                        {opcionesUnicas.map((o) => (
                          <option key={o} value={o}>
                            {o === 'ignorar' ? 'Ignorar' : o === 'doce' ? 'Jornada de 12 h (D12/N12 o la del puesto)' : o}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="text-slate-500">{r.nota}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {paso === 5 && (
            <div className="space-y-2 text-[12px] text-slate-700" data-importar-resumen>
              <p><b>{resumen.nuevas}</b> nuevas · <b>{resumen.cambian}</b> cambian · <b>{resumen.iguales}</b> iguales · <b>{resumen.noToca}</b> no se tocan</p>
              <p className="text-slate-500">Lo igual no se reescribe. Licencias, días cerrados y celdas ignoradas quedan como están. Al aplicar, todo lo demás entra como borrador.</p>
              {items.filter((i) => i.estado === 'cambia').slice(0, 8).map((i) => (
                <p key={`${i.employeeId}_${i.dateStr}`}>{i.dateStr}: {i.motivo}</p>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={() => (paso === 1 ? onCancelar() : setPaso((p) => p - 1))} className="rounded-xl border border-slate-200 px-3 py-2 text-[12px] font-bold text-slate-600 hover:bg-slate-50">
            {paso === 1 ? 'Cancelar' : 'Atrás'}
          </button>
          {paso < 5 ? (
            <button
              type="button"
              data-importar-siguiente
              disabled={paso === 1 ? elegidos.length === 0 : false}
              onClick={() => (paso === 3 ? irACodigos() : setPaso((p) => p + 1))}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-[12px] font-black text-white disabled:opacity-40"
            >
              {paso === 2 && ctx.sinServicio ? 'Seguir sin servicio' : paso === 2 ? 'Seguir con este servicio' : 'Siguiente'}
            </button>
          ) : (
            <button
              type="button"
              data-importar-aplicar
              onClick={() => onAplicar(items, reglas)}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-[12px] font-black text-white"
            >
              Aplicar borrador
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
