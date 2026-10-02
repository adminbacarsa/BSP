/**
 * Solapa EVENTUALES (bolsa) para los selectores de cobertura:
 * Planificación (licencia / vacante / hueco), Sustituir y Eventos.
 *
 * Lee la callable `listarCandidatosEventuales` (solo disponibles y habilitados para la empresa del objetivo;
 * el cruce 12 h con otras empresas del grupo se muestra como motivo). Escribe nada: el `onSelect`
 * decide (asignar / sustituir) y llama a la callable correspondiente.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { AlertTriangle, Loader2, MapPin, Phone, RotateCcw, Search, ShieldCheck, UserCheck, UserX } from 'lucide-react';
import { PuntajeChip } from '@/components/desempeno/PuntajeChip';
import { functions } from '@/lib/firebase';
import { mensajeErrorCallable } from '@/lib/eventos/convocatoriaPlan';
import { GrupoCandidatosHeader, PruebasBadge, SinEspecificarAviso, type GrupoCupoUi } from '@/components/servicios/EventoConvocarResumen';
import { grupoDeGenero } from '@/lib/eventuales/cupoGenero.mjs';

export type JornadaEventual = { fecha: string; horaInicio: string; horaFin: string; horas: number };

export type CandidatoEventual = {
    cuil: string;
    nombre: string;
    telefono?: string;
    elegible: boolean;
    motivo: string | null;
    motivoCodigo: string | null;
    distanciaKm: number | null;
    confiabilidad: number | null;
    vencimientos: { tipo: string; fecha: string | null; estado: 'OK' | 'PRONTO' | 'VENCIDO' | 'SIN_DATO' }[];
    alertas: string[];
    employeeId: string | null;
    /** Ficha con «Exigir contrato marco y habilitación» en OFF: elegible sin marco ni empresa habilitada. */
    pruebasSinMarco?: boolean;
    /** 'M' | 'F' | '' (sin especificar) — cupo por género de los eventos. */
    genero?: string;
    horasMes?: { usadas: number; tope: number; texto: string; aviso: boolean } | null;
};

/** Cupo por género del servicio de evento: la lista se muestra en grupos (Hombres n/X · Mujeres n/Y). */
export type CupoPanelEventuales = {
    servicio: { cupoModo?: string; cupo?: number; cupoPorGenero?: { M: number; F: number } | null };
    grupos: GrupoCupoUi[];
};

type Props = {
    empresaId: string;
    objectiveId?: string | null;
    clientId?: string | null;
    objetivoGeo?: { lat: number; lng: number } | null;
    jornadas: JornadaEventual[];
    /** Turnos que se van a reemplazar (sustitución): no cuentan como cruce. */
    excluirTurnoIds?: string[];
    /** CUIL que no debe aparecer (el titular al sustituir). */
    excluirCuil?: string | null;
    canConvocar: boolean;
    busy?: boolean;
    onSelect: (candidato: CandidatoEventual) => void;
    compact?: boolean;
    /** Si el servicio tiene cupo por género: agrupa la lista y deja aparte a los «Sin especificar». */
    cupo?: CupoPanelEventuales | null;
};

export function jornadasKey(jornadas: JornadaEventual[]): string {
    return jornadas.map(j => `${j.fecha}|${j.horaInicio}|${j.horaFin}`).join(',');
}

const TIPO_LABEL: Record<string, string> = { credencial: 'Credencial', apto: 'Apto', habilitacion: 'Hab. 9236' };

