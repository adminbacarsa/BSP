/**
 * «Preparar el mes» desde la pantalla principal de Planificación: simula «Continuar» y «Armar el mes» en todos los
 * objetivos (o los de un cliente o un grupo) y muestra cuál conviene en cada uno. Solo lectura: no escribe nada.
 */
import React, { useMemo, useRef, useState } from 'react';
import { collection, getDocs, query, Timestamp, where } from 'firebase/firestore';
import { CalendarRange, Loader2, X, ExternalLink, Wand2, Repeat } from 'lucide-react';
import { db } from '@/lib/firebase';
import { empresaCollectionQuery, fetchPlanificacionPublishStatus } from '@/lib/multiempresa';
import { filterSlasForPlanningTenant } from '@/lib/slaPlanningMatch';
import type { Estrategia, Metricas } from '@/lib/planificacion/prepararMes';
import { correrTanda, unidadesDelMes, type FilaTanda, type ModoTanda } from '@/lib/planificacion/prepararMesTanda';
import type { GrupoObjetivos } from '@/services/gruposService';

type Modo = ModoTanda;
type Fila = FilaTanda;

type Props = {
  open: boolean;
  onClose: () => void;
  empresaId: string;
  scopeEmpresa: boolean;
  clients: any[];
  employees: any[];
  grupos: GrupoObjetivos[];
  slaIdToObjId: Record<string, string>;
  /** Turnos del mes (toda la empresa), clave `${empId}_${yyyy-mm-dd}`. */
  shiftsMap: Record<string, any>;
  absencesMap: Record<string, any>;
  year: number;
  /** 0-11 */
  month: number;
  onAbrirObjetivo: (clientId: string, objectiveId: string) => void;
};

const TEXTO_ESTADO: Record<Fila['estado'], string> = {
  ok: '',
  publicado: 'Ya publicado: no se toca',
  sin_servicio: 'Sin servicio',
  sin_guardias: 'Sin guardias en la dotación',
  error: 'No se pudo simular',
};

function CeldaMetricas({ m, elegida }: { m?: Metricas; elegida: boolean }) {
  if (!m) return <td className="px-2 py-1.5 text-slate-300" colSpan={4}>—</td>;
  const c = (v: number, malo: boolean) => <span className={malo && v > 0 ? 'text-rose-600 font-bold' : 'text-slate-600'}>{v}</span>;
  const bg = elegida ? 'bg-emerald-50' : '';
  return (
    <>
      <td className={`px-2 py-1.5 text-right tabular-nums ${bg}`}>{c(m.horasSinCubrir, true)}</td>
      <td className={`px-2 py-1.5 text-right tabular-nums ${bg}`}>{c(m.doce, true)}</td>
      <td className={`px-2 py-1.5 text-right tabular-nums ${bg}`}>{c(m.horasAl50, true)}</td>
      <td className={`px-2 py-1.5 text-right tabular-nums ${bg}`}><span className="text-slate-600">{m.ret}</span></td>
    </>
  );
}

