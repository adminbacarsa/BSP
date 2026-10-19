/**
 * «Preparar el mes» desde la pantalla principal de Planificación: simula «Continuar» y «Armar el mes» en todos los
 * objetivos (o los de un cliente o un grupo) y muestra cuál conviene en cada uno. Solo lectura: no escribe nada.
 * Va en un portal: la barra de la grilla no lo tapa.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { collection, getDocs, query, Timestamp, where } from 'firebase/firestore';
import { CalendarRange, ChevronDown, ChevronRight, ExternalLink, Loader2, Wand2, X } from 'lucide-react';
import { db } from '@/lib/firebase';
import { readSessionJson, writeSessionJson } from '@/lib/persistSession';
import { empresaCollectionQuery, fetchPlanificacionPublishStatus } from '@/lib/multiempresa';
import { filterSlasForPlanningTenant } from '@/lib/slaPlanningMatch';
import type { Estrategia, Metricas } from '@/lib/planificacion/prepararMes';
import { correrTanda, unidadesDelMes, type FilaTanda, type ModoTanda } from '@/lib/planificacion/prepararMesTanda';
import type { GrupoObjetivos } from '@/services/gruposService';

type Fila = FilaTanda;
type Vista = 'revisar' | 'completo' | 'cargado' | 'fuera';

type Props = {
  open: boolean;
  onClose: () => void;
  /** La pastilla «Volver» (con el panel cerrado y resultados guardados). */
  onReabrir: () => void;
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
  onAbrirObjetivo: (clientId: string, objectiveId: string, grupoKey?: string) => void;
};

const TEXTO_FUERA: Record<Fila['estado'], string> = {
  ok: '',
  publicado: 'Ya publicado',
  sin_servicio: 'Sin servicio',
  sin_guardias: 'Sin guardias',
  error: 'No se pudo simular',
};

const COLUMNAS = 'grid grid-cols-[minmax(0,1fr)_60px_136px_72px_52px_60px_48px_32px] items-center gap-x-2';

const metricasDe = (f: Fila): Metricas | undefined => (f.elegida === 'armar' ? f.armar : f.continuar);
const otraDe = (f: Fila): Metricas | undefined => (f.elegida === 'armar' ? f.continuar : f.armar);

function vistaDe(f: Fila): Vista {
  if (f.estado !== 'ok') return 'fuera';
  const m = metricasDe(f);
  if (!m) return 'fuera';
  if (m.horasSinCubrir === 0 && m.horasAl50 === 0) return m.propuestas === 0 ? 'cargado' : 'completo';
  return 'revisar';
}

/** Notas largas → chips cortos; el texto completo queda en el tooltip. */
function chipsDe(notas: string[]): Array<{ texto: string; title: string }> {
  const out: Array<{ texto: string; title: string }> = [];
  const servicio = notas.filter((n) => /sin activar/.test(n));
  if (servicio.length) out.push({ texto: 'servicio a activar', title: servicio.join('\n') });
  for (const n of notas) {
    const m = n.match(/ya tiene (\d+) celdas cargadas/);
    if (m) out.push({ texto: `${m[1]} celdas ya cargadas`, title: 'Lo que ya está cargado en el mes no se toca.' });
    else if (!/sin activar/.test(n)) out.push({ texto: n, title: n });
  }
  return out;
}

function resumenOtra(f: Fila): string {
  const o = otraDe(f);
  if (!o) return '';
  const partes = [o.horasSinCubrir ? `${o.horasSinCubrir} h sin cubrir` : 'cubre todo'];
  if (o.doce) partes.push(`${o.doce} de 12 h`);
  if (o.horasAl50) partes.push(`${o.horasAl50} h al 50 %`);
  return `${f.elegida === 'armar' ? 'copia' : 'armar'}: ${partes.join(' · ')}`;
}

