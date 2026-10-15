import React, { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, ChevronDown, Clock, Moon, Repeat, Scale, ShieldAlert, X } from 'lucide-react';
import {
  textoDias,
  type AlertaCupo,
  type AlertaDescanso,
  type AlertaHoras,
  type AvisosCobertura,
  type ResultadoGuardia,
  type SugerenciaNivelacion,
} from '@/lib/planificacion/continuarMesAnterior';

export type DiaCorto = { dateStr: string; cerrados: number; requeridos: number };

export type ContinuarMesVista = {
  mesLabel: string;
  mesAnteriorLabel: string;
  resultados: ResultadoGuardia[];
  cortos: DiaCorto[];
  sobrados: AlertaCupo[];
  avisos: AvisosCobertura;
  descanso: AlertaDescanso[];
  tope: AlertaHoras[];
  /** Lectura por día de la semana: custom, juegos y lo que falta o sobra. */
  lectura?: string;
  /** El contrato no cubre el mes que se está armando. */
  activar?: {
    mes: string;
    marcado: boolean;
    puede: boolean;
    motivo: string;
    permiso: boolean;
  };
};

type Props = {
  vista: ContinuarMesVista;
  onAplicar: (employeeIds: string[], sugerencias: SugerenciaNivelacion[], activarServicio: boolean) => void;
  onCancelar: () => void;
};

/** Un renglón con título y resumen; el detalle se abre con un clic. */
function Seccion({ icon, titulo, tono, resumen, abierta = false, children }: { icon: React.ReactNode; titulo: string; tono: 'rojo' | 'ambar' | 'gris'; resumen?: string; abierta?: boolean; children: React.ReactNode }) {
  const cls = tono === 'rojo'
    ? 'border-rose-200 bg-rose-50 text-rose-800'
    : tono === 'ambar'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-slate-200 bg-slate-50 text-slate-700';
  return (
    <details open={abierta} className={`group rounded-lg border px-3 py-1.5 text-[11px] ${cls}`}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-1.5 font-black uppercase tracking-wide text-[10px]">{icon}{titulo}</span>
        {resumen && <span className="font-semibold opacity-80">· {resumen}</span>}
        <ChevronDown size={13} className="ml-auto shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-1.5 space-y-0.5 font-medium leading-snug">{children}</div>
    </details>
  );
}

function apellido(nombre: string): string {
  return String(nombre || '').split(',')[0].trim();
}

function claveSugerencia(s: SugerenciaNivelacion): string {
  return `${s.tipo || 'nivelacion'}|${s.celda.employeeId}|${s.dateStr}`;
}

type GrupoRevisar = { titulo: string; items: string[] };

/** «Para revisar» agrupado por tipo, con textos cortos: rachas cortadas, cambios de puesto y lo que no se propone. */
function gruposRevisar(resultados: ResultadoGuardia[]): GrupoRevisar[] {
  const rachas: string[] = [];
  const puesto: string[] = [];
  const otros: string[] = [];
  const dd = (dias: string[]) => dias.map((d) => d.slice(8)).join(', ');
  for (const r of resultados) {
    for (const x of r.revisar) {
      if (/^racha /.test(x.motivo)) rachas.push(`${apellido(r.nombre)}: ${x.code} del ${dd(x.dias)} → franco`);
      else if (/ lleno: /.test(x.motivo)) {
        const m = x.motivo.match(/^(.*) lleno: (\S+) en (.*)$/);
        puesto.push(m ? `${apellido(r.nombre)}: ${m[2]} del ${dd(x.dias)} pasa de ${m[1]} a ${m[3]}` : `${apellido(r.nombre)}: ${x.motivo} (${dd(x.dias)})`);
      } else if (x.propuestoEn) puesto.push(`${apellido(r.nombre)}: «${x.positionName}» ya no está; ${x.code} en «${x.propuestoEn}»`);
      else otros.push(`${apellido(r.nombre)}: ${x.motivo} (${x.code}, ${dd(x.dias)}). No se propone.`);
    }
  }
  const out: GrupoRevisar[] = [];
  if (rachas.length) out.push({ titulo: `Rachas cortadas por el tope (6 turnos o 56 h seguidas) (${rachas.length})`, items: rachas });
  if (puesto.length) out.push({ titulo: `Pasan a otro puesto porque el suyo estaba lleno (${puesto.length})`, items: puesto });
  if (otros.length) out.push({ titulo: `Sin proponer (${otros.length})`, items: otros });
  return out;
}

