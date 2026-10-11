import React, { useMemo, useState } from 'react';
import { FileSpreadsheet, X } from 'lucide-react';
import { celdasDesdeArrayBuffer } from '@/lib/planificacion/importarExcelXlsx';
import { detectarCuadros, sugerirCuadros, type CuadroPlanilla } from '@/lib/planificacion/importarExcel';
import { aplicarServicioPlanilla, type SlaRango } from '@/lib/servicios/aplicarServicioPlanilla';
import { ServicioPlanillaEditor } from './ServicioPlanillaEditor';
import type { FranjaVigente } from '@/lib/planificacion/servicioDesdePlanilla';

export type ObjetivoServicioPlanilla = {
  id: string;
  nombre: string;
  clienteId: string;
  clienteNombre: string;
};

export type ServicioMesPlanilla = SlaRango & {
  id: string;
  objectiveId: string;
  desde: string;
  hasta: string;
  turnos: FranjaVigente[];
};

type Props = {
  empresaId: string;
  migracionCompleta: boolean;
  year: number;
  month: number;
  mesLabel: string;
  puedeCrear: boolean;
  puedeActualizar: boolean;
  objetivos: ObjetivoServicioPlanilla[];
  servicios: ServicioMesPlanilla[];
  preseleccion: { clienteId: string; objectiveId: string; servicioId: string } | null;
  onCerrar: () => void;
  onGuardado: () => void;
};

