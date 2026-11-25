import React, { useEffect, useMemo, useState } from 'react';
import { addDays, format } from 'date-fns';
import { CheckCircle2, MessageSquare, Phone, Send, Shield, Smartphone, X } from 'lucide-react';
import {
  ChipsRetenEvaluado,
  SelectorDestinoRetenes,
  type DestinoRetenOpcion,
} from '@/components/operaciones/RetenesDestinoPiezas';
import {
  compararRetenesEvaluados,
  evaluarRetenParaDestino,
  type EmpleadoRetenInfo,
  type OrdenRetenes,
} from '@/lib/operaciones/retenesParaDestino';

export type RetenTono = 'ok' | 'espera' | 'alerta' | 'cerrado' | 'neutro';

export interface RetenItem {
  rowId: string;
  employeeId: string;
  nombre: string;
  phone?: string;
  objetivo: string;
  horario: string;
  estadoLabel: string;
  estadoTono: RetenTono;
  dia: 'hoy' | 'manana';
  /** Estado operativo del RET hoy (ESPERANDO, PENDIENTE_WA, TARDANZA…): habilita «Disponible» / «Confirmar». */
  estadoRaw?: string;
  /** Horario que el operador escribió para un objetivo suelto (se usa en {horarioDe}). */
  horarioDestino?: string;
}

/** Retenes que pueden ir a un destino (ya con objetivo y horario del destino para armar el mensaje). */
export interface RetenesParaDestino {
  items: RetenItem[];
  esManana: boolean;
}

export interface RetenAviso {
  item: RetenItem;
  texto: string;
}

export interface RetenEnvioApp {
  enviados: number;
  fallidos: number;
}

interface ModalRetenesDiaProps {
  hoy: RetenItem[];
  manana: RetenItem[];
  bridgeConectado: boolean;
  onEnviarApp: (avisos: RetenAviso[]) => Promise<RetenEnvioApp>;
  onEnviarWa: (avisos: RetenAviso[]) => Promise<string>;
  onClose: () => void;
  /** Huecos sin cubrir y objetivos de hoy donde se puede usar un retén. */
  destinos?: DestinoRetenOpcion[];
  empInfo?: Record<string, EmpleadoRetenInfo>;
  candidatosPara?: (d: DestinoRetenOpcion) => RetenesParaDestino;
  /** Asigna el retén al hueco y le avisa por WhatsApp y por la app. */
  onAsignar?: (item: RetenItem, d: DestinoRetenOpcion, avisar: boolean) => void;
  onMarcarPresente?: (item: RetenItem) => void;
  onConfirmarWA?: (item: RetenItem) => void;
  ocupado?: boolean;
}

interface Plantilla {
  id: string;
  label: string;
  texto: string;
}

const PLANTILLAS: Plantilla[] = [
  {
    id: 'disponibilidad',
    label: 'Confirmar disponibilidad',
    texto:
      '{nombre}, {cuando} estás de retén ({horario}). Confirmanos que estás disponible y localizable. — Operaciones',
  },
  {
    id: 'a_mano',
    label: 'Quedate a mano',
    texto:
      '{nombre}, {cuando} mantenete disponible y con el teléfono a mano: podemos necesitarte para cubrir un turno. — Operaciones',
  },
  {
    id: 'liberado',
    label: 'Liberado',
    texto: '{nombre}, ya no te necesitamos {cuando} como retén. Gracias por la disponibilidad. — Operaciones',
  },
];

/** Plantillas que solo tienen sentido con un destino elegido ({objetivo} y {horario} son los del destino). */
const PLANTILLA_ASIGNACION: Plantilla = {
  id: 'asignacion',
  label: 'Asignación al hueco',
  texto:
    '{nombre}, quedaste asignado a cubrir {objetivo} ({horario}). Confirmá que vas en camino y avisá cuando llegues. — Operaciones',
};
/** Primero se consulta si puede ir; recién después se asigna. */
const PLANTILLA_CONSULTA_HUECO: Plantilla = {
  id: 'consulta_hueco',
  label: 'Consultar si puede ir',
  texto:
    '{nombre}, ¿podés cubrir {objetivo} de {horario}? Confirmanos a la brevedad si podés ir. — Operaciones',
};
const PLANTILLA_CONSULTA: Plantilla = {
  id: 'consulta',
  label: 'Consulta por el objetivo',
  texto:
    '{nombre}, podemos necesitarte en {objetivo}{horarioDe}. ¿Estás disponible y cuánto tardarías en llegar? Confirmá a la brevedad. — Operaciones',
};