/** Un renglón por cambio de puesto (todos los guardias juntos) y uno por guardia cuando no se propone. */
function agruparRevisar(resultados: ResultadoGuardia[]): Array<{ texto: string; propuesto: boolean }> {
  const reasignados = new Map<string, { de: string; a: string; guardias: Set<string>; codes: Set<string> }>();
  const sinProponer: Array<{ texto: string; propuesto: boolean }> = [];
  for (const r of resultados) {
    for (const x of r.revisar) {
      if (x.propuestoEn) {
        const k = `${x.positionName}|${x.propuestoEn}`;
        const g = reasignados.get(k) || { de: x.positionName, a: x.propuestoEn, guardias: new Set<string>(), codes: new Set<string>() };
        g.guardias.add(apellido(r.nombre));
        g.codes.add(x.code);
        reasignados.set(k, g);
      } else if (/^racha /.test(x.motivo)) {
        sinProponer.push({ texto: `${r.nombre}: ${x.code} los días ${textoDias(x.dias)} pasaba el tope de racha (6 turnos o 56 h seguidas): queda de franco.`, propuesto: true });
      } else if (/ lleno: /.test(x.motivo)) {
        // Su puesto estaba lleno ese día: el turno se propone en el puesto que tenía la banda libre.
        sinProponer.push({ texto: `${r.nombre}: ${x.motivo} (días ${textoDias(x.dias)}). Se propone ahí.`, propuesto: true });
      } else {
        sinProponer.push({ texto: `${r.nombre}: ${x.motivo} (${x.code}, días ${textoDias(x.dias)}). No se propone.`, propuesto: false });
      }
    }
  }
  const out = [...reasignados.values()].map((g) => ({
    texto: `«${g.de}» ya no está en el servicio: se propone en «${g.a}» (${[...g.codes].join(', ')}) para ${[...g.guardias].join(', ')}.`,
    propuesto: true,
  }));
  return [...out, ...sinProponer];
}

/** «Plantilla del objetivo (24 días)» / «Su propio ciclo» / «Copia de X» / «Hereda la fila de X». */
function textoOrigen(r: ResultadoGuardia): string {
  const p = r.plantilla;
  if (p?.via === 'compañero' && p.copiaDe) return `copia de ${apellido(p.copiaDe)}`;
  if (p?.via === 'herencia' && p.copiaDe) return `hereda la fila de ${apellido(p.copiaDe)}`;
  if (p?.via === 'plantilla') return `plantilla del objetivo${p.periodo ? ` (${p.periodo} días)` : ''}${p.grupo ? ` · grupo ${p.grupo}` : ''}`;
  return 'su propio ciclo';
}

