import React, { useMemo, useState } from 'react';
import { MapPin, X } from 'lucide-react';

export type ObjetivoOpcion = { id: string; clientId: string; clientName: string; name: string };
export type FranjaOpcion = { positionName: string; code: string; startTime: string; endTime: string; hours: number };

export function AsignarOtroObjetivoModal({
    nombre,
    fecha,
    objetivos,
    franjas,
    cargando,
    onElegirObjetivo,
    onCerrar,
    onConfirmar,
}: {
    nombre: string;
    fecha: string;
    objetivos: ObjetivoOpcion[];
    franjas: FranjaOpcion[];
    cargando?: boolean;
    onElegirObjetivo: (id: string) => void;
    onCerrar: () => void;
    onConfirmar: (sel: { objetivo: ObjetivoOpcion; franja: FranjaOpcion }) => void;
}) {
    const [q, setQ] = useState('');
    const [objId, setObjId] = useState('');
    const [franjaKey, setFranjaKey] = useState('');
    const lista = useMemo(() => {
        const n = q.trim().toLowerCase();
        const base = objetivos.filter((o) => !n || `${o.clientName} ${o.name}`.toLowerCase().includes(n));
        return base.slice(0, 40);
    }, [objetivos, q]);
    const objetivo = objetivos.find((o) => o.id === objId) || null;
    const franja = franjas.find((f) => `${f.positionName}|${f.code}|${f.startTime}` === franjaKey) || null;
    return (
        <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-slate-900/50 p-4" onClick={onCerrar} data-otro-objetivo="modal">
            <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
                <div className="mb-3 flex items-center gap-2">
                    <MapPin size={16} className="text-indigo-600" />
                    <h3 className="text-sm font-black uppercase text-slate-800">Asignar en otro objetivo</h3>
                    <button type="button" onClick={onCerrar} className="ml-auto rounded-lg p-1 text-slate-400 hover:bg-slate-50" aria-label="Cerrar"><X size={14} /></button>
                </div>
                <p className="mb-3 text-[12px] text-slate-600">{nombre} · {fecha}. El turno se escribe en el cronograma del objetivo elegido.</p>
                <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Buscar cliente · objetivo"
                    className="mb-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    data-otro-objetivo-buscar
                    autoFocus
                />
                <div className="mb-3 max-h-40 overflow-auto rounded-2xl border border-slate-200">
                    {lista.map((o) => (
                        <button
                            key={o.id}
                            type="button"
                            data-otro-objetivo-opcion={o.id}
                            onClick={() => { setObjId(o.id); setFranjaKey(''); onElegirObjetivo(o.id); }}
                            className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${objId === o.id ? 'bg-indigo-50 font-black text-indigo-900' : 'text-slate-700'}`}
                        >
                            {o.clientName} · {o.name}
                        </button>
                    ))}
                    {!lista.length && <p className="px-3 py-2 text-[12px] text-slate-400">Sin objetivos</p>}
                </div>
                <label className="mb-1 block text-[11px] font-black uppercase text-slate-500">Puesto y franja</label>
                <select
                    value={franjaKey}
                    onChange={(e) => setFranjaKey(e.target.value)}
                    disabled={!objetivo || cargando}
                    className="mb-4 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"
                    data-otro-objetivo-franja
                >
                    <option value="">{cargando ? 'Cargando servicio…' : 'Elegí el turno del servicio'}</option>
                    {franjas.map((f) => {
                        const key = `${f.positionName}|${f.code}|${f.startTime}`;
                        return <option key={key} value={key}>{f.positionName} · {f.code} {f.startTime}–{f.endTime}</option>;
                    })}
                </select>
                <div className="flex justify-end gap-2">
                    <button type="button" onClick={onCerrar} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">Cancelar</button>
                    <button
                        type="button"
                        disabled={!objetivo || !franja}
                        data-otro-objetivo-confirmar
                        onClick={() => objetivo && franja && onConfirmar({ objetivo, franja })}
                        className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-black text-white shadow-sm hover:bg-indigo-700 disabled:border disabled:border-slate-200 disabled:bg-white disabled:text-slate-400"
                    >
                        Asignar
                    </button>
                </div>
            </div>
        </div>
    );
}
