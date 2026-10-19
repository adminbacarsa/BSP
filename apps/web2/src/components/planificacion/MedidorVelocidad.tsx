import React, { useEffect, useState } from 'react';
import type { MedicionCommit } from '@/lib/planificacion/perfGrilla';

type Resumen = { redibujos: number; ultimo: number; max: number; total: number; trabas: number; trabaMax: number; trabaTotal: number };

const vacio: Resumen = { redibujos: 0, ultimo: 0, max: 0, total: 0, trabas: 0, trabaMax: 0, trabaTotal: 0 };

/** Con «?medir=1» en la dirección: cuenta los redibujos de la página y las trabas del navegador (tareas de más de 50 ms). */
export function MedidorVelocidad() {
    const [activo, setActivo] = useState(false);
    const [r, setR] = useState<Resumen>(vacio);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!new URLSearchParams(window.location.search).has('medir')) return;
        setActivo(true);
        const w = window as unknown as { __planifPerf?: MedicionCommit[] };
        w.__planifPerf = [];
        const trabas: number[] = [];
        let obs: PerformanceObserver | null = null;
        try {
            obs = new PerformanceObserver((lista) => { for (const e of lista.getEntries()) trabas.push(e.duration); });
            obs.observe({ entryTypes: ['longtask'] });
        } catch { /* navegador sin longtask */ }
        const t = window.setInterval(() => {
            const m = w.__planifPerf || [];
            setR({
                redibujos: m.length,
                ultimo: m.length ? m[m.length - 1].ms : 0,
                max: m.reduce((a, x) => Math.max(a, x.ms), 0),
                total: m.reduce((a, x) => a + x.ms, 0),
                trabas: trabas.length,
                trabaMax: trabas.reduce((a, x) => Math.max(a, x), 0),
                trabaTotal: trabas.reduce((a, x) => a + x, 0),
            });
        }, 500);
        (window as unknown as { __reiniciarMedir?: () => void }).__reiniciarMedir = () => { w.__planifPerf = []; trabas.length = 0; };
        return () => { window.clearInterval(t); obs?.disconnect(); };
    }, []);

    if (!activo) return null;
    const ms = (n: number) => `${Math.round(n)} ms`;
    const texto = `Redibujos ${r.redibujos} · último ${ms(r.ultimo)} · máx ${ms(r.max)} · total ${ms(r.total)} | Trabas ${r.trabas} · máx ${ms(r.trabaMax)} · total ${ms(r.trabaTotal)}`;
    return (
        <div className="fixed bottom-3 left-1/2 z-[13000] -translate-x-1/2 rounded-xl bg-slate-900/90 px-3 py-2 text-[11px] font-bold text-white shadow-lg flex items-center gap-3" data-medidor-velocidad>
            <span>{texto}</span>
            <button type="button" className="rounded bg-white/20 px-2 py-0.5 hover:bg-white/30" onClick={() => (window as unknown as { __reiniciarMedir?: () => void }).__reiniciarMedir?.()}>Reiniciar</button>
            <button type="button" className="rounded bg-white/20 px-2 py-0.5 hover:bg-white/30" onClick={() => { void navigator.clipboard?.writeText(texto); }}>Copiar</button>
        </div>
    );
}