export function ContinuarMesModal({ vista, onAplicar, onCancelar }: Props) {
  const conCiclo = useMemo(() => vista.resultados.filter((r) => r.ciclo && r.propuestas.length > 0), [vista.resultados]);
  const sinCiclo = useMemo(() => vista.resultados.filter((r) => !r.ciclo), [vista.resultados]);
  const sinNada = useMemo(() => vista.resultados.filter((r) => r.ciclo && r.propuestas.length === 0), [vista.resultados]);
  // Los estimados también arrancan tildados (siguen en amarillo para revisar): destildados dejaban la fila vacía.
  const [elegidos, setElegidos] = useState<Set<string>>(() => new Set(conCiclo.map((r) => r.employeeId)));
  const [nivelar, setNivelar] = useState<Set<string>>(() => new Set());
  const [activarMes, setActivarMes] = useState(() => !!(vista.activar?.marcado && vista.activar.puede && vista.activar.permiso));

  const sugerencias = useMemo(
    () => conCiclo.flatMap((r) => r.sugerencias || []).sort((a, b) => a.dateStr.localeCompare(b.dateStr)),
    [conCiclo],
  );
  const sugerenciasVisibles = useMemo(() => sugerencias.filter((s) => elegidos.has(s.celda.employeeId)), [sugerencias, elegidos]);
  const sugerenciasNivel = useMemo(() => sugerenciasVisibles.filter((s) => s.tipo !== 'relevante' && s.tipo !== 'suelto' && s.tipo !== 'rotacion'), [sugerenciasVisibles]);
  /** Rotación ordenada por puesto: un grupo = un puesto, se tilda todo junto. */
  const gruposRotacion = useMemo(() => {
    const m = new Map<string, { texto: string; claves: string[] }>();
    for (const s of sugerencias.filter((x) => x.tipo === 'rotacion')) {
      const g = m.get(s.grupo || '') || { texto: s.grupoTexto || s.grupo || '', claves: [] };
      g.claves.push(claveSugerencia(s));
      m.set(s.grupo || '', g);
    }
    return [...m.entries()].map(([grupo, g]) => ({ grupo, ...g }));
  }, [sugerencias]);
  const sugerenciasSuelto = useMemo(() => sugerenciasVisibles.filter((s) => s.tipo === 'suelto'), [sugerenciasVisibles]);
  const sugerenciasRelevante = useMemo(() => sugerenciasVisibles.filter((s) => s.tipo === 'relevante'), [sugerenciasVisibles]);

  const totales = useMemo(() => {
    let turnos = 0; let francos = 0;
    for (const r of conCiclo) {
      if (!elegidos.has(r.employeeId)) continue;
      for (const c of r.propuestas) { if (c.isFranco) francos += 1; else turnos += 1; }
    }
    return { turnos, francos };
  }, [conCiclo, elegidos]);

  const revisar = useMemo(() => agruparRevisar(vista.resultados), [vista.resultados]);
  const revisarGrupos = useMemo(() => gruposRevisar(vista.resultados), [vista.resultados]);
  const ultimoLeido = useMemo(() => {
    const dias = vista.resultados.map((r) => r.ciclo?.ultimoDia).filter((d): d is string => !!d).sort();
    return dias.length ? dias[dias.length - 1] : null;
  }, [vista.resultados]);
  const avisos = vista.avisos || { lineas: [], accion: '', resto: 0 };
  const hayFalta = avisos.lineas.some((l) => l.includes('falta') || l.includes('nadie'));

  const toggle = (id: string) => setElegidos((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleNivelar = (k: string) => setNivelar((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });
  const aceptadas = sugerenciasVisibles.filter((s) => nivelar.has(claveSugerencia(s)));

  return (
    <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4" onClick={onCancelar} data-continuar-mes-modal>
      <div className="bg-white rounded-2xl shadow-sm w-full max-w-[1040px] max-h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2 text-slate-900 font-black text-base">
              <Repeat size={18} className="text-teal-600" />
              Continuar desde {vista.mesAnteriorLabel}
            </div>
            <div className="text-[12px] text-slate-500 mt-0.5">
              Se lee el plan de cada guardia (sin coberturas, extensiones ni eventos) y se sigue en {vista.mesLabel} desde donde quedó
              {ultimoLeido ? <> (último día cargado: {ultimoLeido.slice(8)}/{ultimoLeido.slice(5, 7)})</> : null}.
              Los que rotan igual siguen la plantilla del objetivo. Las licencias cargadas y las celdas que ya tienen algo no se tocan. Queda en borrador hasta «Guardar cronograma».
            </div>
          </div>
          <button type="button" onClick={onCancelar} aria-label="Cerrar" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {vista.activar && (
            <div className="rounded-2xl border border-teal-200 bg-teal-50 px-3 py-2.5 text-[12px] text-teal-950 shadow-sm" data-continuar-activar>
              {vista.activar.puede && vista.activar.permiso ? (
                <label className="flex flex-wrap items-center gap-2 cursor-pointer">
                  <b>El servicio de {vista.activar.mes} no está activo.</b>
                  <input type="checkbox" checked={activarMes} onChange={(e) => setActivarMes(e.target.checked)} data-continuar-activar-check />
                  <span>Activar el servicio de {vista.activar.mes} (agregar el mes al contrato)</span>
                </label>
              ) : (
                <p>
                  <b>El servicio de {vista.activar.mes} no está activo.</b>{' '}
                  {vista.activar.puede && !vista.activar.permiso
                    ? 'Pedile a quien administra Servicios que lo active. La copia igual se arma en borrador.'
                    : vista.activar.motivo}
                </p>
              )}
            </div>
          )}
          <div className="space-y-1.5" data-continuar-alertas>
            {avisos.lineas.length > 0 ? (
              <Seccion
                icon={<ShieldAlert size={12} />}
                titulo="Cobertura"
                tono={hayFalta ? 'rojo' : 'ambar'}
                resumen={`${avisos.lineas.length + avisos.resto} día(s)-puesto con algo para mirar${gruposRotacion.length ? ' · varios se arreglan con «Ordenar la rotación» (abajo)' : ''}`}
              >
                <div data-continuar-avisos>
                  {avisos.lineas.map((linea, i) => <div key={i}>{linea}</div>)}
                  {avisos.resto > 0 && <div>y {avisos.resto} más</div>}
                  {avisos.accion && <div className="text-[10px] opacity-80 mt-1">{avisos.accion}</div>}
                </div>
              </Seccion>
            ) : (
              <Seccion icon={<ShieldAlert size={12} />} titulo="Cobertura" tono="gris" resumen="todos los días quedan cubiertos"><div>Todos los días quedan con el servicio cubierto.</div></Seccion>
            )}
            {vista.descanso.length > 0 && (
              <Seccion icon={<Moon size={12} />} titulo="Descanso < 12 h en el cambio de mes" tono="rojo" resumen={`${vista.descanso.length} guardia(s)`} abierta>
                {vista.descanso.map((d, i) => <div key={i}><b>{d.nombre}</b>: {d.texto}</div>)}
              </Seccion>
            )}
            {vista.tope.length > 0 && (
              <Seccion icon={<Clock size={12} />} titulo="Más de 200 h en el mes" tono="ambar" resumen={`${vista.tope.length} guardia(s)`}>
                {vista.tope.map((t) => <div key={t.employeeId}><b>{t.nombre}</b>: {t.horas} h</div>)}
              </Seccion>
            )}
            {revisar.length > 0 && (
              <Seccion
                icon={<AlertTriangle size={12} />}
                titulo="Para revisar"
                tono="ambar"
                resumen={revisarGrupos.map((g) => g.titulo.replace(/ \((\d+)\)$/, ': $1')).join(' · ')}
              >
                {revisarGrupos.map((g) => (
                  <div key={g.titulo} className="mb-1">
                    <div className="font-black">{g.titulo}</div>
                    {g.items.map((t, i) => <div key={i} className="pl-2">{t}</div>)}
                  </div>
                ))}
              </Seccion>
            )}
            {sinCiclo.length > 0 && (
              <Seccion icon={<CalendarClock size={12} />} titulo={`Sin ciclo para leer (${sinCiclo.length})`} tono="gris" resumen="quedan para hacer a mano">
                <div>Quedan sin proponer, para hacer a mano:</div>
                {sinCiclo.map((r) => <div key={r.employeeId}><b>{r.nombre}</b>: {r.motivoSinCiclo}</div>)}
              </Seccion>
            )}
          </div>

          <table className="w-full text-[11px] border-collapse" data-continuar-tabla>
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="py-1.5 pr-2 w-6" />
                <th className="py-1.5 pr-2">Guardia</th>
                <th className="py-1.5 pr-2">Ciclo</th>
                <th className="py-1.5 pr-2">El 1.º sigue en</th>
                <th className="py-1.5 pr-2 text-right">Propone</th>
                <th className="py-1.5">No se toca</th>
              </tr>
            </thead>
            <tbody>
              {conCiclo.map((r) => {
                const turnos = r.propuestas.filter((c) => !c.isFranco).length;
                const francos = r.propuestas.length - turnos;
                const o = r.omitidas;
                const noToca = [
                  o.licencia ? `${o.licencia} licencia` : '',
                  o.ocupada ? `${o.ocupada} con turno` : '',
                  o.bloqueada ? `${o.bloqueada} cerrados` : '',
                  o.excluida ? `${o.excluida} fuera del SLA` : '',
                  o.sinDato ? `${o.sinDato} sin dato` : '',
                ].filter(Boolean).join(' · ');
                const origen = textoOrigen(r);
                return (
                  <tr key={r.employeeId} className={`border-b border-slate-100 align-top ${r.estimado ? 'bg-amber-50/70' : ''}`} data-continuar-guardia={r.employeeId} data-continuar-estimado={r.estimado ? r.origenCiclo : undefined} data-continuar-via={r.plantilla?.via || 'propio'}>
                    <td className="py-1.5 pr-2">
                      <input type="checkbox" checked={elegidos.has(r.employeeId)} onChange={() => toggle(r.employeeId)} aria-label={`Incluir a ${r.nombre}`} />
                    </td>
                    <td className="py-1.5 pr-2 font-bold text-slate-800">{r.nombre}</td>
                    <td className="py-1.5 pr-2 font-mono text-slate-700">
                      {r.ciclo!.etiqueta}
                      <div className={`text-[10px] font-sans font-bold ${r.plantilla?.via === 'compañero' || r.plantilla?.via === 'herencia' ? 'text-indigo-700' : 'text-slate-400'}`} data-continuar-origen>{origen}</div>
                      {r.estimado && r.notaEstimado && !r.plantilla?.copiaDe ? (
                        <div className="text-[10px] font-sans font-bold text-amber-800" data-continuar-nota={r.notaEstimado}>{r.notaEstimado}</div>
                      ) : null}
                    </td>
                    <td className="py-1.5 pr-2 font-bold text-teal-700">{r.continuaEn}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{turnos} turnos · {francos} F</td>
                    <td className="py-1.5 text-slate-500">{noToca || '—'}</td>
                  </tr>
                );
              })}
              {sinNada.map((r) => (
                <tr key={r.employeeId} className="border-b border-slate-100 text-slate-400">
                  <td />
                  <td className="py-1.5 pr-2 font-bold">{r.nombre}</td>
                  <td className="py-1.5 pr-2 font-mono">{r.ciclo!.etiqueta}</td>
                  <td colSpan={3} className="py-1.5">Nada para proponer (el mes ya tiene sus días cargados)</td>
                </tr>
              ))}
            </tbody>
          </table>

          {gruposRotacion.length > 0 && (
            <div className="rounded-2xl border border-violet-200 bg-violet-50/70 px-3 py-2.5 shadow-sm" data-continuar-rotacion>
              <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-violet-950">
                <Repeat size={12} /> Ordenar la rotación del puesto
              </div>
              <div className="text-[11px] text-violet-950/80 mt-0.5 mb-1.5">
                Los guardias de este puesto quedaron pisándose (dos en la misma banda y otra vacía). Tildá para acomodar sus fases y que cada día tenga M, T y N. Arranca destildado.
              </div>
              {gruposRotacion.map((g) => {
                const todas = g.claves.every((k) => nivelar.has(k));
                return (
                  <label key={g.grupo} className="flex items-start gap-2 text-[12px] text-slate-800 cursor-pointer hover:bg-white/70 rounded-lg px-1 py-1" data-continuar-rotacion-grupo={g.grupo}>
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={todas}
                      onChange={() => setNivelar((prev) => {
                        const next = new Set(prev);
                        for (const k of g.claves) { if (todas) next.delete(k); else next.add(k); }
                        return next;
                      })}
                    />
                    <span className="font-semibold">{g.texto} <span className="font-normal text-slate-500">({g.claves.length} celdas)</span></span>
                  </label>
                );
              })}
            </div>
          )}
          {sugerenciasNivel.length > 0 && (
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 px-3 py-2.5 shadow-sm" data-continuar-nivelacion>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-indigo-900">
                  <Scale size={12} /> Nivelar con el servicio · {sugerenciasNivel.length} sugerencia(s)
                </div>
                <div className="flex gap-2 text-[11px] font-bold">
                  <button type="button" className="text-indigo-700 hover:underline" onClick={() => setNivelar((prev) => new Set([...prev, ...sugerenciasNivel.map(claveSugerencia)]))}>Tildar todas</button>
                  <button type="button" className="text-slate-500 hover:underline" onClick={() => setNivelar((prev) => {
                    const next = new Set(prev);
                    for (const s of sugerenciasNivel) next.delete(claveSugerencia(s));
                    return next;
                  })}>Ninguna</button>
                </div>
              </div>
              <div className="text-[11px] text-indigo-900/80 mt-0.5 mb-1.5">
                Opcional. Lo principal es seguir la racha: estos cambios de banda dejan cada día con el cupo del servicio. Se aplican solo los que tildes.
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-0.5">
                {sugerenciasNivel.map((s) => {
                  const k = claveSugerencia(s);
                  return (
                    <label key={k} className="flex items-center gap-2 text-[11px] text-slate-800 cursor-pointer hover:bg-white/70 rounded-lg px-1 py-0.5" data-continuar-sugerencia={k}>
                      <input type="checkbox" checked={nivelar.has(k)} onChange={() => toggleNivelar(k)} />
                      <span className="font-medium">{s.texto}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          {sugerenciasRelevante.length > 0 && (
            <div className="rounded-2xl border border-teal-200 bg-teal-50/70 px-3 py-2.5 shadow-sm" data-continuar-relevante>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-teal-950">
                  <Repeat size={12} /> Reacomodar al relevante · {sugerenciasRelevante.length} sugerencia(s)
                </div>
                <div className="flex gap-2 text-[11px] font-bold">
                  <button type="button" className="text-teal-800 hover:underline" onClick={() => setNivelar((prev) => new Set([...prev, ...sugerenciasRelevante.map(claveSugerencia)]))}>Tildar todas</button>
                  <button type="button" className="text-slate-500 hover:underline" onClick={() => setNivelar((prev) => {
                    const next = new Set(prev);
                    for (const s of sugerenciasRelevante) next.delete(claveSugerencia(s));
                    return next;
                  })}>Ninguna</button>
                </div>
              </div>
              <div className="text-[11px] text-teal-950/80 mt-0.5 mb-1.5">
                Opcional. El guardia que cubre dos puestos (como el mes anterior) pasa al puesto donde falta su banda, o sigue la banda que queda libre. Arranca destildado.
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-0.5">
                {sugerenciasRelevante.map((s) => {
                  const k = claveSugerencia(s);
                  return (
                    <label key={k} className="flex items-center gap-2 text-[11px] text-slate-800 cursor-pointer hover:bg-white/70 rounded-lg px-1 py-0.5" data-continuar-sugerencia={k}>
                      <input type="checkbox" checked={nivelar.has(k)} onChange={() => toggleNivelar(k)} />
                      <span className="font-medium">{s.texto}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          {sugerenciasSuelto.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-3 py-2.5 shadow-sm" data-continuar-sueltos>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-amber-950">
                  <Repeat size={12} /> Lo que el mes anterior se cubrió suelto · {sugerenciasSuelto.length}
                </div>
                <div className="flex gap-2 text-[11px] font-bold">
                  <button type="button" className="text-amber-800 hover:underline" onClick={() => setNivelar((prev) => new Set([...prev, ...sugerenciasSuelto.map(claveSugerencia)]))}>Tildar todas</button>
                  <button type="button" className="text-slate-500 hover:underline" onClick={() => setNivelar((prev) => {
                    const next = new Set(prev);
                    for (const s of sugerenciasSuelto) next.delete(claveSugerencia(s));
                    return next;
                  })}>Ninguna</button>
                </div>
              </div>
              <div className="text-[11px] text-amber-950/80 mt-0.5 mb-1.5">
                Turnos que no son el ciclo de nadie y el mes anterior cubrió alguien. Tildá para repetir con la misma persona; si no, el hueco queda en Faltantes para asignar a otro. Arranca destildado.
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-0.5">
                {sugerenciasSuelto.map((s) => {
                  const k = claveSugerencia(s);
                  return (
                    <label key={k} className="flex items-center gap-2 text-[11px] text-slate-800 cursor-pointer hover:bg-white/70 rounded-lg px-1 py-0.5" data-continuar-sugerencia={k}>
                      <input type="checkbox" checked={nivelar.has(k)} onChange={() => toggleNivelar(k)} />
                      <span className="font-medium">{s.texto}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <div className="text-[12px] text-slate-600">
            {elegidos.size} guardia(s) · {totales.turnos} turnos y {totales.francos} francos en borrador
            {aceptadas.length > 0 ? <> · {aceptadas.length} cambio(s) de nivelación</> : null}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onCancelar} className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-[12px] font-bold hover:bg-slate-100">Cancelar</button>
            <button
              type="button"
              data-continuar-aplicar
              disabled={(elegidos.size === 0 || totales.turnos + totales.francos === 0) && !activarMes}
              onClick={() => onAplicar([...elegidos], aceptadas, activarMes && !!vista.activar?.puede && !!vista.activar?.permiso)}
              className="px-4 py-2 rounded-lg bg-teal-600 text-white text-[12px] font-black hover:bg-teal-700 disabled:bg-white disabled:text-slate-400 disabled:border disabled:border-slate-300"
            >
              Aplicar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ContinuarMesModal;
