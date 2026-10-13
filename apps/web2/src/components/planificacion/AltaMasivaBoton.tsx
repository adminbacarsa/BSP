import React, { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Loader2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { confirmarAltaLegajo, type AltaHecha } from '@/lib/rrhh/altaLegajoClient';
import { filasDesdeHoja, padronEnSesion, recordarPadron, type FilaPadron } from '@/lib/planificacion/padronAlta';
import { fechaPadronVisible } from '@/lib/rrhh/padronComparar';
import { guardarPadron, leerEstadoPadron, listarPadron } from '@/lib/rrhh/padronClient';
import { planAltaMasiva, resumenAltaMasiva, type PedidoAltaMasiva, type ResultadoAltaMasiva } from '@/lib/planificacion/altaMasiva';

type Props = {
  pedidos: PedidoAltaMasiva[];
  empresaId: string;
  empresaNombre?: string;
  objectiveId: string;
  clientId: string;
  onCreado: (clave: number, empleado: AltaHecha) => void;
};

function leerHoja(buf: ArrayBuffer): FilaPadron[] {
  const wb = XLSX.read(buf, { type: 'array', cellDates: false });
  const name = wb.SheetNames.find((n) => n.toUpperCase() === 'SP') || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' }) as unknown[][];
  return filasDesdeHoja(rows);
}

/**
 * Da de alta, de una vez, a los guardias que no se encontraron, con el padrón de ESTA empresa.
 * Lo que no es seguro (no está, parecido, de baja en el padrón, datos inválidos) queda listado para revisar.
 */
export function AltaMasivaBoton({ pedidos, empresaId, empresaNombre, objectiveId, clientId, onCreado }: Props) {
  const [padron, setPadron] = useState<FilaPadron[] | null>(() => padronEnSesion(empresaId));
  const [fecha, setFecha] = useState('');
  const [cargando, setCargando] = useState(true);
  const [corriendo, setCorriendo] = useState<{ hechos: number; total: number } | null>(null);
  const [resultados, setResultados] = useState<ResultadoAltaMasiva[] | null>(null);
  const [pedirPadron, setPedirPadron] = useState(false);
  const archivoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let vivo = true;
    setPadron(padronEnSesion(empresaId));
    setCargando(true);
    Promise.all([leerEstadoPadron(empresaId), listarPadron(empresaId)])
      .then(([estado, filas]) => {
        if (!vivo || !estado || !filas.length) return;
        recordarPadron(empresaId, filas);
        setPadron(filas);
        setFecha(estado.fecha);
      })
      .catch(() => {})
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [empresaId]);

  const correr = async (filas: FilaPadron[]) => {
    const plan = planAltaMasiva(filas, pedidos, { empresaId, objectiveId, clientId });
    const altas = plan.filter((p) => p.tipo === 'alta');
    const res: ResultadoAltaMasiva[] = plan
      .filter((p) => p.tipo === 'revisar')
      .map((p) => ({ clave: p.clave, nombre: p.nombre, estado: 'revisar' as const, motivo: p.tipo === 'revisar' ? p.motivo : '' }));
    setResultados(null);
    setCorriendo({ hechos: 0, total: altas.length });
    for (const [i, p] of altas.entries()) {
      if (p.tipo !== 'alta') continue;
      try {
        const r = await confirmarAltaLegajo(p.form, 'PADRON_ALTA');
        if ('mensaje' in r) {
          res.push({ clave: p.clave, nombre: p.nombre, estado: 'revisar', motivo: r.mensaje });
        } else {
          res.push({ clave: p.clave, nombre: p.nombre, estado: r.empleado.habilitado ? 'habilitado' : 'creado' });
          onCreado(p.clave, r.empleado);
        }
      } catch (e) {
        console.error(e);
        res.push({ clave: p.clave, nombre: p.nombre, estado: 'revisar', motivo: 'No se pudo guardar el legajo' });
      }
      setCorriendo({ hechos: i + 1, total: altas.length });
    }
    setCorriendo(null);
    setResultados(res);
    toast.success(resumenAltaMasiva(res));
  };

  const onArchivo = async (file: File) => {
    let filas: FilaPadron[];
    try {
      filas = leerHoja(await file.arrayBuffer());
    } catch {
      toast.error('No se pudo leer el archivo del padrón.');
      return;
    }
    if (!filas.length) { toast.error('El archivo no tiene filas en la hoja SP.'); return; }
    recordarPadron(empresaId, filas);
    setPadron(filas);
    try {
      const estado = await guardarPadron(empresaId, filas, file.name);
      setFecha(estado.fecha);
      toast.success(`Padrón de ${empresaNombre || empresaId} actualizado (${filas.length} personas)`);
    } catch (e) {
      console.error(e);
      toast.message('El padrón se usa en esta sesión: no se pudo guardar (falta permiso de RRHH).');
    }
    if (pedirPadron) {
      setPedirPadron(false);
      await correr(filas);
    }
  };

  const onTodos = () => {
    if (corriendo || cargando) return;
    if (!padron) { setPedirPadron(true); archivoRef.current?.click(); return; }
    void correr(padron);
  };

  const revisar = (resultados || []).filter((r) => r.estado === 'revisar');

  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-[12px]" data-alta-masiva>
      <div className="flex flex-wrap items-center gap-2">
        {pedidos.length > 0 && (
          <button
            type="button"
            data-alta-todos
            disabled={!!corriendo || cargando}
            onClick={onTodos}
            className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-[11px] font-black text-white shadow-sm hover:bg-indigo-700 disabled:border disabled:border-slate-200 disabled:bg-white disabled:text-slate-400"
          >
            {corriendo ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
            {corriendo ? `Dando de alta ${corriendo.hechos} de ${corriendo.total}…` : `Dar de alta a todos (${pedidos.length})`}
          </button>
        )}
        <span className="text-slate-600" data-alta-padron-estado>
          {cargando ? 'Buscando el padrón…' : padron ? `Padrón de ${empresaNombre || empresaId}${fecha ? ` del ${fechaPadronVisible(fecha)}` : ' (esta sesión)'} · ${padron.length} personas` : `Sin padrón de ${empresaNombre || empresaId}`}
        </span>
        <button type="button" className="font-bold text-indigo-700 hover:underline" data-alta-padron-actualizar onClick={() => { setPedirPadron(false); archivoRef.current?.click(); }}>
          {padron ? 'Actualizar padrón' : 'Subir padrón'}
        </button>
        <input
          ref={archivoRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          data-alta-padron-archivo
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onArchivo(f); }}
        />
      </div>
      {resultados && (
        <div className="mt-1.5" data-alta-masiva-resultado>
          <p className="font-bold text-slate-700">{resumenAltaMasiva(resultados)}</p>
          {revisar.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-slate-600">
              {revisar.map((r) => (
                <li key={r.clave} data-alta-revisar={r.clave}><b>{r.nombre}</b>: {r.motivo}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
