import React from 'react';
import { MapPin, GraduationCap, Info } from 'lucide-react';
import {
    ESCUELA_TURNOS_PARA_CONOCIDO,
} from '@/lib/planificacion/deploymentRoles';
import {
    ExperienciaNivel,
    ExperienciaObjetivosMap,
    experienciaNivelLabel,
    listExperienciaForDisplay,
} from '@/lib/planificacion/experienciaObjetivos';

type Props = {
    experienciaObjetivos?: ExperienciaObjetivosMap;
    preferredObjectiveId?: string | null;
    allObjectives: Array<{ id: string; name: string }>;
};

const nivelStyles: Record<ExperienciaNivel, string> = {
    TITULAR: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800',
    CONOCIDO: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-800',
    ESCUELA: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-900/30 dark:text-sky-200 dark:border-sky-800',
    NINGUNO: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600',
};

const nivelIcon: Record<ExperienciaNivel, string> = {
    TITULAR: '★',
    CONOCIDO: '◆',
    ESCUELA: '◇',
    NINGUNO: '—',
};

export default function ExperienciaObjetivosPanel({
    experienciaObjetivos,
    preferredObjectiveId,
    allObjectives,
}: Props) {
    const rows = listExperienciaForDisplay(experienciaObjetivos, preferredObjectiveId, allObjectives);

    return (
        <div className="space-y-6">
            <div className="flex items-start gap-3 p-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 rounded-xl">
                <Info size={18} className="text-indigo-500 shrink-0 mt-0.5" />
                <div className="text-[11px] text-indigo-800 dark:text-indigo-200 leading-relaxed">
                    <p className="font-black uppercase mb-1">Historial por objetivo</p>
                    <p>
                        Se actualiza automáticamente al guardar turnos en <strong>Planificación</strong>
                        {' '}(ESC escuela, REF refuerzo, coberturas y turnos regulares).
                        Tras <strong>{ESCUELA_TURNOS_PARA_CONOCIDO} turnos ESC</strong> en un objetivo, el guardia pasa a <strong>Conocido</strong>.
                    </p>
                </div>
            </div>

            {rows.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
                    <GraduationCap size={32} className="mx-auto text-slate-300 mb-3" />
                    <p className="text-sm font-black uppercase text-slate-500">Sin experiencia registrada</p>
                    <p className="text-[11px] text-slate-400 mt-1 max-w-md mx-auto">
                        Cuando asigne turnos ESC o coberturas en el planificador, aparecerán aquí los objetivos donde se formó o trabajó.
                    </p>
                </div>
            ) : (
                <div className="overflow-x-auto rounded-xl border dark:border-slate-700">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 dark:bg-slate-900">
                            <tr>
                                <th className="p-3 text-[10px] font-black uppercase text-slate-400">Objetivo</th>
                                <th className="p-3 text-[10px] font-black uppercase text-slate-400">Nivel</th>
                                <th className="p-3 text-[10px] font-black uppercase text-slate-400 text-center">Escuela</th>
                                <th className="p-3 text-[10px] font-black uppercase text-slate-400 text-center">Regulares</th>
                                <th className="p-3 text-[10px] font-black uppercase text-slate-400 text-center">Refuerzo</th>
                                <th className="p-3 text-[10px] font-black uppercase text-slate-400 text-center">Convocado</th>
                                <th className="p-3 text-[10px] font-black uppercase text-slate-400">Puestos</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                            {rows.map(row => {
                                const esc = row.entry.turnosEscuela ?? 0;
                                const escProgress = row.nivel === 'ESCUELA'
                                    ? `${esc}/${ESCUELA_TURNOS_PARA_CONOCIDO}`
                                    : String(esc);
                                return (
                                    <tr key={row.objectiveId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                        <td className="p-3">
                                            <div className="flex items-center gap-2">
                                                <MapPin size={14} className="text-slate-400 shrink-0" />
                                                <span className="font-black uppercase text-slate-800 dark:text-white text-xs">{row.objectiveName}</span>
                                            </div>
                                        </td>
                                        <td className="p-3">
                                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase border ${nivelStyles[row.nivel]}`}>
                                                {nivelIcon[row.nivel]} {experienciaNivelLabel(row.nivel)}
                                            </span>
                                        </td>
                                        <td className="p-3 text-center font-mono text-xs font-bold text-slate-600 dark:text-slate-300">{escProgress}</td>
                                        <td className="p-3 text-center font-mono text-xs text-slate-500">{row.entry.turnosRegulares ?? 0}</td>
                                        <td className="p-3 text-center font-mono text-xs text-slate-500">{row.entry.turnosRefuerzo ?? 0}</td>
                                        <td className="p-3 text-center font-mono text-xs text-slate-500">{row.entry.turnosConvocado ?? 0}</td>
                                        <td className="p-3 text-xs text-slate-500 max-w-[180px]">
                                            {(row.entry.posicionesConocidas?.length ?? 0) > 0
                                                ? row.entry.posicionesConocidas!.join(', ')
                                                : '—'}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