const MENSAJE_MAX = 400;

/** Minúsculas y sin tildes, para buscar por nombre. */
function normalizarBusqueda(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Valor del selector de destino para ver la lista completa de retenes. */
export const TODOS_LOS_RETENES = '__todos__';

const TONO_CLASE: Record<RetenTono, string> = {
  ok: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  espera: 'bg-amber-100 text-amber-800 border-amber-200',
  alerta: 'bg-red-100 text-red-700 border-red-200',
  cerrado: 'bg-slate-200 text-slate-600 border-slate-300',
  neutro: 'bg-slate-100 text-slate-600 border-slate-200',
};

/** "APELLIDO, NOMBRE SEGUNDO" → "Nombre". Sin coma usa la primera palabra. */
export function primerNombre(employeeName: string): string {
  const crudo = String(employeeName || '').trim();
  if (!crudo) return '';
  const tras = crudo.includes(',') ? crudo.split(',')[1] || '' : crudo;
  const palabra = tras.trim().split(/\s+/)[0] || '';
  if (!palabra) return '';
  return palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase();
}

export function armarTextoReten(plantilla: string, item: RetenItem): string {
  const nombre = primerNombre(item.nombre);
  const cuando = item.dia === 'manana' ? 'mañana' : 'hoy';
  let texto = plantilla
    .replace(/\{horarioDe\}/g, item.horarioDestino ? ` (${item.horarioDestino})` : '')
    .replace(/\{cuando\}/g, cuando)
    .replace(/\{horario\}/g, item.horario)
    .replace(/\{objetivo\}/g, item.objetivo);
  if (nombre) {
    texto = texto.replace(/\{nombre\}/g, nombre);
  } else {
    texto = texto.replace(/\{nombre\},\s*/g, '').replace(/\{nombre\}/g, '');
    texto = texto.charAt(0).toUpperCase() + texto.slice(1);
  }
  return texto.trim();
}

interface Resultado {
  app?: boolean;
  wa?: boolean;
}

export default function ModalRetenesDia({
  hoy,
  manana,
  bridgeConectado,
  onEnviarApp,
  onEnviarWa,
  onClose,
  destinos = [],
  empInfo = {},
  candidatosPara,
  onAsignar,
  onMarcarPresente,
  onConfirmarWA,
  ocupado = false,
}: ModalRetenesDiaProps) {
  const [dia, setDia] = useState<'hoy' | 'manana'>('hoy');
  const [destinoKey, setDestinoKey] = useState('');
  const [orden, setOrden] = useState<OrdenRetenes>('cercania');
  const [verLejanos, setVerLejanos] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [horarioObj, setHorarioObj] = useState('');
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [plantillaId, setPlantillaId] = useState<string>(PLANTILLAS[0].id);
  const [texto, setTexto] = useState<string>(PLANTILLAS[0].texto);
  const [porApp, setPorApp] = useState(true);
  const [porWa, setPorWa] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [resultados, setResultados] = useState<Record<string, Resultado>>({});
  const [mensajeEstado, setMensajeEstado] = useState<string>('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const destino = destinoKey ? destinos.find((d) => d.key === destinoKey) ?? null : null;
  /** Con muchos retenes no se vuelca la lista: primero se elige el destino, o «Todos los retenes». */
  const exigeDestino = destinos.length > 0 && !!candidatosPara;
  const verTodos = destinoKey === TODOS_LOS_RETENES;
  const mostrarLista = !exigeDestino || !!destino || verTodos;
  // Si el hueco se cubrió o desapareció mientras el modal estaba abierto, vuelve a pedir el destino.
  useEffect(() => {
    if (destinoKey && !destino && destinoKey !== TODOS_LOS_RETENES) setDestinoKey('');
  }, [destinoKey, destino]);

  /** Con destino: retenes que pueden ir ahí, con distancia y conocimiento del objetivo, ordenados. */
  const paraDestino = useMemo(() => {
    if (!destino || !candidatosPara) return null;
    const cand = candidatosPara(destino);
    const evaluados = cand.items.map((item) => ({
      item,
      ev: evaluarRetenParaDestino(item.employeeId, empInfo[item.employeeId], {
        objectiveId: destino.objectiveId,
        lat: destino.lat,
        lng: destino.lng,
        positionName: destino.positionName,
      }),
    }));
    evaluados.sort((a, b) => compararRetenesEvaluados(a.ev, b.ev, orden));
    return { esManana: cand.esManana, evaluados };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destino, candidatosPara, empInfo, orden, hoy, manana]);

  const fueraDeRadio = paraDestino ? paraDestino.evaluados.filter((e) => !e.ev.dentroRadio).length : 0;
  // A más de 15 km se ocultan por defecto; sin dato de distancia no se ocultan.
  const textoBusqueda = normalizarBusqueda(busqueda);
  const coincideBusqueda = (it: RetenItem): boolean =>
    !textoBusqueda || normalizarBusqueda(it.nombre).includes(textoBusqueda);
  const horarioLibre = destino?.tipo === 'objetivo' ? horarioObj.trim() : '';
  const evaluadosVisibles = paraDestino
    ? (verLejanos ? paraDestino.evaluados : paraDestino.evaluados.filter((e) => e.ev.dentroRadio))
        .filter((e) => coincideBusqueda(e.item))
        .map((e) => (horarioLibre ? { ...e, item: { ...e.item, horarioDestino: horarioLibre } } : e))
    : [];
  const evaluacionPorRow = useMemo(() => {
    const m = new Map<string, (typeof evaluadosVisibles)[number]['ev']>();
    for (const e of evaluadosVisibles) m.set(e.item.rowId, e.ev);
    return m;
  }, [evaluadosVisibles]);

  const lista = paraDestino
    ? evaluadosVisibles.map((e) => e.item)
    : (dia === 'hoy' ? hoy : manana).filter(coincideBusqueda);
  const fechaDia = useMemo(() => {
    const base = (paraDestino?.esManana ?? dia === 'manana') ? addDays(new Date(), 1) : new Date();
    return format(base, 'dd/MM/yyyy');
  }, [dia, paraDestino?.esManana]);

  useEffect(() => {
    setSeleccion(new Set());
    setMensajeEstado('');
  }, [dia, destinoKey]);

  // Al elegir un destino se propone el mensaje que corresponde; al volver a la lista, el de disponibilidad.
  useEffect(() => {
    const p = !destino ? PLANTILLAS[0] : destino.tipo === 'hueco' ? PLANTILLA_CONSULTA_HUECO : PLANTILLA_CONSULTA;
    setPlantillaId(p.id);
    setTexto(p.texto);
  }, [destino?.key, destino?.tipo]);

  const seleccionados = useMemo(() => lista.filter((i) => seleccion.has(i.rowId)), [lista, seleccion]);
  const todosMarcados = lista.length > 0 && seleccionados.length === lista.length;
  const textoValido = texto.trim().length > 0;
  const bridgeNecesario = porWa && !bridgeConectado;

  const alternar = (rowId: string) => {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  const alternarTodos = () => {
    setSeleccion(todosMarcados ? new Set() : new Set(lista.map((i) => i.rowId)));
  };

  const elegirPlantilla = (p: Plantilla) => {
    setPlantillaId(p.id);
    setTexto(p.texto);
  };

  /** Un solo mensaje por guardia aunque tenga dos filas de retén. */
  const sinDuplicados = (items: RetenItem[]): RetenItem[] => {
    const visto = new Set<string>();
    const out: RetenItem[] = [];
    for (const it of items) {
      const clave = it.employeeId || it.nombre;
      if (visto.has(clave)) continue;
      visto.add(clave);
      out.push(it);
    }
    return out;
  };

  const marcar = (items: RetenItem[], canal: 'app' | 'wa', ok: boolean) => {
    setResultados((prev) => {
      const next = { ...prev };
      for (const it of items) next[it.rowId] = { ...next[it.rowId], [canal]: ok };
      return next;
    });
  };

  const enviar = async (items: RetenItem[], conApp: boolean, conWa: boolean) => {
    if (enviando) return;
    if (!textoValido) {
      setMensajeEstado('Escribí el mensaje antes de enviar.');
      return;
    }
    const unicos = sinDuplicados(items);
    if (unicos.length === 0) return;
    setEnviando(true);
    setMensajeEstado('');
    const partes: string[] = [];
    try {
      if (conApp) {
        const destinos = unicos.filter((i) => i.employeeId);
        const sinLegajo = unicos.length - destinos.length;
        if (destinos.length > 0) {
          const r = await onEnviarApp(destinos.map((item) => ({ item, texto: armarTextoReten(texto, item) })));
          const fallidosAprox = Math.min(r.fallidos, destinos.length);
          if (fallidosAprox === 0) marcar(destinos, 'app', true);
          partes.push(`App: ${r.enviados} enviado${r.enviados === 1 ? '' : 's'}${r.fallidos ? `, ${r.fallidos} con error` : ''}`);
        }
        if (sinLegajo > 0) partes.push(`App: ${sinLegajo} sin legajo`);
      }
      if (conWa) {
        const destinos = unicos.filter((i) => i.phone);
        const sinTel = unicos.length - destinos.length;
        if (destinos.length > 0) {
          await onEnviarWa(destinos.map((item) => ({ item, texto: armarTextoReten(texto, item) })));
          marcar(destinos, 'wa', true);
          partes.push(`WhatsApp: ${destinos.length} procesado${destinos.length === 1 ? '' : 's'}`);
        }
        if (sinTel > 0) partes.push(`WhatsApp: ${sinTel} sin teléfono`);
      }
      setMensajeEstado(partes.join(' · '));
    } catch (e) {
      setMensajeEstado(`Error al enviar: ${(e as Error)?.message || 'reintentá'}`);
    } finally {
      setEnviando(false);
    }
  };

  const enviarSeleccion = () => {
    if (seleccionados.length === 0) {
      setMensajeEstado('Marcá al menos un guardia.');
      return;
    }
    if (!porApp && !porWa) {
      setMensajeEstado('Elegí al menos un canal: App o WhatsApp.');
      return;
    }
    if (bridgeNecesario && seleccionados.length > 1) {
      setMensajeEstado('El bridge de WhatsApp no está conectado: usá el botón WA de cada fila o enviá solo por la app.');
      return;
    }
    void enviar(seleccionados, porApp, porWa);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-3xl shadow-lg max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-3 bg-violet-50">
          <Shield size={18} className="text-violet-600 flex-shrink-0" aria-hidden />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-black text-violet-800">Retenes</div>
            <div className="text-[11px] text-slate-600">
              {fechaDia} ·{' '}
              {mostrarLista
                ? `${lista.length} retén${lista.length === 1 ? '' : 'es'}`
                : `${hoy.length} hoy · ${manana.length} mañana`}
              {paraDestino && destino ? ` para ${destino.etiqueta}` : ''}
            </div>
          </div>
          {!destino && mostrarLista && (
            <div className="flex items-center gap-1 rounded-xl bg-white border border-violet-200 p-0.5">
              {(['hoy', 'manana'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDia(d)}
                  className={`px-3 py-1 rounded-lg text-[11px] font-bold ${
                    dia === d ? 'bg-violet-600 text-white' : 'text-slate-600 hover:bg-violet-50'
                  }`}
                >
                  {d === 'hoy' ? `Hoy (${hoy.length})` : `Mañana (${manana.length})`}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="p-1 rounded-lg hover:bg-violet-100 text-slate-400"
          >
            <X size={16} />
          </button>
        </div>

        {destinos.length > 0 && candidatosPara && (
          <SelectorDestinoRetenes
            destinos={destinos}
            valor={destinoKey}
            retenesHoy={hoy.length}
            retenesManana={manana.length}
            orden={orden}
            onChange={setDestinoKey}
            onOrden={setOrden}
          />
        )}
        {mostrarLista && (
          <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-violet-100 bg-white">
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar retén por nombre…"
              aria-label="Buscar retén por nombre"
              className="flex-1 min-w-[180px] rounded-xl border border-slate-200 px-3 py-1.5 text-[12px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
            {destino?.tipo === 'objetivo' && (
              <input
                type="text"
                value={horarioObj}
                onChange={(e) => setHorarioObj(e.target.value)}
                placeholder="Horario (opcional) · ej. 08:00–18:00"
                aria-label="Horario para el aviso"
                maxLength={40}
                className="w-64 rounded-xl border border-slate-200 px-3 py-1.5 text-[12px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            )}
          </div>
        )}
        {paraDestino && (
          <div className="px-4 py-1.5 text-[10px] text-slate-500 border-b border-violet-100 bg-white">
            {paraDestino.esManana ? 'Retenes de mañana (cubren la noche)' : 'Retenes de hoy'}
            {fueraDeRadio > 0 && (
              <button
                type="button"
                onClick={() => setVerLejanos((v) => !v)}
                className="ml-2 px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-800 text-[10px] font-bold hover:bg-amber-100"
              >
                {verLejanos ? `Ocultar los de más de 15 km (${fueraDeRadio})` : `Mostrar ${fueraDeRadio} a más de 15 km`}
              </button>
            )}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto">
          {!mostrarLista ? (
            <div className="px-6 py-10 text-center">
              <div className="text-sm font-bold text-slate-700">Elegí dónde lo vas a usar</div>
              <div className="mt-1 text-[12px] text-slate-500">
                Te muestro solo los retenes que sirven para ese hueco u objetivo, con la distancia y si conocen el lugar.
              </div>
              <button
                type="button"
                onClick={() => setDestinoKey(TODOS_LOS_RETENES)}
                className="mt-4 px-3 py-1.5 rounded-xl border border-violet-200 bg-violet-50 text-violet-700 text-[11px] font-bold hover:bg-violet-100 active:scale-95"
              >
                Ver todos los retenes (hoy {hoy.length} · mañana {manana.length})
              </button>
            </div>
          ) : lista.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">
              {paraDestino
                ? fueraDeRadio > 0
                  ? 'No hay retenes a menos de 15 km de este destino.'
                  : 'No hay retenes disponibles para este destino.'
                : dia === 'hoy'
                  ? 'No hay retenes cargados para hoy.'
                  : 'No hay retenes cargados para mañana.'}
            </div>
          ) : (
            <div>
              <label className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 bg-slate-50 text-[11px] font-bold text-slate-600 cursor-pointer">
                <input type="checkbox" checked={todosMarcados} onChange={alternarTodos} className="accent-violet-600" />
                Seleccionar todos ({seleccionados.length}/{lista.length})
              </label>
              {lista.map((it) => {
                const res = resultados[it.rowId];
                const ev = evaluacionPorRow.get(it.rowId);
                return (
                  <div
                    key={it.rowId}
                    className={`flex items-center gap-3 px-4 py-2 border-b border-slate-100 hover:bg-violet-50/50 ${
                      ev && !ev.dentroRadio ? 'opacity-70' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={seleccion.has(it.rowId)}
                      onChange={() => alternar(it.rowId)}
                      className="accent-violet-600"
                      aria-label={`Seleccionar ${it.nombre}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-800 truncate">{it.nombre}</div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {ev ? 'RET' : it.horario}
                        {!ev && it.objetivo && it.objetivo !== '—' ? ` · ${it.objetivo}` : ''}
                        {it.phone ? ` · ${it.phone}` : ' · sin teléfono'}
                      </div>
                      {ev && (
                        <div className="mt-1">
                          <ChipsRetenEvaluado ev={ev} />
                        </div>
                      )}
                    </div>
                    <span
                      className={`px-2 py-0.5 text-[9px] font-bold rounded-full border whitespace-nowrap ${TONO_CLASE[it.estadoTono]}`}
                    >
                      {it.estadoLabel}
                    </span>
                    {!destino && it.dia === 'hoy' && onConfirmarWA && it.estadoRaw === 'PENDIENTE_WA' && (
                      <button
                        type="button"
                        disabled={ocupado}
                        onClick={() => onConfirmarWA(it)}
                        className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold disabled:opacity-50 active:scale-95"
                      >
                        ✓ Confirmar
                      </button>
                    )}
                    {!destino &&
                      it.dia === 'hoy' &&
                      onMarcarPresente &&
                      (it.estadoRaw === 'ESPERANDO' || it.estadoRaw === 'TARDANZA') && (
                        <button
                          type="button"
                          disabled={ocupado}
                          onClick={() => onMarcarPresente(it)}
                          className="px-2 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-bold disabled:opacity-50 active:scale-95"
                        >
                          ✓ Disponible
                        </button>
                      )}
                    {destino && destino.tipo === 'hueco' && onAsignar && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={ocupado || enviando}
                          onClick={() => onAsignar(it, destino, false)}
                          title="Asigna el RET al hueco sin mandarle mensaje (cuando ya confirmó que puede ir)"
                          className="px-2.5 py-1.5 rounded-xl border border-violet-300 bg-white text-violet-700 hover:bg-violet-50 text-[10px] font-bold shadow-sm disabled:opacity-50 active:scale-95"
                        >
                          Asignar
                        </button>
                        <button
                          type="button"
                          disabled={ocupado || enviando}
                          onClick={() => onAsignar(it, destino, true)}
                          title="Asigna el RET al hueco y le avisa por WhatsApp y por la app"
                          className="px-2.5 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-bold shadow-sm disabled:opacity-50 active:scale-95"
                        >
                          Asignar y avisar
                        </button>
                      </div>
                    )}
                    {(res?.app || res?.wa) && (
                      <span
                        className="flex items-center gap-0.5 text-[9px] font-bold text-emerald-600"
                        title={`Enviado${res.app ? ' por la app' : ''}${res.app && res.wa ? ' y' : ''}${res.wa ? ' por WhatsApp' : ''}`}
                      >
                        <CheckCircle2 size={12} />
                        {res.app ? 'App' : ''}
                        {res.app && res.wa ? '+' : ''}
                        {res.wa ? 'WA' : ''}
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={enviando || !textoValido || !it.employeeId}
                      onClick={() => void enviar([it], true, false)}
                      title={it.employeeId ? 'Enviar por la app del guardia' : 'Sin legajo'}
                      aria-label={`Enviar por la app a ${it.nombre}`}
                      className="p-1.5 rounded-xl border border-indigo-200 text-indigo-600 hover:bg-indigo-50 disabled:opacity-40 active:scale-95"
                    >
                      <Smartphone size={13} />
                    </button>
                    <button
                      type="button"
                      disabled={enviando || !textoValido || !it.phone}
                      onClick={() => void enviar([it], false, true)}
                      title={it.phone ? 'Enviar por WhatsApp' : 'Sin teléfono'}
                      aria-label={`Enviar por WhatsApp a ${it.nombre}`}
                      className="p-1.5 rounded-xl border border-emerald-200 text-emerald-600 hover:bg-emerald-50 disabled:opacity-40 active:scale-95"
                    >
                      <Phone size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {mostrarLista && (
        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <MessageSquare size={13} className="text-slate-400" aria-hidden />
            {[...PLANTILLAS, ...(destino
              ? destino.tipo === 'hueco'
                ? [PLANTILLA_CONSULTA_HUECO, PLANTILLA_ASIGNACION]
                : [PLANTILLA_CONSULTA]
              : [])].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => elegirPlantilla(p)}
                className={`px-2 py-1 rounded-full text-[10px] font-bold border ${
                  plantillaId === p.id && texto === p.texto
                    ? 'bg-violet-600 text-white border-violet-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <textarea
            value={texto}
            maxLength={MENSAJE_MAX}
            rows={3}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Mensaje para los retenes…"
            className="w-full resize-none rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <span>
              {'{nombre}'}, {'{horario}'}, {'{objetivo}'} y {'{cuando}'} se completan por guardia.
            </span>
            <span className="tabular-nums">
              {texto.length}/{MENSAJE_MAX}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 cursor-pointer">
              <input type="checkbox" checked={porApp} onChange={(e) => setPorApp(e.target.checked)} className="accent-indigo-600" />
              <Smartphone size={13} className="text-indigo-600" /> App
            </label>
            <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 cursor-pointer">
              <input type="checkbox" checked={porWa} onChange={(e) => setPorWa(e.target.checked)} className="accent-emerald-600" />
              <Phone size={13} className="text-emerald-600" /> WhatsApp
              <span
                className={`ml-0.5 w-1.5 h-1.5 rounded-full ${bridgeConectado ? 'bg-emerald-500' : 'bg-slate-300'}`}
                title={bridgeConectado ? 'Bridge conectado' : 'Bridge sin conexión'}
              />
            </label>
            <div className="flex-1" />
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-[12px] font-bold"
            >
              Cerrar
            </button>
            <button
              type="button"
              disabled={enviando || seleccionados.length === 0 || !textoValido}
              onClick={enviarSeleccion}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[12px] font-bold shadow-sm disabled:opacity-50 active:scale-95"
            >
              <Send size={13} />
              {enviando ? 'Enviando…' : `Enviar a ${seleccionados.length}`}
            </button>
          </div>
          {mensajeEstado && <div className="text-[11px] font-semibold text-violet-700">{mensajeEstado}</div>}
          {bridgeNecesario && (
            <div className="text-[10px] text-amber-700">
              Bridge de WhatsApp sin conexión: el envío masivo por WA no está disponible; cada fila abre WhatsApp a mano.
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
