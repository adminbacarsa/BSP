/**
 * Solapa EVENTUALES (bolsa) para los selectores de cobertura:
 * Planificación (licencia / vacante / hueco), Sustituir y Eventos.
 *
 * Lee la callable `listarCandidatosEventuales` (solo disponibles y habilitados para la empresa del objetivo;
 * el cruce 12 h con otras empresas del grupo se muestra como motivo). Escribe nada: el `onSelect`
 * decide (asignar / sustituir) y llama a la callable correspondiente.
 *
 * Con `consulta` (cobertura de licencia) hay dos modos: «Preguntar disponibilidad» (recomendado, se
 * marca a quién y se manda la consulta; un lugar por día) y «Asignar directo» (con confirmación).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { AlertTriangle, Loader2, RotateCcw, Search } from 'lucide-react';
import { functions } from '@/lib/firebase';
import { toast } from 'sonner';
import { mensajeErrorCallable } from '@/lib/eventos/convocatoriaPlan';
import { GrupoCandidatosHeader, SinEspecificarAviso, type GrupoCupoUi } from '@/components/servicios/EventoConvocarResumen';
import { grupoDeGenero } from '@/lib/eventuales/cupoGenero.mjs';
import { ConsultaDisponibilidadEstado } from '@/components/eventuales/ConsultaDisponibilidadEstado';
import {
    BarraPreguntar,
    ConfirmarAsignacion,
    ModoEventualesSelector,
    NoDisponiblesLista,
    TarjetaEventual,
    type CandidatoTarjeta,
} from '@/components/eventuales/EventualesCandidatosUx';
import { ESPERA_DEFAULT_MIN, separarCandidatos, type ModoEventuales } from '@/lib/planificacion/coberturaEventualesUx';

export type JornadaEventual = { fecha: string; horaInicio: string; horaFin: string; horas: number; code?: string };

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
    horasMes?: { usadas: number; tope: number; texto: string; aviso: boolean; margen?: number; cerca?: boolean; alcanzado?: boolean } | null;
};

const MOTIVOS_TOPE = new Set(['TOPE_HORAS', 'TOPE_CERCA']);
/** Igual a `esOcultoPorTope` del motor: no se ofrece, se cuenta en «N eventuales ocultos por tope de horas». */
export const esOcultoPorTopeUi = (c: { motivoCodigo?: string | null }) => MOTIVOS_TOPE.has(String(c.motivoCodigo || ''));
export const textoOcultosPorTopeUi = (n: number) => (n === 1 ? '1 eventual oculto por tope de horas' : `${n} eventuales ocultos por tope de horas`);

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
    /** Consulta de disponibilidad del hueco. Quien planifica (PLANNING update) también la ve, aunque no pueda asignar. */
    consulta?: {
        clientName?: string | null;
        objectiveName?: string | null;
        positionName?: string | null;
    } | null;
};

export function jornadasKey(jornadas: JornadaEventual[]): string {
    return jornadas.map(j => `${j.fecha}|${j.horaInicio}|${j.horaFin}`).join(',');
}

const TIPO_LABEL: Record<string, string> = { credencial: 'Credencial', apto: 'Apto', habilitacion: 'Hab. 9236' };