export function ServicioPlanillaModal(props: Props) {
  const [cuadros, setCuadros] = useState<CuadroPlanilla[]>([]);
  const [indice, setIndice] = useState(0);
  const [objectiveId, setObjectiveId] = useState(props.preseleccion?.objectiveId || '');
  const [servicioId, setServicioId] = useState(props.preseleccion?.servicioId || '');
  const [error, setError] = useState('');
  const obj = props.objetivos.find((o) => o.id === objectiveId) || null;
  const delMes = useMemo(
    () => props.servicios.filter((s) => s.objectiveId === objectiveId),
    [props.servicios, objectiveId],
  );
  const vigente = delMes.find((s) => s.id === servicioId)?.turnos || [];
  const cuadro = cuadros[indice] || null;

  const subir = async (file: File) => {
    setError('');
    const buf = await file.arrayBuffer();
    const lista = detectarCuadros(celdasDesdeArrayBuffer(buf), props.year, props.month);
    if (!lista.length) {
      setError('No encontré un cronograma en la planilla.');
      setCuadros([]);
      return;
    }
    const sugeridos = new Set(sugerirCuadros(lista));
    const primero = lista.findIndex((_, i) => sugeridos.has(i));
    setCuadros(lista);
    setIndice(primero >= 0 ? primero : 0);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-slate-900/40 p-4" data-servicio-planilla-modal>
      <div className="my-4 flex max-h-[calc(100vh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-lg">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
          <FileSpreadsheet size={16} className="text-indigo-600" />
          <div>
            <p className="text-sm font-black text-slate-800">
              {obj ? `Servicio de ${props.mesLabel} · ${obj.clienteNombre} · ${obj.nombre}` : `Servicio de ${props.mesLabel}`}
            </p>
            <p className="text-[11px] text-slate-500">El mes vigente se puede armar desde los turnos, desde una planilla o copiando el mes anterior.</p>
          </div>
          <button type="button" onClick={props.onCerrar} className="ml-auto rounded-lg p-1 text-slate-400 hover:bg-slate-50" aria-label="Cerrar"><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <label className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 font-black text-indigo-800">
              Subir planilla
              <input type="file" accept=".xlsx" className="hidden" data-servicio-archivo onChange={(e) => { const f = e.target.files?.[0]; if (f) void subir(f); }} />
            </label>
            <select value={objectiveId} onChange={(e) => { setObjectiveId(e.target.value); setServicioId(''); }} className="rounded-xl border border-slate-200 px-2 py-2">
              <option value="">Objetivo</option>
              {props.objetivos.map((o) => <option key={o.id} value={o.id}>{o.clienteNombre} · {o.nombre}</option>)}
            </select>
            <select value={servicioId} onChange={(e) => setServicioId(e.target.value)} className="rounded-xl border border-slate-200 px-2 py-2">
              <option value="">Sin servicio</option>
              {delMes.map((s) => <option key={s.id} value={s.id}>{s.desde} → {s.hasta}</option>)}
            </select>
            {cuadros.length > 1 && (
              <select value={indice} onChange={(e) => setIndice(Number(e.target.value))} className="rounded-xl border border-slate-200 px-2 py-2">
                {cuadros.map((c, i) => <option key={c.indice} value={i}>{c.titulo || `Cuadro ${i + 1}`}</option>)}
              </select>
            )}
          </div>
          {error && <p className="text-[12px] font-bold text-rose-700">{error}</p>}
          {obj && delMes.length === 0 && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-bold text-amber-900" data-servicio-sin-mes>
              {props.mesLabel} no tiene servicio. Crearlo desde los turnos de este mes, desde una planilla o copiando el mes anterior.
            </p>
          )}
          {obj && !cuadro && (
            <div className="space-y-2" data-servicio-vigente>
              <p className="text-[12px] font-bold text-slate-600">
                {vigente.length ? 'Servicio vigente del mes' : 'Todavía no hay franjas cargadas.'}
              </p>
              {vigente.length > 0 && (
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                      <th className="py-1 pr-2">Puesto</th><th className="py-1 pr-2">Franja</th><th className="py-1 pr-2">Horario</th><th className="py-1 pr-2">Cant.</th><th className="py-1">Días</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vigente.map((f, i) => (
                      <tr key={`${f.puesto}-${f.code}-${i}`} className="border-t border-slate-100">
                        <td className="py-1 pr-2 font-bold">{f.puesto}</td>
                        <td className="py-1 pr-2">{f.code}</td>
                        <td className="py-1 pr-2">{f.startTime}–{f.endTime}</td>
                        <td className="py-1 pr-2">{f.cantidad}</td>
                        <td className="py-1">{f.dias?.length ? f.dias.join(' ') : 'todos'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="flex flex-wrap gap-2 text-[11px]">
                <span className="rounded-xl border border-slate-200 px-3 py-2 text-slate-600">Desde los turnos de este mes: lee las bandas del cronograma (customs aparte, puestos de 24 h).</span>
                <span className="rounded-xl border border-slate-200 px-3 py-2 text-slate-600">Desde una planilla: subí el Excel y se compara con el vigente.</span>
                <span className="rounded-xl border border-slate-200 px-3 py-2 text-slate-600">Copiar del mes anterior: trae puestos y franjas del servicio del mes previo.</span>
              </div>
            </div>
          )}
          {cuadro && obj && (
            <ServicioPlanillaEditor
              cuadro={cuadro}
              year={props.year}
              month={props.month}
              mesLabel={props.mesLabel}
              vigente={vigente}
              servicioId={servicioId}
              puedeCrear={props.puedeCrear}
              puedeActualizar={props.puedeActualizar}
              hayOtroServicio={delMes.length > 0 && !servicioId}
              onGuardar={async (accion, franjas, equivalencias) => {
                await aplicarServicioPlanilla({
                  accion,
                  servicioId,
                  clientId: obj.clienteId,
                  clientName: obj.clienteNombre,
                  objectiveId: obj.id,
                  objectiveName: obj.nombre,
                  empresaId: props.empresaId,
                  migracionCompleta: props.migracionCompleta,
                  year: props.year,
                  month: props.month,
                  franjas,
                  equivalencias,
                  otros: props.servicios,
                });
                props.onGuardado();
              }}
            />
          )}
          {cuadro && !obj && <p className="text-[12px] text-slate-500">Elegí el objetivo al que corresponde la planilla.</p>}
        </div>
      </div>
    </div>
  );
}
