import React, { useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, FileSpreadsheet, X } from 'lucide-react';
import { aplicarServicioPlanilla } from '@/lib/servicios/aplicarServicioPlanilla';
import { ServicioPlanillaEditor } from '@/components/planificacion/ServicioPlanillaEditor';
import { rangoMes } from '@/lib/planificacion/servicioDesdePlanilla';
import type { EquivalenciaCodigo } from '@/lib/planificacion/equivalenciaCodigo';
import {
  bloquesDeCuadros,
  cruzarGuardias,
  detectarCuadros,
  faltanEnPlanilla,
  normPlanilla,
  proponerDestino,
  proponerReglas,
  resumenPreview,
  sugerirCuadros,
  vistaPrevia,
  type BloqueDestino,
  type CeldaActual,
  type CruceFila,
  type CuadroPlanilla,
  type EmpleadoCruce,
  type ItemPreview,
  type ObjetivoCatalogo,
  type PropuestaDestino,
  type ReglaMapeo,
  type TurnoServicio,
} from '@/lib/planificacion/importarExcel';

export type ServicioDestino = {
  id: string;
  objectiveId: string;
  clientId?: string;
  desde: string;
  hasta: string;
  puestos: Array<{ nombre: string; franjas: string }>;
  turnos: TurnoServicio[];
};

export type ImportarExcelContexto = {
  year: number;
  month: number;
  mesLabel: string;
  empresaId: string;
  objetivos: ObjetivoCatalogo[];
  servicios: ServicioDestino[];
  empleados: EmpleadoCruce[];
  preseleccion: { clienteId: string; objectiveId: string } | null;
  diasCerrados: string[];
};

export type AplicarImportPayload = {
  clientId: string;
  objectiveId: string;
  objectiveName: string;
  items: ItemPreview[];
  reglas: ReglaMapeo[];
  sinServicio: boolean;
  quedaOtro: boolean;
};

type Props = {
  ctx: ImportarExcelContexto;
  onCargar: (objectiveId: string) => Promise<{ actuales: CeldaActual[]; reglas: ReglaMapeo[] }>;
  onAplicar: (payload: AplicarImportPayload) => Promise<boolean>;
  onCancelar: () => void;
  puedeCrearServicio: boolean;
  puedeEditarServicio: boolean;
  migracionCompleta: boolean;
  onServicioGuardado: () => void;
};

type Eleccion = {
  importar: boolean;
  clienteId: string;
  objectiveId: string;
  servicioId: string;
};

type GrupoImport = {
  clave: string;
  clienteId: string;
  objectiveId: string;
  servicioId: string;
  nombre: string;
  clienteNombre: string;
  sinServicio: boolean;
  turnos: TurnoServicio[];
  bloques: BloqueDestino[];
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

function fechaCorta(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return 'sin fecha';
  return format(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), 'dd/MM/yyyy');
}

function serviciosDe(ctx: ImportarExcelContexto, objectiveId: string): ServicioDestino[] {
  const obj = ctx.objetivos.find((o) => o.id === objectiveId);
  return ctx.servicios
    .filter((s) => s.objectiveId === objectiveId || (!!obj && normPlanilla(s.objectiveId) === normPlanilla(obj.nombre)))
    .sort((a, b) => b.desde.localeCompare(a.desde));
}

function eleccionInicial(b: BloqueDestino, archivo: string, ctx: ImportarExcelContexto, sugeridos: Set<number>): Eleccion {
  const propuesta = proponerDestino([archivo, b.titulo, b.etiqueta], ctx.objetivos);
  const pre = ctx.preseleccion;
  let clienteId = '';
  let objectiveId = '';
  if (pre?.objectiveId) {
    clienteId = pre.clienteId;
    objectiveId = pre.objectiveId;
  } else if (propuesta && propuesta.confianza >= 55) {
    clienteId = propuesta.clienteId;
    objectiveId = propuesta.objectiveId;
  }
  return {
    importar: sugeridos.has(b.cuadroIndice),
    clienteId,
    objectiveId,
    servicioId: objectiveId ? (serviciosDe(ctx, objectiveId)[0]?.id || '') : '',
  };
}

