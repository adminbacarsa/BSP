import React, { useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Sparkles } from 'lucide-react';
import { functions } from '@/lib/firebase';
import type { CuadroPlanilla } from '@/lib/planificacion/importarExcel';
import {
  aplicarAceptadas,
  armarGrillaIa,
  compararLecturaIa,
  validarLecturaIa,
  type ItemComparacionIa,
  type LecturaPlanillaIa,
  type PropuestaAceptadaIa,
} from '@/lib/planificacion/planillaIa';
import type { PropuestaServicio } from '@/lib/planificacion/servicioDesdePlanilla';

type Props = {
  cuadro: CuadroPlanilla;
  propuesta: PropuestaServicio;
  empresaId?: string;
  objectiveId?: string;
  year: number;
  month: number;
  onAplicar: (next: PropuestaAceptadaIa) => void;
};

function mensajeDe(error: unknown): string {
  const code = String((error as { code?: string })?.code || '');
  const msg = error instanceof Error ? error.message : String(error || '');
  if (code.includes('unauthenticated')) return 'Tenés que iniciar sesión para leer con IA.';
  if (code.includes('permission-denied')) return 'Sin permiso de planificación para leer con IA.';
  if (/GEMINI_API_KEY|igual que antes|failed-precondition|unavailable|deadline/i.test(`${code} ${msg}`)) {
    return 'La IA no está disponible. La planilla se lee igual que antes.';
  }
  return 'No se pudo leer con IA. La planilla se lee igual que antes.';
}

function claseFila(clase: ItemComparacionIa['clase']): string {
  if (clase === 'coincidencia') return 'border-emerald-100 bg-emerald-50 text-emerald-950';
  if (clase === 'diferencia') return 'border-amber-100 bg-amber-50 text-amber-950';
  return 'border-indigo-100 bg-indigo-50 text-indigo-950';
}

export function PlanillaIaPanel({ cuadro, propuesta, empresaId, objectiveId, year, month, onAplicar }: Props) {
  const [leyendo, setLeyendo] = useState(false);
  const [aviso, setAviso] = useState('');
  const [lectura, setLectura] = useState<LecturaPlanillaIa | null>(null);
  const [captura, setCaptura] = useState<{ base64: string; mime: string; nombre: string } | null>(null);
  const [aceptadas, setAceptadas] = useState<string[]>([]);
  const items = useMemo(() => (lectura ? compararLecturaIa(propuesta, lectura) : []), [lectura, propuesta]);
  const pendientes = items.filter((item) => item.aceptable && !aceptadas.includes(item.id));

  const leer = async () => {
    setAviso('');
    setLeyendo(true);
    try {
      if (!empresaId || !objectiveId) {
        setAviso('Elegí el objetivo antes de leer con IA. La planilla se lee igual que antes.');
        return;
      }
      const fixture = process.env.NEXT_PUBLIC_USE_EMULATOR === 'true'
        ? window.localStorage.getItem('cosp-planilla-ia-fixture')
        : null;
      const lecturaIa = fixture
        ? validarLecturaIa(JSON.parse(fixture))
        : await llamar(empresaId, objectiveId);
      setLectura(lecturaIa);
      setAceptadas([]);
    } catch (e) {
      setLectura(null);
      setAviso(mensajeDe(e));
    } finally {
      setLeyendo(false);
    }
  };

  const llamar = async (empresa: string, objetivo: string): Promise<LecturaPlanillaIa> => {
    const call = httpsCallable(functions, 'interpretarPlanillaIa', { timeout: 180000 });
    const res = await call({
      empresaId: empresa,
      objectiveId: objetivo,
      grilla: armarGrillaIa(cuadro, year, month),
      imagenBase64: captura?.base64,
      imagenMime: captura?.mime,
    });
    const data = res.data as { lectura?: unknown };
    return validarLecturaIa(data?.lectura);
  };

  const aceptar = (ids: string[]) => {
    if (!lectura) return;
    const next = [...new Set([...aceptadas, ...ids])];
    setAceptadas(next);
    onAplicar(aplicarAceptadas(propuesta, lectura, next, year, month));
  };

  const elegirCaptura = (file: File | null) => {
    setAviso('');
    if (!file) {
      setCaptura(null);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setCaptura(null);
      setAviso('La captura supera 5 MB. Se lee la planilla igual, sin imagen.');
      return;
    }
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      setCaptura(null);
      setAviso('La captura tiene que ser PNG o JPG.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result || '');
      const base64 = data.replace(/^data:image\/\w+;base64,/, '');
      setCaptura({ base64, mime: file.type, nombre: file.name });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-2" data-planilla-ia>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-planilla-ia-leer
          disabled={leyendo}
          onClick={() => { void leer(); }}
          className="inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-3 py-1.5 text-[12px] font-black text-white shadow-sm disabled:opacity-40"
        >
          <Sparkles size={14} /> {leyendo ? 'Leyendo…' : 'Leer con IA'}
        </button>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[12px] text-slate-600 shadow-sm">
          Adjuntar captura
          <input
            data-planilla-ia-captura
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => elegirCaptura(e.target.files?.[0] || null)}
          />
        </label>
        {captura && <span className="text-[11px] text-slate-500">{captura.nombre}</span>}
      </div>
      {aviso && <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 shadow-sm" data-planilla-ia-aviso>{aviso}</p>}
      {lectura && (
        <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm" data-planilla-ia-resultado>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] font-black text-slate-800">Leído con IA</p>
            {pendientes.length > 0 && (
              <button type="button" data-planilla-ia-aceptar-todas onClick={() => aceptar(pendientes.map((item) => item.id))} className="rounded-xl border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-black text-indigo-900">
                Aceptar todas ({pendientes.length})
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-500">La base sigue siendo el lector de la planilla. Lo que aceptes entra a la propuesta, a las equivalencias y al pegado cuando guardes el servicio.</p>
          {items.map((item) => (
            <div key={item.id} data-planilla-ia-fila={item.id} data-planilla-ia-clase={item.clase} className={`rounded-xl border px-2 py-1.5 text-[12px] ${claseFila(item.clase)}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-black">{item.titulo} · {item.clase} · {Math.round(item.confianza * 100)}%</p>
                {item.aceptable && !aceptadas.includes(item.id) && (
                  <button type="button" data-planilla-ia-aceptar={item.id} onClick={() => aceptar([item.id])} className="rounded-lg bg-white px-2 py-0.5 text-[11px] font-black text-slate-800 shadow-sm">
                    Aceptar
                  </button>
                )}
                {aceptadas.includes(item.id) && <span className="text-[11px] font-black">Aceptada</span>}
              </div>
              <p>Lector: {item.lector}</p>
              <p>IA: {item.ia}</p>
            </div>
          ))}
          {lectura.dudas.map((duda) => (
            <p key={duda} className="text-[11px] text-slate-500" data-planilla-ia-duda>{duda}</p>
          ))}
        </div>
      )}
    </div>
  );
}
