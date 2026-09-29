import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { subscribeLedgerProgress, type LedgerProgress } from '@/lib/hoursLedger/hoursLedgerRead';

function when(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Barra fija mientras un recálculo del libro corre en segundo plano. */
export default function HoursLedgerJobBar() {
  const router = useRouter();
  const [job, setJob] = useState<LedgerProgress | null>(null);
  useEffect(() => subscribeLedgerProgress(setJob), []);
  if (!job || router.pathname.includes('banco-horas')) return null;
  const running = job.status === 'QUEUED' || job.status === 'RUNNING';
  if (!running && job.status !== 'ERROR') return null;
  return (
    <div className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-[80] w-[min(560px,calc(100%-1.5rem))] rounded-2xl bg-white shadow-lg border border-slate-200 px-4 py-3">
      <div className="flex items-center justify-between gap-3 text-xs font-black text-slate-600">
        <span>{running ? 'Calculando…' : 'Recálculo con errores'}</span>
        <span className="tabular-nums">{job.total ? `${job.processed} / ${job.total}` : job.pct + '%'}</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full bg-indigo-500 transition-all" style={{ width: `${job.pct}%` }} />
      </div>
      <p className="mt-1 text-[11px] font-bold text-slate-400 truncate">
        {job.currentObjectiveName || (job.error ? job.error : '')}
        {job.createdBy ? ` · ${job.createdBy}` : ''}
        {job.finishedAt ? ` · ${when(job.finishedAt)}` : ''}
      </p>
    </div>
  );
}