function cuadroDelGrupo(g: GrupoImport, cuadros: CuadroPlanilla[]): CuadroPlanilla {
  const fuentes = [...new Set(g.bloques.map((b) => b.cuadroIndice))]
    .map((i) => cuadros.find((c) => c.indice === i))
    .filter((c): c is CuadroPlanilla => !!c);
  return {
    indice: -1,
    titulo: g.bloques.map((b) => b.etiqueta || b.titulo).filter(Boolean).join(' · '),
    letras: fuentes[0]?.letras || '',
    avisoMes: fuentes.map((c) => c.avisoMes).find(Boolean) || null,
    filas: g.bloques.flatMap((b) => b.filas),
    referencias: fuentes.flatMap((c) => c.referencias),
    avisos: fuentes.flatMap((c) => c.avisos),
  };
}

function reglasConEquivalencias(reglas: ReglaMapeo[], eqs: EquivalenciaCodigo[]): ReglaMapeo[] {
  const por = new Map(eqs.map((e) => [e.clave, e]));
  return reglas.map((r) => {
    const e = por.get(r.clave);
    if (!e?.code) return r;
    return { ...r, accion: 'turno' as const, code: e.code, nota: `${e.code} ${e.startTime}–${e.endTime}` };
  });
}

export function ImportarExcelModal({ ctx, onCargar, onAplicar, onCancelar, puedeCrearServicio, puedeEditarServicio, migracionCompleta, onServicioGuardado }: Props) {
  const [paso, setPaso] = useState(1);
  const [archivo, setArchivo] = useState('');
  const [error, setError] = useState('');
  const [cuadros, setCuadros] = useState<CuadroPlanilla[]>([]);
  const [elecciones, setElecciones] = useState<Record<string, Eleccion>>({});
  const [busquedaDestino, setBusquedaDestino] = useState<Record<string, string>>({});
  const [decisiones, setDecisiones] = useState<Record<number, string>>({});
  const [busqueda, setBusqueda] = useState<Record<number, string>>({});
  const [reglasPorClave, setReglasPorClave] = useState<Record<string, ReglaMapeo[]>>({});
  const [grupoIdx, setGrupoIdx] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [cargado, setCargado] = useState<{ clave: string; actuales: CeldaActual[]; reglas: ReglaMapeo[] } | null>(null);
  const [serviciosEstado, setServiciosEstado] = useState(ctx.servicios);
  const ctxVivo = useMemo(() => ({ ...ctx, servicios: serviciosEstado }), [ctx, serviciosEstado]);
  const cargarRef = useRef(onCargar);
  cargarRef.current = onCargar;

  const bloques = useMemo(() => bloquesDeCuadros(cuadros), [cuadros]);

  const grupos = useMemo(() => {
    const map = new Map<string, GrupoImport>();
    for (const b of bloques) {
      const el = elecciones[b.key];
      if (!el?.importar || !el.objectiveId) continue;
      const obj = ctxVivo.objetivos.find((o) => o.id === el.objectiveId);
      const srv = serviciosDe(ctxVivo, el.objectiveId).find((s) => s.id === el.servicioId);
      const clave = `${el.objectiveId}|${el.servicioId}`;
      let g = map.get(clave);
      if (!g) {
        g = {
          clave,
          clienteId: el.clienteId || obj?.clienteId || '',
          objectiveId: el.objectiveId,
          servicioId: el.servicioId,
          nombre: obj?.nombre || el.objectiveId,
          clienteNombre: obj?.clienteNombre || '',
          sinServicio: !srv,
          turnos: srv?.turnos || [],
          bloques: [],
        };
        map.set(clave, g);
      }
      g.bloques.push(b);
    }
    return [...map.values()];
  }, [bloques, elecciones, ctxVivo]);

  const grupo = grupos[grupoIdx] || null;
  const cuadro = useMemo(() => (grupo ? cuadroDelGrupo(grupo, cuadros) : null), [grupo, cuadros]);
  const reglas = (grupo && reglasPorClave[grupo.clave]) || [];
  const actuales = cargado && grupo && cargado.clave === grupo.clave ? cargado.actuales : [];
  const dotacion = useMemo(
    () => ctx.empleados.filter((e) => !!grupo && e.objetivoPreferido === grupo.objectiveId),
    [ctx.empleados, grupo],
  );
  const cruce = useMemo(
    () => (cuadro && cuadro.filas.length ? cruzarGuardias(cuadro.filas, ctx.empleados, ctx.empresaId) : []),
    [cuadro, ctx.empleados, ctx.empresaId],
  );
  const cruceOk = useMemo(() => cruceResuelto(cruce, decisiones), [cruce, decisiones]);
  const faltan = useMemo(() => faltanEnPlanilla(cruceOk, dotacion), [cruceOk, dotacion]);
  const items = useMemo(() => (cuadro && grupo ? vistaPrevia({
    year: ctx.year,
    month: ctx.month,
    cuadro,
    reglas,
    cruce: cruceOk,
    incluirDudosos: false,
    turnos: grupo.turnos,
    actuales,
    diasCerrados: ctx.diasCerrados,
  }) : []), [ctx, cuadro, grupo, reglas, cruceOk, actuales]);
  const resumen = resumenPreview(items);
  const codigosSla = useMemo(() => [...new Set((grupo?.turnos || []).map((t) => t.code).filter(Boolean))], [grupo]);
  const importables = bloques.filter((b) => elecciones[b.key]?.importar);
  const destinoOk = importables.length > 0 && importables.every((b) => elecciones[b.key]?.objectiveId);
  const listoParaAplicar = !!grupo && !!cargado && cargado.clave === grupo.clave && !cargando;

  const grupoClave = grupo?.clave || '';
  const objectiveIdCarga = grupo?.objectiveId || '';
  useEffect(() => {
    if (paso < 3 || !grupoClave || !objectiveIdCarga) return;
    if (cargado?.clave === grupoClave) return;
    let vivo = true;
    setCargando(true);
    void cargarRef.current(objectiveIdCarga).then((r) => {
      if (!vivo) return;
      setCargado({ clave: grupoClave, actuales: r.actuales, reglas: r.reglas });
      setCargando(false);
    }).catch(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [paso, grupoClave, objectiveIdCarga, cargado?.clave]);

  useEffect(() => {
    if (!cuadro || !grupo || !cargado || cargado.clave !== grupo.clave) return;
    setReglasPorClave((prev) => (prev[grupo.clave] ? prev : { ...prev, [grupo.clave]: proponerReglas(cuadro, cargado.reglas) }));
  }, [cuadro, grupo, cargado]);

  const leer = async (file: File) => {
    setError('');
    setArchivo(file.name);
    try {
      const { celdasDesdeArrayBuffer } = await import('@/lib/planificacion/importarExcelXlsx');
      const buf = await file.arrayBuffer();
      const hallados = detectarCuadros(celdasDesdeArrayBuffer(buf), ctx.year, ctx.month);
      if (!hallados.length) {
        setCuadros([]);
        setElecciones({});
        setError('No encontré una grilla de días 1 a 31 en la primera hoja.');
        return;
      }
      const sugeridos = new Set(sugerirCuadros(hallados));
      const next: Record<string, Eleccion> = {};
      for (const b of bloquesDeCuadros(hallados)) next[b.key] = eleccionInicial(b, file.name, ctx, sugeridos);
      setCuadros(hallados);
      setElecciones(next);
      setDecisiones({});
      setReglasPorClave({});
      setGrupoIdx(0);
      setCargado(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer el archivo.');
    }
  };

  const ponerObjetivo = (key: string, o: ObjetivoCatalogo) => {
    setElecciones((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        clienteId: o.clienteId,
        objectiveId: o.id,
        servicioId: serviciosDe(ctx, o.id)[0]?.id || '',
      },
    }));
    setBusquedaDestino((prev) => ({ ...prev, [key]: '' }));
  };

  const irACodigos = () => {
    if (!cuadro || !grupo) return;
    setReglasPorClave((prev) => (prev[grupo.clave] ? prev : { ...prev, [grupo.clave]: proponerReglas(cuadro, cargado?.reglas || []) }));
    setPaso(5);
  };

  const aplicar = async () => {
    if (!grupo || !listoParaAplicar) return;
    const quedaOtro = grupoIdx < grupos.length - 1;
    const ok = await onAplicar({
      clientId: grupo.clienteId,
      objectiveId: grupo.objectiveId,
      objectiveName: grupo.nombre,
      items,
      reglas,
      sinServicio: grupo.sinServicio,
      quedaOtro,
    });
    if (!ok) return;
    if (quedaOtro) {
      setGrupoIdx((i) => i + 1);
      setPaso(3);
    }
  };

  const opciones = ['ignorar', 'doce', 'RET', ...FRANCOS, ...LICENCIAS, ...codigosSla, 'M', 'T', 'N', 'D12', 'N12', 'ESC', 'REF'];
  const opcionesUnicas = [...new Set(opciones)];
  const tituloPaso = grupo && paso >= 3
    ? `${grupo.clienteNombre ? `${grupo.clienteNombre} · ` : ''}${grupo.nombre}${grupos.length > 1 ? ` · objetivo ${grupoIdx + 1} de ${grupos.length}` : ''}`
    : paso === 2 ? 'Elegir destino' : 'Planificación';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-4" data-importar-excel-modal>
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <FileSpreadsheet className="text-indigo-600" size={18} />
          <div className="min-w-0">
            <h2 className="text-sm font-black text-slate-800">Importar planilla · {tituloPaso}</h2>
            <p className="text-[11px] text-slate-500">{ctx.mesLabel} · paso {paso} de 6 · queda en borrador hasta Guardar cronograma</p>
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
                <div key={c.indice} data-cuadro-detectado className="rounded-2xl border border-slate-200 px-3 py-2 text-[12px] text-slate-700 shadow-sm">
                  <span className="font-black">Cuadro {c.indice + 1}</span>
                  {c.titulo ? ` · ${c.titulo}` : ''} · {c.filas.length} guardias · letras {c.letras || '—'}
                  {c.avisoMes && <span className="mt-1 flex items-center gap-1 text-amber-800"><AlertTriangle size={12} />{c.avisoMes}</span>}
                </div>
              ))}
              {cuadros.length > 0 && <p className="text-[12px] text-slate-500">En el paso siguiente elegís a qué objetivo va cada cuadro.</p>}
            </div>
          )}

          {paso === 2 && (
            <div className="space-y-3">
              {bloques.map((b) => {
                const el = elecciones[b.key];
                if (!el) return null;
                const cuadroSrc = cuadros.find((c) => c.indice === b.cuadroIndice);
                const propuesta: PropuestaDestino | null = proponerDestino([archivo, b.titulo, b.etiqueta], ctx.objetivos);
                const elegido = ctx.objetivos.find((o) => o.id === el.objectiveId);
                const q = busquedaDestino[b.key] || '';
                const qn = normPlanilla(q);
                const coincidencias = qn.length < 2 ? [] : ctx.objetivos.filter((o) => normPlanilla(`${o.clienteNombre} ${o.nombre}`).includes(qn)).slice(0, 8);
                const servs = el.objectiveId ? serviciosDe(ctx, el.objectiveId) : [];
                return (
                  <div key={b.key} className={`rounded-2xl border px-3 py-3 shadow-sm ${el.importar ? 'border-slate-200' : 'border-slate-100 bg-slate-50 opacity-70'}`}>
                    <div className="flex flex-wrap items-center gap-2 text-[12px] text-slate-700">
                      <span className="font-black">Cuadro {b.cuadroIndice + 1}</span>
                      {b.titulo ? <span>· {b.titulo}</span> : null}
                      {b.etiqueta ? <span>· {b.etiqueta}</span> : null}
                      <span>· {b.filas.length} {b.filas.length === 1 ? 'guardia' : 'guardias'}</span>
                      <label className="ml-auto flex items-center gap-1 font-bold text-slate-500">
                        <input
                          data-no-importar
                          type="checkbox"
                          checked={!el.importar}
                          onChange={(e) => setElecciones((prev) => ({ ...prev, [b.key]: { ...el, importar: !e.target.checked } }))}
                        />
                        No importar
                      </label>
                    </div>
                    {cuadroSrc?.avisoMes && <p className="mt-1 flex items-center gap-1 text-[12px] text-amber-800"><AlertTriangle size={12} />{cuadroSrc.avisoMes}</p>}
                    {el.importar && (
                      <div className="mt-2 space-y-2">
                        {propuesta && propuesta.confianza >= 40 && (
                          <p data-destino-propuesta className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-[12px] text-indigo-900">
                            <span>Propuesta: {propuesta.clienteNombre ? `${propuesta.clienteNombre} · ` : ''}{propuesta.nombre} · {propuesta.confianza}% · {propuesta.motivo}</span>
                            {propuesta.objectiveId !== el.objectiveId && (
                              <button
                                type="button"
                                data-usar-propuesta
                                className="rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-black text-white"
                                onClick={() => {
                                  const o = ctx.objetivos.find((x) => x.id === propuesta.objectiveId);
                                  if (o) ponerObjetivo(b.key, o);
                                }}
                              >
                                Usar esta propuesta
                              </button>
                            )}
                          </p>
                        )}
                        {elegido ? (
                          <p data-destino-elegido className="flex items-center gap-2 text-[12px] font-bold text-slate-800">
                            {elegido.clienteNombre} · {elegido.nombre}
                            <button type="button" className="font-bold text-indigo-600" onClick={() => setElecciones((prev) => ({ ...prev, [b.key]: { ...el, clienteId: '', objectiveId: '', servicioId: '' } }))}>Cambiar</button>
                          </p>
                        ) : (
                          <p className="text-[12px] text-slate-500">Elegí cliente y objetivo.</p>
                        )}
                        <input
                          data-destino-buscar
                          value={q}
                          onChange={(e) => setBusquedaDestino((prev) => ({ ...prev, [b.key]: e.target.value }))}
                          placeholder="Buscar cliente u objetivo"
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-[12px]"
                        />
                        {coincidencias.length > 0 && (
                          <div className="max-h-36 overflow-y-auto rounded-xl border border-slate-100">
                            {coincidencias.map((o) => (
                              <button
                                key={o.id}
                                type="button"
                                data-destino-opcion={o.id}
                                className="block w-full px-3 py-1.5 text-left text-[12px] hover:bg-slate-50"
                                onClick={() => ponerObjetivo(b.key, o)}
                              >
                                {o.clienteNombre} · {o.nombre}
                              </button>
                            ))}
                          </div>
                        )}
                        {el.objectiveId && (
                          <div className="space-y-1">
                            {servs.map((s) => (
                              <label key={s.id} data-destino-servicio={s.id} className="flex items-start gap-2 rounded-xl border border-slate-200 px-3 py-2 text-[12px] text-slate-700">
                                <input
                                  type="radio"
                                  name={`srv-${b.key}`}
                                  className="mt-1"
                                  checked={el.servicioId === s.id}
                                  onChange={() => setElecciones((prev) => ({ ...prev, [b.key]: { ...el, servicioId: s.id } }))}
                                />
                                <span>
                                  <span className="font-black">{fechaCorta(s.desde)} → {fechaCorta(s.hasta)}</span>
                                  {s.puestos.map((p) => (
                                    <span key={p.nombre} className="mt-0.5 block text-slate-500">{p.nombre}{p.franjas ? ` · ${p.franjas}` : ''}</span>
                                  ))}
                                </span>
                              </label>
                            ))}
                            <label data-destino-servicio="sin" className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-[12px] text-slate-700">
                              <input
                                type="radio"
                                name={`srv-${b.key}`}
                                checked={!el.servicioId}
                                onChange={() => setElecciones((prev) => ({ ...prev, [b.key]: { ...el, servicioId: '' } }))}
                              />
                              Sin servicio
                            </label>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {paso === 3 && grupo && cuadro && (
            <div className="space-y-2">
              <p className="text-[12px] text-slate-500">{grupo.clienteNombre ? `${grupo.clienteNombre} · ` : ''}{grupo.nombre}</p>
              <ServicioPlanillaEditor
                cuadro={cuadro}
                year={ctx.year}
                month={ctx.month}
                mesLabel={ctx.mesLabel}
                servicioId={grupo.servicioId}
                puedeCrear={puedeCrearServicio}
                puedeActualizar={puedeEditarServicio}
                hayOtroServicio={!grupo.servicioId && serviciosEstado.some((s) => s.objectiveId === grupo.objectiveId)}
                vigente={grupo.turnos.filter((t) => t.startTime && t.endTime).map((t) => ({
                  puesto: t.positionName,
                  code: t.code,
                  startTime: t.startTime,
                  endTime: t.endTime,
                  cantidad: t.quantity || 1,
                  dias: t.dias || [],
                }))}
                onGuardar={async (accion, franjas, equivalencias) => {
                  const res = await aplicarServicioPlanilla({
                    accion,
                    servicioId: grupo.servicioId,
                    clientId: grupo.clienteId,
                    clientName: grupo.clienteNombre,
                    objectiveId: grupo.objectiveId,
                    objectiveName: grupo.nombre,
                    empresaId: ctx.empresaId,
                    migracionCompleta,
                    year: ctx.year,
                    month: ctx.month,
                    franjas,
                    equivalencias,
                    otros: serviciosEstado.map((s) => ({
                      id: s.id,
                      objectiveId: s.objectiveId,
                      clientId: s.clientId || ctx.objetivos.find((o) => o.id === s.objectiveId)?.clienteId || '',
                      startDate: s.desde,
                      endDate: s.hasta,
                    })),
                  });
                  const { startDate, endDate } = rangoMes(ctx.year, ctx.month);
                  const turnos = franjas.map((f) => ({
                    positionName: f.puesto,
                    code: f.code,
                    startTime: f.startTime,
                    endTime: f.endTime,
                    quantity: f.cantidad,
                    dias: f.dias,
                  }));
                  setServiciosEstado((prev) => {
                    if (accion === 'crear') {
                      return [...prev, {
                        id: res.id,
                        objectiveId: grupo.objectiveId,
                        clientId: grupo.clienteId,
                        desde: startDate,
                        hasta: endDate,
                        puestos: [],
                        turnos,
                      }];
                    }
                    return prev.map((s) => (s.id === grupo.servicioId ? { ...s, turnos } : s));
                  });
                  if (accion === 'crear') {
                    setElecciones((prev) => {
                      const next = { ...prev };
                      for (const b of grupo.bloques) {
                        const el = next[b.key];
                        if (el) next[b.key] = { ...el, servicioId: res.id };
                      }
                      return next;
                    });
                  }
                  const base = proponerReglas(cuadro, []);
                  setReglasPorClave((prev) => ({ ...prev, [`${grupo.objectiveId}|${accion === 'crear' ? res.id : grupo.servicioId}`]: reglasConEquivalencias(base, equivalencias) }));
                  onServicioGuardado();
                }}
              />
            </div>
          )}

          {paso === 4 && (
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

          {paso === 5 && (
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
                        onChange={(e) => {
                          if (!grupo) return;
                          const valor = e.target.value;
                          setReglasPorClave((prev) => ({
                            ...prev,
                            [grupo.clave]: (prev[grupo.clave] || []).map((x) => x.clave === r.clave ? reglaDesdeValor(x, valor) : x),
                          }));
                        }}
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

          {paso === 6 && (
            <div className="space-y-2 text-[12px] text-slate-700" data-importar-resumen>
              {cargando && <p className="text-slate-500">Leyendo lo que ya está en la grilla…</p>}
              <p><b>{resumen.nuevas}</b> nuevas · <b>{resumen.cambian}</b> cambian · <b>{resumen.iguales}</b> iguales · <b>{resumen.noToca}</b> no se tocan</p>
              <p className="text-slate-500">
                Lo igual no se reescribe. Licencias, días cerrados y celdas ignoradas quedan como están.
                {grupoIdx < grupos.length - 1
                  ? ` Al aplicar se abre ${grupo?.nombre || 'el objetivo'} con el borrador y sigue el objetivo siguiente.`
                  : ' Al aplicar se abre la grilla de ese objetivo con el borrador.'}
              </p>
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
          {paso < 6 ? (
            <button
              type="button"
              data-importar-siguiente
              disabled={paso === 1 ? cuadros.length === 0 : paso === 2 ? !destinoOk : false}
              onClick={() => (paso === 4 ? irACodigos() : paso === 2 ? (setGrupoIdx(0), setPaso(3)) : setPaso((p) => p + 1))}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-[12px] font-black text-white disabled:opacity-40"
            >
              {paso === 3 && grupo?.sinServicio ? 'Seguir sin servicio' : paso === 3 ? 'Seguir con este servicio' : 'Siguiente'}
            </button>
          ) : (
            <button
              type="button"
              data-importar-aplicar
              disabled={!listoParaAplicar}
              onClick={() => { void aplicar(); }}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-[12px] font-black text-white disabled:opacity-40"
            >
              {grupoIdx < grupos.length - 1 ? 'Siguiente objetivo' : 'Aplicar borrador'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
