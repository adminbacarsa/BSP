import React, { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, Clock, Moon, Repeat, ShieldAlert, X } from 'lucide-react';
import {
  textoDias,
  type AlertaCupo,
  type AlertaDescanso,
  type AlertaHoras,
  type AvisosCobertura,
  type ResultadoGuardia,
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
};

type Props = {
  vista: ContinuarMesVista;
  onAplicar: (employeeIds: string[]) => void;
  onCancelar: () => void;
};

function Seccion({ icon, titulo, tono, children }: { icon: React.ReactNode; titulo: string; tono: 'rojo' | 'ambar' | 'gris'; children: React.ReactNode }) {
  const cls = tono === 'rojo'
    ? 'border-rose-200 bg-rose-50 text-rose-800'
    : tono === 'ambar'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-slate-200 bg-slate-50 text-slate-700';
  return (
    <div className={`rounded-lg border px-3 py-2 text-[11px] ${cls}`}>
      <div className="flex items-center gap-1.5 font-black uppercase tracking-wide text-[10px] mb-1">{icon}{titulo}</div>
      <div className="space-y-0.5 font-medium leading-snug">{children}</div>
    </div>
  );
}

function apellido(nombre: string): string {
  return String(nombre || '').split(',')[0].trim();
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

export function ContinuarMesModal({ vista, onAplicar, onCancelar }: Props) {
  const conCiclo = useMemo(() => vista.resultados.filter((r) => r.ciclo && r.propuestas.length > 0), [vista.resultados]);
  const sinCiclo = useMemo(() => vista.resultados.filter((r) => !r.ciclo), [vista.resultados]);
  const sinNada = useMemo(() => vista.resultados.filter((r) => r.ciclo && r.propuestas.length === 0), [vista.resultados]);
  const [elegidos, setElegidos] = useState<Set<string>>(() => new Set(conCiclo.filter((r) => !r.estimado).map((r) => r.employeeId)));

  const totales = useMemo(() => {
    let turnos = 0; let francos = 0;
    for (const r of conCiclo) {
      if (!elegidos.has(r.employeeId)) continue;
      for (const c of r.propuestas) { if (c.isFranco) francos += 1; else turnos += 1; }
    }
    return { turnos, francos };
  }, [conCiclo, elegidos]);

  const revisar = useMemo(() => agruparRevisar(vista.resultados), [vista.resultados]);
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

  return (
    <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4" onClick={onCancelar} data-continuar-mes-modal>
      <div className="bg-white rounded-2xl shadow-sm w-full max-w-[980px] max-h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2 text-slate-900 font-black text-base">
              <Repeat size={18} className="text-teal-600" />
              Continuar desde {vista.mesAnteriorLabel}
            </div>
            <div className="text-[12px] text-slate-500 mt-0.5">
              Se lee el ciclo de cada guardia en las últimas semanas y se sigue en {vista.mesLabel} desde donde quedó
              {ultimoLeido ? <> (último día cargado: {ultimoLeido.slice(8)}/{ultimoLeido.slice(5, 7)})</> : null}.
              Las licencias cargadas y las celdas que ya tienen algo no se tocan. Queda en borrador hasta «Guardar cronograma».
            </div>
          </div>
          <button type="button" onClick={onCancelar} aria-label="Cerrar" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-start" data-continuar-alertas>
            {avisos.lineas.length > 0 ? (
              <Seccion icon={<ShieldAlert size={12} />} titulo="Cobertura del puesto" tono={hayFalta ? 'rojo' : 'ambar'}>
                <div data-continuar-avisos>
                  {avisos.lineas.map((linea, i) => <div key={i}>{linea}</div>)}
                  {avisos.resto > 0 && <div>y {avisos.resto} más</div>}
                  {avisos.accion && <div className="text-[10px] opacity-80 mt-1">{avisos.accion}</div>}
                </div>
              </Seccion>
            ) : (
              <Seccion icon={<ShieldAlert size={12} />} titulo="Cobertura" tono="gris"><div>Todos los días quedan con el servicio cubierto.</div></Seccion>
            )}
            {vista.descanso.length > 0 && (
              <Seccion icon={<Moon size={12} />} titulo="Descanso < 12 h en el cambio de mes" tono="rojo">
                {vista.descanso.map((d, i) => <div key={i}><b>{d.nombre}</b>: {d.texto}</div>)}
              </Seccion>
            )}
            {vista.tope.length > 0 && (
              <Seccion icon={<Clock size={12} />} titulo="Más de 200 h en el mes" tono="ambar">
                {vista.tope.map((t) => <div key={t.employeeId}><b>{t.nombre}</b>: {t.horas} h</div>)}
              </Seccion>
            )}
            {revisar.length > 0 && (
              <Seccion icon={<AlertTriangle size={12} />} titulo="Puestos para revisar" tono="ambar">
                {revisar.slice(0, 6).map((r, i) => <div key={i}>{r.texto}</div>)}
                {revisar.length > 6 && <div>y {revisar.length - 6} más</div>}
              </Seccion>
            )}
            {sinCiclo.length > 0 && (
              <Seccion icon={<CalendarClock size={12} />} titulo={`Sin ciclo para leer (${sinCiclo.length})`} tono="gris">
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
                <th className="py-1.5 pr-2">Ciclo detectado</th>
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
                return (
                  <tr key={r.employeeId} className={`border-b border-slate-100 align-top ${r.estimado ? 'bg-amber-50/70' : ''}`} data-continuar-guardia={r.employeeId} data-continuar-estimado={r.estimado ? r.origenCiclo : undefined}>
                    <td className="py-1.5 pr-2">
                      <input type="checkbox" checked={elegidos.has(r.employeeId)} onChange={() => toggle(r.employeeId)} aria-label={`Incluir a ${r.nombre}`} />
                    </td>
                    <td className="py-1.5 pr-2 font-bold text-slate-800">{r.nombre}</td>
                    <td className="py-1.5 pr-2 font-mono text-slate-700">
                      {r.ciclo!.etiqueta}
                      {r.estimado ? (
                        <div className="text-[10px] font-sans font-bold text-amber-800" data-continuar-nota={r.notaEstimado}>{r.notaEstimado}</div>
                      ) : (
                        <span className="ml-1 text-[10px] text-slate-400 font-sans">({r.ciclo!.periodo} días)</span>
                      )}
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
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <div className="text-[12px] text-slate-600">
            {elegidos.size} guardia(s) · {totales.turnos} turnos y {totales.francos} francos en borrador
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onCancelar} className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-[12px] font-bold hover:bg-slate-100">Cancelar</button>
            <button
              type="button"
              data-continuar-aplicar
              disabled={elegidos.size === 0 || totales.turnos + totales.francos === 0}
              onClick={() => onAplicar([...elegidos])}
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