export default function EventualesCandidatosPanel({
    empresaId, objectiveId, clientId, objetivoGeo, jornadas, excluirTurnoIds, excluirCuil, canConvocar, busy, onSelect, compact, cupo, consulta,
}: Props) {
    const [rows, setRows] = useState<CandidatoEventual[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    /** Sube con «Reintentar» para volver a pedir la bolsa con los mismos parámetros. */
    const [intento, setIntento] = useState(0);
    /** «Ver» los ocultos por tope: solo lectura, no se pueden elegir. */
    const [verOcultosTope, setVerOcultosTope] = useState(false);
    const [marcados, setMarcados] = useState<string[]>([]);
    const [venceMinutos, setVenceMinutos] = useState(ESPERA_DEFAULT_MIN);
    const [enviando, setEnviando] = useState(false);
    /** Sin consulta (eventos, sustituir) solo existe asignar; con consulta arranca en preguntar. */
    const [modo, setModo] = useState<ModoEventuales>(consulta ? 'preguntar' : 'asignar');
    const [confirmando, setConfirmando] = useState<CandidatoEventual | null>(null);
    const key = jornadasKey(jornadas);
    const veLista = canConvocar || !!consulta;
    const puedePreguntar = !!consulta;
    const modoEfectivo: ModoEventuales = !puedePreguntar ? 'asignar' : !canConvocar ? 'preguntar' : modo;

    useEffect(() => {
        if (!veLista || !empresaId || jornadas.length === 0) { setRows([]); return; }
        let alive = true;
        setLoading(true);
        setError(null);
        setConfirmando(null);
        const call = httpsCallable<Record<string, unknown>, { candidatos: CandidatoEventual[] }>(functions, 'listarCandidatosEventuales');
        call({ empresaId, objectiveId: objectiveId || null, clientId: clientId || null, objetivoGeo: objetivoGeo || null, jornadas, excluirTurnoIds: excluirTurnoIds || [] })
            .then(res => { if (alive) setRows((res.data?.candidatos || []).filter(c => c.cuil !== excluirCuil)); })
            .catch((e: unknown) => { if (alive) setError(mensajeErrorCallable(e, 'No se pudo cargar la bolsa de eventuales.')); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [empresaId, objectiveId, key, veLista, excluirCuil, (excluirTurnoIds || []).join(','), intento]);

    const filtered = useMemo(() => {
        const s = search.trim().toLowerCase();
        return s ? rows.filter(r => `${r.nombre} ${r.cuil}`.toLowerCase().includes(s)) : rows;
    }, [rows, search]);
    const partes = useMemo(() => separarCandidatos(filtered), [filtered]);
    const ocultosTope = useMemo(() => rows.filter(esOcultoPorTopeUi), [rows]);

    if (!veLista) {
        return (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-4 text-[11px] font-bold text-slate-500 text-center">
                Necesitás el permiso <span className="font-black">EVENTUALES · Convocar</span> o <span className="font-black">Planificación · Actualizar</span>.
            </div>
        );
    }

    const toggleMarcado = (cuil: string) => {
        setMarcados((prev) => (prev.includes(cuil) ? prev.filter((c) => c !== cuil) : [...prev, cuil]));
    };

    const enviarConsulta = async () => {
        if (!consulta || marcados.length === 0 || enviando) return;
        setEnviando(true);
        try {
            const call = httpsCallable<Record<string, unknown>, { resumen?: string; omitidos?: { motivo: string }[] }>(functions, 'crearConsultaDisponibilidad');
            // Cobertura de licencia: siempre un lugar por día. El primero que acepte cubre.
            const res = await call({
                empresaId, objectiveId: objectiveId || null, clientId: clientId || null, objetivoGeo: objetivoGeo || null,
                clientName: consulta.clientName || null, objectiveName: consulta.objectiveName || null, positionName: consulta.positionName || null,
                jornadas, cuils: marcados, lugares: 1, venceMinutos,
            });
            const omitidos = res.data?.omitidos?.length || 0;
            toast.success(res.data?.resumen || 'Consulta enviada.');
            if (omitidos) toast.message(`${omitidos} no se consultaron porque ya no estaban elegibles.`);
            setMarcados([]);
        } catch (e) {
            toast.error(mensajeErrorCallable(e, 'No se pudo enviar la consulta.'));
        } finally {
            setEnviando(false);
        }
    };

    const tarjetaDe = (c: CandidatoEventual): CandidatoTarjeta => {
        const prontos = c.vencimientos.filter(v => v.estado === 'PRONTO').map(v => `${TIPO_LABEL[v.tipo] || v.tipo} vence ${v.fecha}`);
        const avisos = [...prontos, ...(c.alertas || [])];
        return {
            cuil: c.cuil,
            nombre: c.nombre,
            telefono: c.telefono,
            elegible: c.elegible,
            motivo: c.motivo,
            motivoCodigo: c.motivoCodigo,
            distanciaKm: c.distanciaKm,
            pruebasSinMarco: c.pruebasSinMarco,
            horasMes: c.horasMes ? { texto: avisos.length ? `${c.horasMes.texto} · ${avisos.join(' · ')}` : c.horasMes.texto, aviso: c.horasMes.aviso } : (avisos.length ? { texto: avisos.join(' · '), aviso: false } : null),
        };
    };

    const elegirDirecto = (c: CandidatoEventual) => {
        if (!canConvocar || busy) return;
        if (puedePreguntar) { setConfirmando(c); return; }
        onSelect(c);
    };

    const renderElegibles = (lista: CandidatoEventual[]) => lista.map((c) => (
        <TarjetaEventual
            key={c.cuil}
            c={tarjetaDe(c)}
            modo={modoEfectivo}
            marcado={marcados.includes(c.cuil)}
            disabled={!!busy || (modoEfectivo === 'asignar' && !canConvocar)}
            onToggle={() => toggleMarcado(c.cuil)}
            onAsignar={() => elegirDirecto(c)}
        />
    ));

    const elegibles = rows.filter(r => r.elegible && !esOcultoPorTopeUi(r)).length;

    return (
        <div className="flex flex-col min-h-0">
            {puedePreguntar && canConvocar && <ModoEventualesSelector modo={modoEfectivo} onModo={(m) => { setModo(m); setConfirmando(null); }} />}
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
                        {rows.length === 0 ? 'No hay eventuales disponibles habilitados para esta empresa.' : ocultosTope.length === rows.length && !search.trim() ? 'Todos los eventuales están cerca del tope de horas.' : 'Sin coincidencias.'}
                    </p>
                )}
                {!loading && !error && filtered.length > 0 && !cupo && (
                    <>
                        {partes.elegibles.length === 0 && (
                            <p className="px-1 py-2 text-[10px] font-bold text-slate-500" data-sin-elegibles>Nadie de la bolsa puede tomar este turno. Abajo está el motivo de cada uno.</p>
                        )}
                        {renderElegibles(partes.elegibles)}
                        <NoDisponiblesLista rows={partes.noDisponibles.map(tarjetaDe)} />
                    </>
                )}
                {!loading && !error && filtered.length > 0 && cupo && (() => {
                    // Cupo por género: Hombres / Mujeres con su ocupación, y «Sin especificar» aparte (mismo orden del motor).
                    const porGrupo = new Map<string, CandidatoEventual[]>(cupo.grupos.map((g) => [g.grupo, []]));
                    const sinEspecificar: CandidatoEventual[] = [];
                    for (const c of filtered) {
                        if (esOcultoPorTopeUi(c)) continue;
                        const g = grupoDeGenero(cupo.servicio, c.genero) as string | null;
                        const lista = g ? porGrupo.get(g) : null;
                        if (lista) lista.push(c); else sinEspecificar.push(c);
                    }
                    return (
                        <>
                            {cupo.grupos.map((g) => {
                                const del = separarCandidatos(porGrupo.get(g.grupo) || []);
                                return (
                                    <div key={g.grupo} className="space-y-1 -mx-1" data-eventuales-grupo={g.grupo}>
                                        <GrupoCandidatosHeader grupo={g} cantidad={(porGrupo.get(g.grupo) || []).length} />
                                        <div className="px-1 space-y-1">
                                            {(porGrupo.get(g.grupo) || []).length === 0 && <p className="text-[10px] text-slate-400 py-1">Sin candidatos en este grupo.</p>}
                                            {renderElegibles(del.elegibles)}
                                            <NoDisponiblesLista rows={del.noDisponibles.map(tarjetaDe)} />
                                        </div>
                                    </div>
                                );
                            })}
                            {sinEspecificar.length > 0 && (
                                <div className="space-y-1 -mx-1" data-eventuales-grupo="SIN_ESPECIFICAR">
                                    <SinEspecificarAviso cantidad={sinEspecificar.length} />
                                    <div className="px-1">
                                        <NoDisponiblesLista rows={sinEspecificar.map((c) => ({ ...tarjetaDe(c), elegible: false, motivo: 'Sin género en la ficha: completala para convocarlo (cupo por género).', motivoCodigo: 'GENERO_SIN_ESPECIFICAR' }))} />
                                    </div>
                                </div>
                            )}
                        </>
                    );
                })()}
                {!loading && verOcultosTope && ocultosTope.length > 0 && (
                    <div className="mt-1 space-y-1" data-ocultos-tope-lista>
                        {ocultosTope.map((c) => (
                            <div key={c.cuil} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 opacity-80">
                                <span className="min-w-0">
                                    <span className="block truncate text-[10px] font-bold text-slate-700">{c.nombre}</span>
                                    {c.horasMes && <span data-horas-mes className="block text-[9px] font-bold text-amber-700">{c.horasMes.texto}</span>}
                                </span>
                                {c.horasMes && <span data-chip-tope={c.horasMes.alcanzado ? 'alcanzado' : 'cerca'} className={`shrink-0 rounded px-1 text-[9px] font-black ${c.horasMes.alcanzado ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}`}>{c.horasMes.alcanzado ? 'Tope alcanzado' : 'Cerca del tope'}</span>}
                            </div>
                        ))}
                    </div>
                )}
            </div>
            {!loading && ocultosTope.length > 0 && (
                <div data-ocultos-tope={ocultosTope.length} className="mx-1 mt-2 flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] font-bold text-amber-800 shrink-0">
                    <span>{textoOcultosPorTopeUi(ocultosTope.length)}</span>
                    <button type="button" onClick={() => setVerOcultosTope((v) => !v)} data-ocultos-tope-ver className="rounded-md border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-black text-amber-800 hover:bg-amber-100">
                        {verOcultosTope ? 'Ocultar' : 'Ver'}
                    </button>
                </div>
            )}
            <div className="px-1 pt-2 text-[9px] font-bold text-slate-400 shrink-0">
                {loading ? 'Consultando bolsa…' : `${elegibles} de ${rows.length} pueden tomar el turno · sin superposición ni descanso < 12 h en el grupo`}
            </div>
            {puedePreguntar && modoEfectivo === 'preguntar' && !loading && !error && (
                <BarraPreguntar
                    n={marcados.length}
                    jornadas={jornadas}
                    espera={venceMinutos}
                    onEspera={setVenceMinutos}
                    onEnviar={() => { void enviarConsulta(); }}
                    enviando={enviando}
                />
            )}
            {confirmando && modoEfectivo === 'asignar' && (
                <ConfirmarAsignacion
                    nombre={confirmando.nombre}
                    busy={busy}
                    onConfirmar={() => { const c = confirmando; setConfirmando(null); onSelect(c); }}
                    onCancelar={() => setConfirmando(null)}
                />
            )}
            {consulta && (
                <ConsultaDisponibilidadEstado empresaId={empresaId} objectiveId={objectiveId} positionName={consulta.positionName} jornadas={jornadas} />
            )}
        </div>
    );
}
