import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { filasDesdeHoja, type FilaPadron } from '@/lib/planificacion/padronAlta';
import { compararPadron, fechaPadronVisible, textoDiff, type EmpleadoParaPadron } from '@/lib/rrhh/padronComparar';
import { aplicarAltasYCambios, confirmarBajaPadron, guardarPadron, type EstadoPadron } from '@/lib/rrhh/padronClient';

type Props = {
  empresaId: string;
  empresaNombre: string;
  empleados: EmpleadoParaPadron[];
  estado: EstadoPadron | null;
  onCerrar: () => void;
  onAplicado: () => void;
};

function leer(buf: ArrayBuffer): FilaPadron[] {
  const wb = XLSX.read(buf, { type: 'array', cellDates: false });
  const name = wb.SheetNames.find((n) => n.toUpperCase() === 'SP') || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' }) as unknown[][];
  return filasDesdeHoja(rows);
}

export function PadronPanel({ empresaId, empresaNombre, empleados, estado, onCerrar, onAplicado }: Props) {
  const [filas, setFilas] = useState<FilaPadron[] | null>(null);
  const [archivo, setArchivo] = useState('');
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [guardando, setGuardando] = useState(false);
  const cmp = useMemo(() => (filas ? compararPadron(filas, empleados) : null), [filas, empleados]);

  const togglear = (clave: string) => setMarcados((prev) => {
    const n = new Set(prev);
    if (n.has(clave)) n.delete(clave); else n.add(clave);
    return n;
  });

  const onArchivo = async (file: File) => {
    const leidas = leer(await file.arrayBuffer());
    if (!leidas.length) { toast.error('El archivo no tiene filas en la hoja SP.'); return; }
    setFilas(leidas);
    setArchivo(file.name);
    const c = compararPadron(leidas, empleados);
    setMarcados(new Set([...c.nuevos, ...c.cambios].map((x) => x.clave)));
  };

  const aplicar = async () => {
    if (!cmp || guardando) return;
    setGuardando(true);
    try {
      await guardarPadron(empresaId, filas || [], archivo);
      const res = await aplicarAltasYCambios({
        empresaId,
        objectiveId: '',
        clientId: '',
        nuevos: cmp.nuevos.filter((n) => marcados.has(n.clave)),
        cambios: cmp.cambios.filter((n) => marcados.has(n.clave)),
      });
      if (res.errores.length) toast.error(res.errores[0]);
      toast.success(`Padrón guardado. ${res.altas} alta(s), ${res.cambios} cambio(s). Las bajas quedan para revisar.`);
      onAplicado();
    } catch (e) {
      console.error(e);
      toast.error('No se pudo guardar el padrón.');
    } finally {
      setGuardando(false);
    }
  };

  const revisarBaja = async (emp: EmpleadoParaPadron) => {
    const ok = window.confirm(`¿Dar de baja a ${emp.apellido}, ${emp.nombre} (legajo ${emp.legajo})? No se borra el legajo.`);
    if (!ok) return;
    await confirmarBajaPadron(emp, empresaId, 'Padrón');
    toast.success(`${emp.apellido} quedó inactivo`);
    onAplicado();
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4" onClick={onCerrar} data-padron-panel>
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-3xl overflow-auto rounded-3xl border border-slate-200 bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-sm font-black uppercase text-slate-800">Padrón · {empresaNombre}</h3>
          <button type="button" onClick={onCerrar} className="ml-auto rounded-lg p-1 text-slate-400 hover:bg-slate-50" aria-label="Cerrar"><X size={14} /></button>
        </div>
        <p className="mb-2 text-[12px] text-slate-500">
          {estado ? `Padrón del ${fechaPadronVisible(estado.fecha)} · ${estado.cantidad} personas · ${estado.actualizadoPor}` : 'Todavía no hay un padrón cargado.'}
          {' '}Subí el Excel (hoja SP). Reemplaza la consulta anterior; quien ya no viene queda marcado, no se borra.
        </p>
        <input type="file" accept=".xlsx,.xls" data-padron-archivo className="mb-3 block text-[12px]" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onArchivo(f); }} />
        {cmp && (
          <div className="space-y-3 text-[12px]">
            <Bloque titulo={`Nuevos (${cmp.nuevos.length})`} tono="emerald">
              {cmp.nuevos.map((n) => (
                <Fila key={n.clave} clave={n.clave} marcado={marcados.has(n.clave)} onToggle={togglear} texto={`${n.fila.apellido}, ${n.fila.nombre} · legajo ${n.fila.legajo}`} />
              ))}
            </Bloque>
            <Bloque titulo={`Cambios (${cmp.cambios.length})`} tono="amber">
              {cmp.cambios.map((n) => (
                <Fila key={n.clave} clave={n.clave} marcado={marcados.has(n.clave)} onToggle={togglear} texto={`${n.empleado.apellido}, ${n.empleado.nombre} · ${n.diffs.map(textoDiff).join(' · ')}`} />
              ))}
            </Bloque>
            <Bloque titulo={`Bajas para revisar (${cmp.bajas.length})`} tono="rose">
              {cmp.bajas.map((n) => (
                <div key={n.clave} className="flex items-center gap-2 py-1" data-padron-baja={n.empleado.legajo}>
                  <span className="flex-1">{n.empleado.apellido}, {n.empleado.nombre} · legajo {n.empleado.legajo} · {n.motivo === 'baja_padron' ? 'el padrón lo da de baja' : 'no viene en el padrón'}</span>
                  <button type="button" className="rounded-lg border border-rose-200 px-2 py-1 text-[11px] font-bold text-rose-700" data-padron-revisar-baja={n.empleado.id} onClick={() => void revisarBaja(n.empleado)}>Revisar baja</button>
                </div>
              ))}
            </Bloque>
            <p className="text-slate-500" data-padron-iguales>Iguales: {cmp.iguales.length}</p>
            <div className="flex justify-end">
              <button type="button" disabled={guardando || marcados.size === 0} onClick={() => void aplicar()} data-padron-aplicar className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-black text-white shadow-sm hover:bg-indigo-700 disabled:border disabled:border-slate-200 disabled:bg-white disabled:text-slate-400">
                {guardando ? 'Guardando…' : 'Aplicar seleccionados'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Bloque({ titulo, tono, children }: { titulo: string; tono: 'emerald' | 'amber' | 'rose'; children: React.ReactNode }) {
  const cls = tono === 'emerald' ? 'border-emerald-200 bg-emerald-50' : tono === 'amber' ? 'border-amber-200 bg-amber-50' : 'border-rose-200 bg-rose-50';
  return (
    <div className={`rounded-2xl border px-3 py-2 ${cls}`} data-padron-bloque={tono}>
      <p className="mb-1 font-black uppercase tracking-wide text-slate-700">{titulo}</p>
      {children}
    </div>
  );
}

function Fila({ clave, marcado, onToggle, texto }: { clave: string; marcado: boolean; onToggle: (k: string) => void; texto: string }) {
  return (
    <label className="flex items-start gap-2 py-0.5">
      <input type="checkbox" checked={marcado} onChange={() => onToggle(clave)} data-padron-check={clave} />
      <span>{texto}</span>
    </label>
  );
}
