'use client';

import React from 'react';
import { X, LayoutGrid, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { ServiceSLA } from '@/services/slaService';
import { analyzeShiftSchemesForService, type SchemeFit, type RotationSchemeId } from '@/lib/servicios/shiftSchemeAdvisor';

export interface ServiceShiftSchemeModalProps {
    open: boolean;
    onClose: () => void;
    service: (ServiceSLA & { id: string }) | null;
}

const fitTone: Record<SchemeFit, { bar: string; text: string }> = {
    alta: { bar: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300' },
    media: { bar: 'bg-amber-500', text: 'text-amber-800 dark:text-amber-200' },
    baja: { bar: 'bg-slate-400', text: 'text-slate-600 dark:text-slate-400' },
};

function schemeBadge(id: RotationSchemeId): string {
    if (id === '6x2') return '6×2';
    if (id === '6x1') return '6×1';
    return '4×2';
}

export function ServiceShiftSchemeModal({ open, onClose, service }: ServiceShiftSchemeModalProps) {
    if (!open || !service) return null;

    const advice = analyzeShiftSchemesForService(service);

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
            <div
                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="sticky top-0 flex items-start justify-between gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-indigo-50/90 dark:bg-slate-900 z-10">
                    <div className="min-w-0 flex items-start gap-2">
                        <div className="p-2 rounded-xl bg-indigo-600 text-white shrink-0">
                            <LayoutGrid size={18} />
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-sm font-black text-indigo-950 dark:text-indigo-100 uppercase tracking-wide">
                                Turnos y esquema de rotación
                            </h2>
                            <p className="text-[11px] font-bold text-slate-600 dark:text-slate-400 truncate">
                                {service.clientName || 'Cliente'} — {service.objectiveName || 'Objetivo'}
                            </p>
                            <p className="text-[10px] text-slate-500 font-bold mt-0.5">
                                Contrato {service.startDate} → {service.endDate}
                            </p>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-white/80 dark:hover:bg-slate-800 text-slate-500 shrink-0">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-4 space-y-4 text-[11px]">
                    <p className="font-bold text-slate-600 dark:text-slate-400 leading-snug">
                        Vista <strong>sólo operativa</strong>: si la mezcla de coberturas (hs/día, 24 h, custom, etc.) encaja mejor con{' '}
                        <strong>6×2</strong>, <strong>6×1</strong> o <strong>4×2</strong>. No incluye costos ni precios.
                    </p>

                    <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20 px-3 py-2.5">
                        <p className="text-[9px] font-black uppercase text-indigo-600 dark:text-indigo-300 mb-1">Sugerencia principal</p>
                        <p className="text-lg font-black text-indigo-800 dark:text-indigo-100">{schemeBadge(advice.primaryScheme)}</p>
                        <p className="text-[11px] font-bold text-slate-700 dark:text-slate-300 mt-1 leading-snug">{advice.primaryReason}</p>
                    </div>

                    <div>
                        <p className="text-[9px] font-black uppercase text-slate-500 mb-1.5">Puestos declarados</p>
                        <ul className="space-y-1 font-bold text-slate-700 dark:text-slate-200">
                            {advice.positionSummaries.length === 0 ? (
                                <li className="text-slate-400">—</li>
                            ) : (
                                advice.positionSummaries.map((line, i) => (
                                    <li key={i} className="flex gap-2">
                                        <span className="text-indigo-500 shrink-0">·</span>
                                        <span>{line}</span>
                                    </li>
                                ))
                            )}
                        </ul>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1.5">
                            <p className="text-[9px] font-black uppercase text-slate-500">Pico hs/día</p>
                            <p className="text-base font-black tabular-nums text-slate-800 dark:text-white">{advice.peakDailyCoverageHs} hs</p>
                        </div>
                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1.5">
                            <p className="text-[9px] font-black uppercase text-slate-500">Prom. L–V</p>
                            <p className="text-base font-black tabular-nums text-slate-800 dark:text-white">{advice.avgWeekdayCoverageHs} hs</p>
                        </div>
                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1.5 col-span-2">
                            <p className="text-[9px] font-black uppercase text-slate-500">Pax en paralelo (pico)</p>
                            <p className="text-base font-black tabular-nums text-slate-800 dark:text-white">{advice.peakConcurrentPax}</p>
                        </div>
                    </div>

                    {advice.issues.length > 0 && (
                        <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/80 dark:bg-amber-950/30 px-3 py-2">
                            <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-200 font-black text-[10px] uppercase mb-1">
                                <AlertTriangle size={14} /> Compatibilidad
                            </div>
                            <ul className="list-disc list-inside space-y-1 font-bold text-amber-900 dark:text-amber-100 text-[10px]">
                                {advice.issues.map((t, i) => (
                                    <li key={i}>{t}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div>
                        <p className="text-[9px] font-black uppercase text-slate-500 mb-2">Por esquema</p>
                        <div className="space-y-2">
                            {advice.schemes.map((s) => {
                                const t = fitTone[s.fit];
                                return (
                                    <div
                                        key={s.id}
                                        className={`rounded-lg border px-2.5 py-2 flex gap-2 ${
                                            advice.primaryScheme === s.id
                                                ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50/40 dark:bg-indigo-950/30'
                                                : 'border-slate-200 dark:border-slate-700'
                                        }`}
                                    >
                                        <div className={`w-1 rounded-full shrink-0 ${t.bar}`} />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className="font-black text-slate-800 dark:text-slate-100">{schemeBadge(s.id)}</span>
                                                <span className={`text-[9px] font-black uppercase ${t.text}`}>
                                                    {s.fit === 'alta' ? 'Encaje' : s.fit === 'media' ? 'Posible' : 'Menos natural'}
                                                </span>
                                                {advice.primaryScheme === s.id && (
                                                    <CheckCircle2 size={12} className="text-indigo-600 shrink-0" aria-hidden />
                                                )}
                                            </div>
                                            <p className="text-[10px] font-bold text-slate-600 dark:text-slate-400 mt-0.5 leading-snug">{s.note}</p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <p className="text-[9px] font-bold text-slate-500 leading-snug">
                        La planificación fina (descansos legales, solapes horarios entre bloques custom y asignación por guardia) sigue en{' '}
                        <strong>Planificación</strong>. Esto orienta sólo el <strong>marco de rotación</strong> frente a la SLA modelada.
                    </p>
                </div>
            </div>
        </div>
    );
}
