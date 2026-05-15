'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { Sparkles, X, SendHorizontal, Trash2 } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { inferModuleKeyFromPath } from '@/lib/assistant/inferModuleKeyFromPath';

type ChatMsg = { role: 'user' | 'assistant'; content: string };

function hideGloboRoute(pathname: string): boolean {
  const base = pathname.split('?')[0];
  if (base === '/') return false;
  if (base.startsWith('/login')) return true;
  if (base.includes('/invite')) return true;
  return false;
}

export function AssistantFloatingBubble(): React.ReactNode {
  const router = useRouter();
  const { user, loading, empresaId } = useAuth();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  /** asPath lleva los segmentos reales (ideal para inferir módulo). */
  const pathname = router.pathname || '/';
  const fullPath = (router.asPath || router.pathname || '/').split('?')[0] || pathname;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, open, busy]);

  useEffect(() => {
    if (!user) {
      setMsgs([]);
      setOpen(false);
    }
  }, [user]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !user || busy) return;
    setInput('');
    const next: ChatMsg[] = [...msgs, { role: 'user', content: text }];
    setMsgs(next);
    setBusy(true);
    try {
      const moduleKey = inferModuleKeyFromPath(fullPath || pathname);
      const call = httpsCallable(functions, 'chatPlatformAssistant');
      const res = await call({
        messages: next.map((m) => ({ role: m.role, content: m.content })),
        pathname: fullPath || pathname,
        moduleKey,
        empresaId: empresaId || '',
      });
      const data = res.data as { reply?: string };
      const reply = String(data?.reply ?? '').trim() || '(Sin respuesta.)';
      setMsgs([...next, { role: 'assistant', content: reply }]);
    } catch (e: any) {
      const code = e?.code || '';
      const msg =
        typeof e?.message === 'string'
          ? e.message
          : 'No se pudo conectar al asistente. Si estás local, necesitás Functions emulator con GEMINI_API_KEY configurada.';
      const human =
        code === 'functions/not-found'
          ? 'Functions: la función chatPlatformAssistant aún no está desplegada o el emulador no expone esa versión compilada.'
          : msg;
      setMsgs([...next, { role: 'assistant', content: `⚠️ ${human}` }]);
    } finally {
      setBusy(false);
    }
  }, [busy, empresaId, fullPath, input, msgs, pathname, user]);

  if (loading || !user || hideGloboRoute(pathname || '')) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-5 right-5 z-[130] flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-xl ring-2 ring-white/30 transition hover:bg-indigo-500 focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-300 dark:ring-slate-900/50"
        aria-expanded={open}
        aria-label={open ? 'Cerrar asistente' : 'Abrir asistente COSP'}
      >
        {open ? <X size={24} strokeWidth={2.5} /> : <Sparkles size={24} strokeWidth={2.5} />}
      </button>

      {open && (
        <div
          className="fixed bottom-[5.25rem] right-5 z-[130] flex w-[min(100vw-2.5rem,22rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          role="dialog"
          aria-label="Asistente COSP"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-indigo-50 px-3 py-2 dark:border-slate-800 dark:bg-indigo-950/40">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-wide text-indigo-800 dark:text-indigo-200">Asistente</p>
              <p className="truncate text-[9px] font-bold text-slate-500 dark:text-slate-400" title={fullPath}>
                {inferModuleKeyFromPath(fullPath || pathname) || 'General'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setMsgs([])}
              className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-white/80 dark:hover:bg-slate-800"
              title="Limpiar conversación (sesión temporal)"
            >
              <Trash2 size={14} />
            </button>
          </div>

          <div ref={scrollRef} className="max-h-[min(50vh,320px)] space-y-2 overflow-y-auto px-3 py-2 text-[11px] leading-snug">
            {msgs.length === 0 && (
              <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                Preguntá cómo funciona COSP o el módulo en el que estás. La conversación no se guarda: al cerrar sesión o limpiar, se borra.
              </p>
            )}
            {msgs.map((m, i) => (
              <div
                key={i}
                className={`rounded-xl px-2.5 py-1.5 font-medium ${
                  m.role === 'user'
                    ? 'ml-4 bg-indigo-600 text-white'
                    : 'mr-2 border border-slate-100 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'
                }`}
              >
                {m.content}
              </div>
            ))}
            {busy && (
              <p className="text-[10px] font-bold text-slate-400 italic">Pensando…</p>
            )}
          </div>

          <div className="flex gap-1 border-t border-slate-100 p-2 dark:border-slate-800">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
              placeholder="Escribí tu pregunta…"
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-bold text-slate-800 outline-none focus:border-indigo-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
              disabled={busy}
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || !input.trim()}
              className="shrink-0 rounded-xl bg-indigo-600 p-2 text-white disabled:opacity-40"
              aria-label="Enviar"
            >
              <SendHorizontal size={18} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