export function PrepararMesModal(props: Props) {
  const { open, onClose, empresaId, scopeEmpresa, clients, employees, grupos, slaIdToObjId, shiftsMap, absencesMap, year, month } = props;
  const [alcance, setAlcance] = useState<string>('todos');
  const [modo, setModo] = useState<ModoTanda>('auto');
  const [filas, setFilas] = useState<Fila[]>([]);
  const [corriendo, setCorriendo] = useState(false);
  const [avance, setAvance] = useState({ hechos: 0, total: 0, actual: '' });
  const [vista, setVista] = useState<Vista>('revisar');
  const [verFuera, setVerFuera] = useState(false);
  const cortar = useRef(false);
  const [simuladoAt, setSimuladoAt] = useState<number | null>(null);

  // La vista previa se guarda por empresa y mes en la pestaña: entrar a un objetivo o recargar no la pierde.
  const clave = `cosp-preparar-mes:${empresaId}:${year}-${String(month + 1).padStart(2, '0')}`;
  const cargada = useRef<string | null>(null);
  useEffect(() => {
    const g = readSessionJson<{ filas: Fila[]; alcance: string; modo: ModoTanda; vista: Vista; at: number }>(clave);
    setFilas(g?.filas || []);
    if (g) { setAlcance(g.alcance || 'todos'); setModo(g.modo || 'auto'); setVista(g.vista || 'revisar'); }
    setSimuladoAt(g?.at || null);
    cargada.current = clave;
  }, [clave]);
  useEffect(() => {
    if (cargada.current !== clave || corriendo) return;
    if (filas.length) writeSessionJson(clave, { filas, alcance, modo, vista, at: simuladoAt || Date.now() });
  }, [clave, filas, alcance, modo, vista, simuladoAt, corriendo]);

  const mesTxt = new Date(year, month, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  const unidades = useMemo(() => unidadesDelMes(clients, grupos), [clients, grupos]);

  const opcionesAlcance = useMemo(() => {
    const ids = new Set(unidades.flatMap((u) => u.objetivos.map((o) => o.clientId)));
    return clients
      .filter((c: any) => ids.has(String(c.id)))
      .map((c: any) => [String(c.id), String(c.name || c.id)] as [string, string])
      .sort((x, y) => x[1].localeCompare(y[1]));
  }, [unidades, clients]);

  const elegidas = (u: (typeof unidades)[number]) => (alcance === 'todos' ? true : alcance.startsWith('grupo:') ? u.key === alcance : u.objetivos.some((o) => o.clientId === alcance));

  const simular = async () => {
    cortar.current = false;
    setCorriendo(true);
    setFilas([]);
    setVista('revisar');
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
      setSimuladoAt(Date.now());
      setCorriendo(false);
    }
  };

  const conteo = useMemo(() => {
    const n: Record<Vista, number> = { revisar: 0, completo: 0, cargado: 0, fuera: 0 };
    for (const f of filas) n[vistaDe(f)] += 1;
    const ok = filas.filter((f) => f.estado === 'ok');
    const sum = (k: keyof Metricas) => ok.reduce((a, f) => a + Number(metricasDe(f)?.[k] || 0), 0);
    return { n, pedidas: sum('horasPedidas'), sinCubrir: sum('horasSinCubrir'), doce: sum('doce'), al50: sum('horasAl50'), ret: sum('ret') };
  }, [filas]);

  const visibles = useMemo(() => filas
    .filter((f) => vistaDe(f) === vista)
    .sort((x, y) => (metricasDe(y)?.horasSinCubrir || 0) - (metricasDe(x)?.horasSinCubrir || 0) || x.nombre.localeCompare(y.nombre)), [filas, vista]);
  const fuera = useMemo(() => filas.filter((f) => vistaDe(f) === 'fuera'), [filas]);

  if (typeof document === 'undefined') return null;
  if (!open) {
    if (!filas.length || corriendo) return null;
    const mesCorto = new Date(year, month, 1).toLocaleDateString('es-AR', { month: 'long' });
    return createPortal(
      <button
        type="button"
        onClick={props.onReabrir}
        data-preparar-volver
        className="fixed bottom-4 left-1/2 z-[2900] flex -translate-x-1/2 items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-[12px] font-bold text-slate-700 shadow-lg hover:bg-slate-50"
      >
        <CalendarRange size={15} /> Preparar {mesCorto}
        <span className={conteo.n.revisar ? 'text-amber-600' : 'text-emerald-600'}>· {conteo.n.revisar ? `${conteo.n.revisar} para revisar` : 'todo completo'}</span>
        <span className="text-indigo-600">· Volver</span>
      </button>,
      document.body,
    );
  }

  const tarjeta = (k: Exclude<Vista, 'fuera'>, titulo: string, tono: string) => (
    <button
      key={k}
      type="button"
      onClick={() => setVista(k)}
      data-preparar-tarjeta={k}
      className={`min-w-[140px] flex-1 rounded-xl border px-3 py-2 text-left transition-colors ${vista === k ? 'border-slate-800 bg-slate-800' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
    >
      <div className={`text-2xl font-black tabular-nums ${vista === k ? 'text-white' : tono}`}>{conteo.n[k]}</div>
      <div className={`text-[11px] font-bold ${vista === k ? 'text-slate-200' : 'text-slate-500'}`}>{titulo}</div>
    </button>
  );

  const num = (v: number | undefined, malo = true) => <span className={`tabular-nums ${malo && v ? 'font-bold text-rose-600' : 'text-slate-500'}`}>{v ?? '—'}</span>;

  return createPortal(
    <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-slate-900/50 p-3" data-preparar-mes onMouseDown={(e) => { if (e.target === e.currentTarget && !corriendo) onClose(); }}>
      <div className="flex max-h-[94vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-lg font-black text-slate-800"><CalendarRange size={20} /> Preparar {mesTxt}</div>
            <div className="mt-0.5 text-[12px] text-slate-500">Vista previa: compara la copia del mes anterior con el armado desde el servicio en cada objetivo. No escribe nada.</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Cerrar"><X size={18} /></button>
        </div>

        <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 bg-white px-5 py-3">
          <label className="text-[11px] font-bold text-slate-500">Para
            <select className="mt-1 block min-w-[220px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800" value={alcance} onChange={(e) => setAlcance(e.target.value)} disabled={corriendo} data-preparar-alcance>
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
              {([['auto', 'Lo mejor en cada uno'], ['continuar', 'Copia'], ['armar', 'Armar']] as Array<[ModoTanda, string]>).map(([k, t]) => (
                <button key={k} type="button" disabled={corriendo} onClick={() => setModo(k)} className={`px-3 py-1.5 text-sm ${modo === k ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{t}</button>
              ))}
            </div>
          </div>
          <div className="ml-auto">
            {corriendo
              ? <button type="button" onClick={() => { cortar.current = true; }} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-600">Cortar</button>
              : <button type="button" onClick={() => { void simular(); }} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700" data-preparar-simular><Wand2 size={15} /> {filas.length ? 'Volver a simular' : 'Ver vista previa'}</button>}
          </div>
        </div>

        {corriendo && (
          <div className="border-b border-slate-200 bg-white px-5 py-2" data-preparar-avance>
            <div className="flex items-center gap-2 text-[12px] font-bold text-indigo-700"><Loader2 size={14} className="animate-spin" /> {avance.hechos} de {avance.total} · {avance.actual}</div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${avance.total ? Math.round((100 * avance.hechos) / avance.total) : 0}%` }} /></div>
          </div>
        )}

        {filas.length > 0 && (
          <div className="space-y-2 px-5 pt-3" data-preparar-resumen>
            <div className="flex flex-wrap gap-2">
              {tarjeta('revisar', 'Para revisar', conteo.n.revisar ? 'text-amber-600' : 'text-slate-400')}
              {tarjeta('completo', 'Completos', 'text-emerald-600')}
              {tarjeta('cargado', 'Ya armados', 'text-slate-600')}
            </div>
            <div className="text-[12px] text-slate-500">
              {simuladoAt ? `Simulado a las ${new Date(simuladoAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} · ` : ''}Piden {conteo.pedidas.toLocaleString('es-AR')} h · sin cubrir <b className={conteo.sinCubrir ? 'text-rose-600' : ''}>{conteo.sinCubrir.toLocaleString('es-AR')} h</b> · al 50 % <b className={conteo.al50 ? 'text-rose-600' : ''}>{conteo.al50} h</b> · {conteo.doce} turnos de 12 h · {conteo.ret} días en RET
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          {!filas.length && !corriendo ? (
            <div className="py-16 text-center text-sm text-slate-400">Elegí para quién y cómo, y tocá «Ver vista previa». Para toda la empresa tarda alrededor de un minuto.</div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white" data-preparar-tabla>
              <div className={`${COLUMNAS} sticky top-0 border-b border-slate-100 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-400`}>
                <div>Objetivo</div>
                <div className="text-right">Piden</div>
                <div className="text-center">Usar</div>
                <div className="text-right" title="Horas del servicio sin nadie">Sin cubrir</div>
                <div className="text-right" title="Turnos D12/N12">12 h</div>
                <div className="text-right" title="Horas que pasan de 200 por guardia">Al 50 %</div>
                <div className="text-right" title="Días en RET: disponibles para otro objetivo">RET</div>
                <div />
              </div>
              {visibles.length === 0 && <div className="px-3 py-6 text-center text-[12px] text-slate-400">{corriendo ? 'Simulando…' : 'Nada en esta vista.'}</div>}
              {visibles.map((f) => {
                const m = metricasDe(f);
                const otra = resumenOtra(f);
                return (
                  <div key={f.key} className={`${COLUMNAS} border-b border-slate-100 px-3 py-2 last:border-0`} data-preparar-fila={f.key}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate font-bold text-slate-800">{f.nombre}</span>
                        {f.grupo && <span className="rounded border border-slate-200 px-1 text-[10px] font-bold text-slate-500">grupo</span>}
                        {chipsDe(f.notas).map((c) => <span key={c.texto} title={c.title} className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">{c.texto}</span>)}
                      </div>
                      <div className="truncate text-[11px] text-slate-400" title={f.porQue ? `Recomendada: ${f.recomendada === 'armar' ? 'armar' : 'copia'} (${f.porQue})` : undefined}>
                        {f.cliente}{otra ? ` · ${otra}` : ''}
                      </div>
                    </div>
                    <div className="text-right text-[12px] tabular-nums text-slate-500">{m?.horasPedidas ?? '—'}</div>
                    <div className="flex justify-center">
                      <div className="flex overflow-hidden rounded-lg border border-slate-200 text-[11px]" data-preparar-elegida={f.key}>
                        {(['continuar', 'armar'] as Estrategia[]).map((e) => (
                          <button
                            key={e}
                            type="button"
                            title={f.recomendada === e ? `Recomendada: ${f.porQue}` : undefined}
                            onClick={() => setFilas((prev) => prev.map((x) => (x.key === f.key ? { ...x, elegida: e } : x)))}
                            className={`px-2 py-1 font-bold ${f.elegida === e ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                          >
                            {e === 'armar' ? 'Armar' : 'Copia'}{f.recomendada === e ? ' ★' : ''}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="text-right text-[12px]">{num(m?.horasSinCubrir)}</div>
                    <div className="text-right text-[12px]">{num(m?.doce)}</div>
                    <div className="text-right text-[12px]">{num(m?.horasAl50)}</div>
                    <div className="text-right text-[12px]">{num(m?.ret, false)}</div>
                    <button type="button" title="Abrir la grilla de este objetivo" onClick={() => props.onAbrirObjetivo(f.objetivos[0].clientId, f.objetivos[0].id, f.grupo ? f.key : undefined)} className="justify-self-end rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><ExternalLink size={14} /></button>
                  </div>
                );
              })}
            </div>
          )}

          {fuera.length > 0 && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-white" data-preparar-fuera>
              <button type="button" onClick={() => setVerFuera((v) => !v)} className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[12px] font-bold text-slate-500">
                {verFuera ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                No se arman ({fuera.length}): {(['sin_servicio', 'publicado', 'sin_guardias', 'error'] as Fila['estado'][])
                  .map((e) => ({ e, n: fuera.filter((f) => f.estado === e).length }))
                  .filter((x) => x.n)
                  .map((x) => `${x.n} ${TEXTO_FUERA[x.e].toLowerCase()}`)
                  .join(' · ')}
              </button>
              {verFuera && (
                <div className="grid grid-cols-1 gap-x-4 border-t border-slate-100 px-3 py-2 text-[12px] sm:grid-cols-2">
                  {fuera.map((f) => (
                    <div key={f.key} className="flex items-center justify-between gap-2 py-0.5">
                      <span className="truncate text-slate-700">{f.nombre} <span className="text-slate-400">· {f.cliente}</span></span>
                      <span className="shrink-0 text-[11px] text-slate-400" title={f.notas.join('\n') || undefined}>{TEXTO_FUERA[f.estado]}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="border-t border-slate-200 bg-white px-5 py-2.5 text-[11px] text-slate-400">
          ★ = recomendada (el motivo, al pasar el mouse). Cada objetivo cuenta lo que la tanda ya le dio a cada guardia en los anteriores. Cambiar la estrategia de una fila no vuelve a simular las demás.
        </div>
      </div>
    </div>,
    document.body,
  );
}