export default function EventualesCandidatosPanel({
    empresaId, objectiveId, clientId, objetivoGeo, jornadas, excluirTurnoIds, excluirCuil, canConvocar, busy, onSelect, compact, cupo,
}: Props) {
    const [rows, setRows] = useState<CandidatoEventual[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    /** Sube con «Reintentar» para volver a pedir la bolsa con los mismos parámetros. */
    const [intento, setIntento] = useState(0);
    const key = jornadasKey(jornadas);

    useEffect(() => {
        if (!canConvocar || !empresaId || jornadas.length === 0) { setRows([]); return; }
        let alive = true;
        setLoading(true);
        setError(null);
        const call = httpsCallable<Record<string, unknown>, { candidatos: CandidatoEventual[] }>(functions, 'listarCandidatosEventuales');
        call({ empresaId, objectiveId: objectiveId || null, clientId: clientId || null, objetivoGeo: objetivoGeo || null, jornadas, excluirTurnoIds: excluirTurnoIds || [] })
            .then(res => { if (alive) setRows((res.data?.candidatos || []).filter(c => c.cuil !== excluirCuil)); })
            .catch((e: unknown) => { if (alive) setError(mensajeErrorCallable(e, 'No se pudo cargar la bolsa de eventuales.')); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [empresaId, objectiveId, key, canConvocar, excluirCuil, (excluirTurnoIds || []).join(','), intento]);

    const filtered = useMemo(() => {
        const s = search.trim().toLowerCase();
        return s ? rows.filter(r => `${r.nombre} ${r.cuil}`.toLowerCase().includes(s)) : rows;
    }, [rows, search]);

    if (!canConvocar) {
        return (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-4 text-[11px] font-bold text-slate-500 text-center">
                Necesitás el permiso <span className="font-black">EVENTUALES · Convocar</span> para asignar desde la bolsa.
            </div>
        );
    }

    const elegibles = rows.filter(r => r.elegible).length;

    return (
        <div className="flex flex-col min-h-0">
            <div className="px-1 pb-2 shrink-0">
                <div className="flex items-center gap-2 bg-slate-50 rounded-lg px-2.5 py-1.5 border border-slate-200">
                    <Search size={12} className="text-slate-400 shrink-0"/>
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Buscar eventual por nombre o CUIL…"
                        className="flex-1 bg-transparent text-[11px] font-bold text-slate-700 outline-none placeholder:text-slate-400"
                    />
                </div>
            </div>
            <div className={`flex-1 overflow-y-auto custom-scrollbar space-y-1 px-1 ${compact ? 'max-h-[260px]' : 'max-h-[min(46vh,420px)]'}`}>
                {loading && (
                    <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-slate-400"/></div>
                )}
                {!loading && error && (
                    <div role="alert" className="flex items-start gap-2 text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                        <AlertTriangle size={12} className="shrink-0 mt-0.5"/>
                        <span className="flex-1">{error}</span>
                        <button
                            type="button"
                            onClick={() => setIntento(n => n + 1)}
                            className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-white px-2 py-0.5 text-[10px] font-bold text-rose-700 hover:bg-rose-100"
                        >
                            <RotateCcw size={10}/>
                            Reintentar
                        </button>
                    </div>
                )}
                {!loading && !error && filtered.length === 0 && (
                    <p className="text-center text-[11px] text-slate-400 py-8">
                        {rows.length === 0 ? 'No hay eventuales disponibles habilitados para esta empresa.' : 'Sin coincidencias.'}
                    </p>
                )}
                {!loading && (() => {
                    const renderCandidato = (c: CandidatoEventual, sinGrupo = false) => {
                    const vencidos = c.vencimientos.filter(v => v.estado === 'VENCIDO');
                    const prontos = c.vencimientos.filter(v => v.estado === 'PRONTO');
                    // Sin género en la ficha con cupo por género: no cuenta para ningún cupo hasta cargarlo.
                    const elegible = c.elegible && !sinGrupo;
                    return (
                        <button
                            key={c.cuil}
                            type="button"
                            data-eventual-grupo={sinGrupo ? 'SIN_ESPECIFICAR' : (cupo ? (grupoDeGenero(cupo.servicio, c.genero) as string | null) || 'TODOS' : 'TODOS')}
                            disabled={!elegible || !!busy}
                            onClick={() => elegible && onSelect(c)}
                            title={sinGrupo ? 'Sin género en la ficha: completala para convocarlo (cupo por género).' : c.elegible ? `Asignar a ${c.nombre}` : c.motivo || 'No elegible'}
                            className={`w-full text-left rounded-xl border px-3 py-2 transition-colors ${
                                elegible
                                    ? 'bg-white border-indigo-100 hover:border-indigo-300 hover:bg-indigo-50/60'
                                    : 'bg-slate-50 border-slate-200 opacity-80 cursor-not-allowed'
                            }`}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                    {c.elegible
                                        ? <UserCheck size={14} className="text-emerald-600 shrink-0"/>
                                        : <UserX size={14} className="text-rose-500 shrink-0"/>}
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-1 text-[11px] font-black text-slate-800"><span className="truncate">{c.nombre}</span><PuntajeChip sujetoId={c.cuil} /></div>
                                        <div className="text-[9px] font-mono text-slate-400">{c.cuil}{c.employeeId ? ' · legajo en esta empresa' : ''}</div>
                                        {c.horasMes && (
                                          <div data-horas-mes className={`text-[9px] font-black ${c.horasMes.aviso ? 'text-amber-700' : 'text-slate-500'}`}>{c.horasMes.texto}</div>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    {c.distanciaKm != null && (
                                        <span className={`text-[9px] font-bold flex items-center gap-0.5 ${c.distanciaKm <= 15 ? 'text-emerald-700' : c.distanciaKm <= 30 ? 'text-amber-700' : 'text-rose-700'}`}>
                                            <MapPin size={10}/>{c.distanciaKm} km
                                        </span>
                                    )}
                                    {c.confiabilidad != null && (
                                        <span
                                            className={`text-[9px] font-black px-1.5 py-0.5 rounded flex items-center gap-0.5 ${c.confiabilidad >= 80 ? 'bg-emerald-100 text-emerald-800' : c.confiabilidad >= 60 ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'}`}
                                            title="Confiabilidad"
                                        >
                                            <ShieldCheck size={10}/>{c.confiabilidad}%
                                        </span>
                                    )}
                                    <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-violet-100 text-violet-800">Eventual</span>
                                    {c.pruebasSinMarco && <PruebasBadge compact />}
                                </div>
                            </div>
                            {!c.elegible && c.motivo && (
                                <p className="mt-1 text-[9px] font-bold text-rose-700 flex items-start gap-1">
                                    <AlertTriangle size={10} className="shrink-0 mt-0.5"/>{c.motivo}
                                </p>
                            )}
                            {(vencidos.length > 0 || prontos.length > 0 || c.telefono) && (
                                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[8px] font-bold">
                                    {vencidos.map(v => (
                                        <span key={v.tipo} className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-800">{TIPO_LABEL[v.tipo] || v.tipo} vencido {v.fecha}</span>
                                    ))}
                                    {prontos.map(v => (
                                        <span key={v.tipo} className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">{TIPO_LABEL[v.tipo] || v.tipo} vence {v.fecha}</span>
                                    ))}
                                    {c.telefono && <span className="text-slate-400 flex items-center gap-0.5"><Phone size={9}/>{c.telefono}</span>}
                                </div>
                            )}
                        </button>
                    );
                    };
                    if (!cupo) return filtered.map((c) => renderCandidato(c));
                    // Cupo por género: Hombres / Mujeres con su ocupación, y «Sin especificar» aparte (mismo orden del motor).
                    const porGrupo = new Map<string, CandidatoEventual[]>(cupo.grupos.map((g) => [g.grupo, []]));
                    const sinEspecificar: CandidatoEventual[] = [];
                    for (const c of filtered) {
                        const g = grupoDeGenero(cupo.servicio, c.genero) as string | null;
                        const lista = g ? porGrupo.get(g) : null;
                        if (lista) lista.push(c); else sinEspecificar.push(c);
                    }
                    return (
                        <>
                            {cupo.grupos.map((g) => (
                                <div key={g.grupo} className="space-y-1 -mx-1" data-eventuales-grupo={g.grupo}>
                                    <GrupoCandidatosHeader grupo={g} cantidad={(porGrupo.get(g.grupo) || []).length} />
                                    <div className="px-1 space-y-1">
                                        {(porGrupo.get(g.grupo) || []).length === 0 && <p className="text-[10px] text-slate-400 py-1">Sin candidatos en este grupo.</p>}
                                        {(porGrupo.get(g.grupo) || []).map((c) => renderCandidato(c))}
                                    </div>
                                </div>
                            ))}
                            {sinEspecificar.length > 0 && (
                                <div className="space-y-1 -mx-1" data-eventuales-grupo="SIN_ESPECIFICAR">
                                    <SinEspecificarAviso cantidad={sinEspecificar.length} />
                                    <div className="px-1 space-y-1">{sinEspecificar.map((c) => renderCandidato(c, true))}</div>
                                </div>
                            )}
                        </>
                    );
                })()}
            </div>
            <div className="px-1 pt-2 text-[9px] font-bold text-slate-400 shrink-0">
                {loading ? 'Consultando bolsa…' : `${elegibles} de ${rows.length} elegibles · sin superposición ni descanso < 12 h en el grupo`}
            </div>
        </div>
    );
}