export function PrepararMesModal(props: Props) {
  const { open, onClose, empresaId, scopeEmpresa, clients, employees, grupos, slaIdToObjId, shiftsMap, absencesMap, year, month } = props;
  const [alcance, setAlcance] = useState<string>('todos');
  const [modo, setModo] = useState<Modo>('auto');
  const [filas, setFilas] = useState<Fila[]>([]);
  const [corriendo, setCorriendo] = useState(false);
  const [avance, setAvance] = useState({ hechos: 0, total: 0, actual: '' });
  const cortar = useRef(false);

  const mesTxt = new Date(year, month, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  const unidades = useMemo(() => unidadesDelMes(clients, grupos), [clients, grupos]);

  const opcionesAlcance = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of unidades) for (const o of u.objetivos) if (!m.has(o.clientId)) m.set(o.clientId, u.grupo ? '' : u.cliente);
    for (const c of clients) if (m.has(String(c.id))) m.set(String(c.id), String(c.name || c.id));
    return [...m.entries()].sort((x, y) => x[1].localeCompare(y[1]));
  }, [unidades, clients]);

  const elegidas = (u: (typeof unidades)[number]) => (alcance === 'todos' ? true : alcance.startsWith('grupo:') ? u.key === alcance : u.objetivos.some((o) => o.clientId === alcance));

  const simular = async () => {
    cortar.current = false;
    setCorriendo(true);
    setFilas([]);
    const lista = unidades.filter(elegidas);
    setAvance({ hechos: 0, total: lista.length, actual: 'Cargando servicios…' });
    try {
      const snapSla = await getDocs(empresaCollectionQuery('servicios_sla', empresaId, scopeEmpresa));
      const tenantIds = new Set(clients.map((c: any) => String(c.id)));
      const allSla = filterSlasForPlanningTenant(snapSla.docs.map((d) => ({ id: d.id, ...(d.data() as any) })), empresaId, scopeEmpresa, tenantIds);
      await correrTanda({
        unidades: lista,
        year,
        month,
        modo,
        allSla,
        clients,
        employees,
        slaIdToObjId,
        shiftsMap,
        absencesMap,
        historia: async (oid, desde, hasta) => (await getDocs(query(collection(db, 'turnos'), where('objectiveId', '==', oid), where('startTime', '>=', Timestamp.fromDate(desde)), where('startTime', '<=', Timestamp.fromDate(hasta))))).docs.map((d) => ({ id: d.id, ...d.data() })),
        publicado: async (oid) => !!(await fetchPlanificacionPublishStatus(empresaId, oid, year, month + 1)),
        onFila: setFilas,
        onAvance: (hechos, total, actual) => setAvance({ hechos, total, actual }),
        cortado: () => cortar.current,
      });
    } catch (err) {
      console.error('[preparar mes]', err);
    } finally {
      setCorriendo(false);
    }
  };

  const resumen = useMemo(() => {
    const ok = filas.filter((f) => f.estado === 'ok');
    const m = (f: Fila) => (f.elegida === 'armar' ? f.armar : f.continuar);
    const completos = ok.filter((f) => (m(f)?.horasSinCubrir || 0) === 0 && (m(f)?.horasAl50 || 0) === 0);
    return {
      ok: ok.length,
      completos: completos.length,
      revisar: ok.length - completos.length,
      saltados: filas.length - ok.length,
      sinCubrir: ok.reduce((a, f) => a + (m(f)?.horasSinCubrir || 0), 0),
      al50: ok.reduce((a, f) => a + (m(f)?.horasAl50 || 0), 0),
      doce: ok.reduce((a, f) => a + (m(f)?.doce || 0), 0),
      ret: ok.reduce((a, f) => a + (m(f)?.ret || 0), 0),
      pedidas: ok.reduce((a, f) => a + (m(f)?.horasPedidas || 0), 0),
    };
  }, [filas]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-900/50 p-3" data-preparar-mes>
      <div className="flex max-h-[92vh] w-full max-w-[1200px] flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-lg font-black text-slate-800"><CalendarRange size={20} /> Preparar {mesTxt}</div>
            <div className="mt-0.5 text-[12px] text-slate-500">
              Simula la copia del mes anterior y el armado desde el servicio en cada objetivo y propone la mejor. Los grupos se arman como un solo cronograma.
              Vista previa: no escribe nada. Lo publicado no se toca.
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Cerrar"><X size={18} /></button>
        </div>

        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-5 py-3">
          <label className="text-[11px] font-bold text-slate-500">Para
            <select className="mt-1 block rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-800" value={alcance} onChange={(e) => setAlcance(e.target.value)} disabled={corriendo} data-preparar-alcance>
              <option value="todos">Toda la empresa ({unidades.length})</option>
              <optgroup label="Cliente">
                {opcionesAlcance.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
              </optgroup>
              {unidades.some((x) => x.grupo) && (
                <optgroup label="Grupo">
                  {unidades.filter((x) => x.grupo).map((x) => <option key={x.key} value={x.key}>{x.nombre}</option>)}
                </optgroup>
              )}
            </select>
          </label>
          <div className="text-[11px] font-bold text-slate-500">Cómo
            <div className="mt-1 flex overflow-hidden rounded-lg border border-slate-200" data-preparar-modo>
              {([['auto', 'Automático'], ['continuar', 'Copia del mes anterior'], ['armar', 'Armar desde el servicio']] as Array<[Modo, string]>).map(([k, t]) => (
                <button key={k} type="button" disabled={corriendo} onClick={() => setModo(k)} className={`px-3 py-1.5 text-sm ${modo === k ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{t}</button>
              ))}
            </div>
          </div>
          <div className="ml-auto flex gap-2">
            {corriendo
              ? <button type="button" onClick={() => { cortar.current = true; }} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600">Cortar</button>
              : <button type="button" onClick={() => { void simular(); }} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700" data-preparar-simular><Wand2 size={15} /> Ver vista previa</button>}
          </div>
        </div>

        {(corriendo || filas.length > 0) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2 text-[12px] text-slate-600" data-preparar-resumen>
            {corriendo && <span className="flex items-center gap-1.5 font-bold text-indigo-700"><Loader2 size={14} className="animate-spin" /> {avance.hechos}/{avance.total} · {avance.actual}</span>}
            <span><b>{resumen.ok}</b> para armar · <b className="text-emerald-700">{resumen.completos}</b> completos · <b className={resumen.revisar ? 'text-amber-700' : ''}>{resumen.revisar}</b> para revisar · {resumen.saltados} sin tocar</span>
            <span>Pedidas <b>{resumen.pedidas}</b> h · sin cubrir <b className={resumen.sinCubrir ? 'text-rose-600' : ''}>{resumen.sinCubrir}</b> h · al 50 % <b className={resumen.al50 ? 'text-rose-600' : ''}>{resumen.al50}</b> h · 12 h <b>{resumen.doce}</b> · RET <b>{resumen.ret}</b></span>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto px-5 pb-4">
          {!filas.length && !corriendo ? (
            <div className="py-12 text-center text-sm text-slate-400">Elegí para quién y cómo, y tocá «Ver vista previa».</div>
          ) : (
            <table className="w-full text-[12px]" data-preparar-tabla>
              <thead className="sticky top-0 bg-white text-[10px] uppercase text-slate-400">
                <tr>
                  <th className="px-2 py-1.5 text-left" rowSpan={2}>Objetivo</th>
                  <th className="px-2 py-1.5 text-right" rowSpan={2}>Pedidas</th>
                  <th className="px-2 py-1 text-center border-b border-slate-100" colSpan={4}><span className="inline-flex items-center gap-1"><Repeat size={11} /> Copia</span></th>
                  <th className="px-2 py-1 text-center border-b border-slate-100" colSpan={4}><span className="inline-flex items-center gap-1"><Wand2 size={11} /> Armar</span></th>
                  <th className="px-2 py-1.5 text-left" rowSpan={2}>Usar</th>
                  <th rowSpan={2} />
                </tr>
                <tr>
                  {[0, 1].map((k) => (
                    <React.Fragment key={k}>
                      <th className="px-2 py-1 text-right" title="Horas del servicio sin nadie">sin cubrir</th>
                      <th className="px-2 py-1 text-right" title="Turnos D12/N12">12 h</th>
                      <th className="px-2 py-1 text-right" title="Horas que pasan de 200 por guardia">al 50 %</th>
                      <th className="px-2 py-1 text-right" title="Días en RET">RET</th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.key} className="border-t border-slate-100 align-top" data-preparar-fila={f.key}>
                    <td className="px-2 py-1.5">
                      <div className="font-bold text-slate-800">{f.nombre}{f.grupo && <span className="ml-1.5 rounded border border-slate-200 px-1 text-[10px] font-bold text-slate-500">grupo</span>}</div>
                      <div className="text-[11px] text-slate-400">{f.cliente}</div>
                      {f.estado !== 'ok' && <div className="text-[11px] font-bold text-slate-500">{TEXTO_ESTADO[f.estado]}</div>}
                      {f.notas.map((n) => <div key={n} className="text-[11px] text-amber-700">{n}</div>)}
                      {f.porQue && <div className="text-[11px] text-slate-500">Recomendada: {f.recomendada === 'armar' ? 'armar' : 'copia'} ({f.porQue})</div>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{f.continuar?.horasPedidas ?? '—'}</td>
                    <CeldaMetricas m={f.continuar} elegida={f.elegida === 'continuar'} />
                    <CeldaMetricas m={f.armar} elegida={f.elegida === 'armar'} />
                    <td className="px-2 py-1.5">
                      {f.estado === 'ok' && (
                        <select className="rounded border border-slate-200 px-1 py-0.5 text-[12px]" value={f.elegida} onChange={(e) => setFilas((prev) => prev.map((x) => (x.key === f.key ? { ...x, elegida: e.target.value as Estrategia } : x)))} data-preparar-elegida={f.key}>
                          <option value="continuar">Copia</option>
                          <option value="armar">Armar</option>
                        </select>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <button type="button" title="Abrir la grilla de este objetivo" onClick={() => props.onAbrirObjetivo(f.objetivos[0].clientId, f.objetivos[0].id)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><ExternalLink size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="border-t border-slate-100 px-5 py-2.5 text-[11px] text-slate-400">
          Cada objetivo cuenta lo que la tanda ya le dio a cada guardia en los anteriores (no queda en dos lugares el mismo día y sus horas suman). Cambiar «Usar» no vuelve a simular los que siguen.
        </div>
      </div>
    </div>
  );
}
