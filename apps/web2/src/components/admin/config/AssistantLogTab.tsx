import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useEmpresa } from '@/context/EmpresaContext';
import { useAuth } from '@/context/AuthContext';
import { Bot, Download, AlertCircle, CheckCircle2, HelpCircle } from 'lucide-react';

type LogOutcome = 'answered' | 'unsatisfied' | 'error';

export type AssistantLogRow = {
  id: string;
  empresaId: string;
  uid: string;
  userEmail: string | null;
  question: string;
  reply: string | null;
  moduleKey: string | null;
  pathname: string | null;
  outcome: LogOutcome;
  needsReview: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: Date | null;
};

type FilterMode = 'review' | 'all' | 'errors';

const fmtDate = (d: Date | null) => {
  if (!d) return '—';
  try {
    return d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
};

const outcomeLabel: Record<LogOutcome, string> = {
  answered: 'Respondida',
  unsatisfied: 'Sin resolver',
  error: 'Error',
};

function outcomeBadge(outcome: LogOutcome) {
  if (outcome === 'answered') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
        <CheckCircle2 className="h-3 w-3" />
        {outcomeLabel[outcome]}
      </span>
    );
  }
  if (outcome === 'error') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-800 dark:bg-red-950/50 dark:text-red-300">
        <AlertCircle className="h-3 w-3" />
        {outcomeLabel[outcome]}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
      <HelpCircle className="h-3 w-3" />
      {outcomeLabel[outcome]}
    </span>
  );
}

function csvEscape(s: string): string {
  const t = String(s ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ');
  return `"${t}"`;
}

function downloadCsv(rows: AssistantLogRow[], empresaId: string) {
  const header = [
    'fecha',
    'estado',
    'usuario',
    'modulo',
    'pregunta',
    'respuesta',
    'ruta',
    'error_codigo',
    'error_mensaje',
    'duracion_ms',
  ];
  const lines = [
    header.join(','),
    ...rows.map((r) =>
      [
        fmtDate(r.createdAt),
        r.outcome,
        r.userEmail || r.uid,
        r.moduleKey || '',
        csvEscape(r.question),
        csvEscape(r.reply || ''),
        csvEscape(r.pathname || ''),
        r.errorCode || '',
        csvEscape(r.errorMessage || ''),
        r.durationMs != null ? String(r.durationMs) : '',
      ].join(','),
    ),
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `asistente-ia-log-${empresaId}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AssistantLogTab() {
  const { empresaId, empresa } = useEmpresa();
  const { canReadModule } = useAuth();
  const [rows, setRows] = useState<AssistantLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterMode>('review');
  const [loadError, setLoadError] = useState<string | null>(null);

  const effectiveEmpresaId = (empresaId || 'bacarsa').trim();

  useEffect(() => {
    if (!canReadModule('CONFIG')) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);

    const base = collection(db, 'assistant_interaction_logs');
    const q =
      filter === 'review'
        ? query(
            base,
            where('empresaId', '==', effectiveEmpresaId),
            where('needsReview', '==', true),
            orderBy('createdAt', 'desc'),
            limit(250),
          )
        : query(
            base,
            where('empresaId', '==', effectiveEmpresaId),
            orderBy('createdAt', 'desc'),
            limit(300),
          );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: AssistantLogRow[] = snap.docs.map((d) => {
          const data = d.data();
          let createdAt: Date | null = null;
          const ca = data.createdAt;
          if (ca instanceof Timestamp) createdAt = ca.toDate();
          else if (ca?.toDate) createdAt = ca.toDate();
          return {
            id: d.id,
            empresaId: String(data.empresaId ?? ''),
            uid: String(data.uid ?? ''),
            userEmail: data.userEmail ? String(data.userEmail) : null,
            question: String(data.question ?? ''),
            reply: data.reply != null ? String(data.reply) : null,
            moduleKey: data.moduleKey ? String(data.moduleKey) : null,
            pathname: data.pathname ? String(data.pathname) : null,
            outcome: (data.outcome as LogOutcome) || 'unsatisfied',
            needsReview: data.needsReview === true,
            errorCode: data.errorCode ? String(data.errorCode) : null,
            errorMessage: data.errorMessage ? String(data.errorMessage) : null,
            durationMs: typeof data.durationMs === 'number' ? data.durationMs : null,
            createdAt,
          };
        });
        setRows(filter === 'errors' ? list.filter((r) => r.outcome === 'error') : list);
        setLoading(false);
      },
      (err) => {
        console.error('[AssistantLogTab]', err);
        setLoadError(
          err?.message?.includes('index')
            ? 'Falta el índice de Firestore. Desplegá firestore.indexes.json o creá el índice desde el enlace en consola.'
            : err?.message || 'No se pudo cargar el log.',
        );
        setLoading(false);
      },
    );

    return () => unsub();
  }, [canReadModule, effectiveEmpresaId, filter]);

  const reviewInView = useMemo(() => rows.filter((r) => r.needsReview).length, [rows]);

  if (!canReadModule('CONFIG')) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
        Necesitás permiso de lectura en <strong>Configuración</strong> para ver el log del asistente.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
              <Bot className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">AI Asistente — Log de consultas</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
                Preguntas al globo del asistente. Las marcadas como <strong>sin resolver</strong> o <strong>error</strong>{' '}
                sirven para crear nuevas consultas Firestore y mejorar respuestas. Empresa activa:{' '}
                <strong>{empresa?.name || effectiveEmpresaId}</strong>.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={rows.length === 0}
            onClick={() => downloadCsv(rows, effectiveEmpresaId)}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow hover:bg-indigo-700 disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
            Descargar CSV
          </button>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {(
            [
              { id: 'review' as const, label: `Sin resolver (${reviewInView})` },
              { id: 'errors' as const, label: 'Solo errores' },
              { id: 'all' as const, label: 'Todas' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-bold transition ${
                filter === tab.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loadError && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {loadError}
          </div>
        )}

        {loading ? (
          <p className="mt-8 text-center text-sm font-medium text-slate-500">Cargando log…</p>
        ) : rows.length === 0 ? (
          <p className="mt-8 text-center text-sm text-slate-500">
            {filter === 'review'
              ? 'No hay consultas pendientes de revisión. Cuando el asistente no pueda responder bien, aparecerán acá.'
              : 'No hay registros para este filtro.'}
          </p>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500 dark:bg-slate-800/80">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Usuario</th>
                  <th className="px-3 py-2">Módulo</th>
                  <th className="px-3 py-2 min-w-[12rem]">Pregunta</th>
                  <th className="px-3 py-2 min-w-[14rem]">Respuesta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600 dark:text-slate-400">
                      {fmtDate(r.createdAt)}
                      {r.durationMs != null && (
                        <div className="text-xs text-slate-400">{Math.round(r.durationMs / 1000)}s</div>
                      )}
                    </td>
                    <td className="px-3 py-2">{outcomeBadge(r.outcome)}</td>
                    <td className="max-w-[8rem] truncate px-3 py-2 text-slate-700 dark:text-slate-300" title={r.userEmail || r.uid}>
                      {r.userEmail || r.uid.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{r.moduleKey || '—'}</td>
                    <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">{r.question}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                      {r.reply ? (
                        <span className="line-clamp-4">{r.reply}</span>
                      ) : r.errorMessage ? (
                        <span className="text-red-600 dark:text-red-400">{r.errorMessage}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-xs text-slate-500">
          Se guardan hasta las últimas 250–300 interacciones visibles por filtro. El CSV incluye pregunta y respuesta completas
          para trabajar nuevas herramientas del asistente.
        </p>
      </div>
    </div>
  );
}
