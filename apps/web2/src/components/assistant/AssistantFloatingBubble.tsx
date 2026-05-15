'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';
import { Sparkles, X, SendHorizontal, Trash2 } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { inferModuleKeyFromPath, moduleTitleEs } from '@/lib/assistant/inferModuleKeyFromPath';

type ChatMsg = { role: 'user' | 'assistant'; content: string };

const FAB_PX = 56;
const FAB_GAP_PX = 12;
const FAB_STORAGE_KEY = 'cosp-assistant-fab-pos';
const DRAG_THRESHOLD_PX = 10;

type FabPos = { bottom: number; right: number };

function clampFabPos(p: FabPos): FabPos {
  if (typeof window === 'undefined') return p;
  const pad = 8;
  const maxR = Math.max(pad, window.innerWidth - FAB_PX - pad);
  const maxB = Math.max(pad, window.innerHeight - FAB_PX - pad);
  return {
    right: Math.min(maxR, Math.max(pad, p.right)),
    bottom: Math.min(maxB, Math.max(pad, p.bottom)),
  };
}

function loadFabPos(): FabPos {
  if (typeof sessionStorage === 'undefined') return { bottom: 20, right: 20 };
  try {
    const raw = sessionStorage.getItem(FAB_STORAGE_KEY);
    if (!raw) return { bottom: 20, right: 20 };
    const j = JSON.parse(raw) as FabPos;
    if (typeof j.bottom === 'number' && typeof j.right === 'number') return clampFabPos(j);
  } catch {
    /* ignore */
  }
  return { bottom: 20, right: 20 };
}

/** Parte el texto en bloques legibles: doble salto, ítems numerados o viñetas en líneas aparte. */
function expandAssistantParagraphBlocks(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const coarse = normalized
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const chunk of coarse) {
    const numbered = chunk.split(/\n(?=\d+\.\s)/);
    if (numbered.length > 1) {
      numbered.forEach((p) => {
        const t = p.trim();
        if (t) out.push(t);
      });
      continue;
    }
    const bullets = chunk.split(/\n(?=[-*•]\s)/);
    if (bullets.length > 1) {
      bullets.forEach((p) => {
        const t = p.trim();
        if (t) out.push(t);
      });
      continue;
    }
    out.push(chunk);
  }
  return out;
}

/** `**negrita**` y saltos de línea / párrafos para respuestas del asistente. */
function formatAssistantMessage(content: string): React.ReactNode {
  const blocks = expandAssistantParagraphBlocks(content);
  if (blocks.length === 0) return null;
  return blocks.map((para, pi) => (
    <p key={pi} className="mb-4 last:mb-0 whitespace-pre-wrap leading-loose">
      {para.split('\n').map((line, li) => (
        <React.Fragment key={li}>
          {li > 0 ? <br /> : null}
          {formatAssistantLineWithBold(line)}
        </React.Fragment>
      ))}
    </p>
  ));
}

function formatAssistantLineWithBold(line: string): React.ReactNode {
  const chunks = line.split(/(\*\*[^*]+\*\*)/g);
  return chunks.map((c, idx) => {
    if (/^\*\*.+\*\*$/.test(c)) {
      const inner = c.slice(2, -2);
      return (
        <strong key={idx} className="font-extrabold text-indigo-950 dark:text-indigo-100">
          {inner}
        </strong>
      );
    }
    return <span key={idx}>{c}</span>;
  });
}

function clientLocalTodayYsMmDd(): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const y = parts.find((z) => z.type === 'year')?.value;
    const m = parts.find((z) => z.type === 'month')?.value;
    const d = parts.find((z) => z.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    /* ignore */
  }
  return new Date().toISOString().slice(0, 10);
}

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
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [fabPos, setFabPos] = useState<FabPos>({ bottom: 20, right: 20 });
  const fabPosRef = useRef<FabPos>(fabPos);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startBottom: number;
    startRight: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  useEffect(() => {
    setFabPos(loadFabPos());
  }, []);

  useEffect(() => {
    fabPosRef.current = fabPos;
  }, [fabPos]);

  useEffect(() => {
    const onResize = () => setFabPos((p) => clampFabPos(p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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
      const call = httpsCallable(functions, 'chatPlatformAssistant', { timeout: 210000 });
      const res = await call({
        messages: next.map((m) => ({ role: m.role, content: m.content })),
        pathname: fullPath || pathname,
        moduleKey,
        empresaId: empresaId || '',
        clientToday: clientLocalTodayYsMmDd(),
      });
      const data = res.data as { reply?: string };
      const reply = String(data?.reply ?? '').trim() || '(Sin respuesta.)';
      setMsgs([...next, { role: 'assistant', content: reply }]);
    } catch (e: any) {
      const code = String(e?.code ?? '').replace(/^functions\//, '');
      const rawMsg =
        typeof e?.message === 'string'
          ? e.message
          : 'No se pudo conectar al asistente. Si estás local, necesitás Functions emulator con GEMINI_API_KEY configurada.';
      let human =
        code === 'not-found'
          ? 'La función no está disponible: en producción ejecutá firebase deploy del backend; en local, levantá el emulador de Functions compilado.'
          : rawMsg;
      if (
        rawMsg.includes('deadline-exceeded') ||
        code === 'deadline-exceeded' ||
        (typeof e?.details === 'string' && e.details.includes('DEADLINE_EXCEEDED'))
      ) {
        human =
          'La respuesta tardó demasiado (tiempo máximo superado). Volvé a intentar con una pregunta más corta o esperá unos segundos; si sigue igual, revisá que la función chatPlatformAssistant esté desplegada con suficiente timeout.';
      } else if (code === 'internal' || /^internal\b/i.test(rawMsg)) {
        human = 'Fallo interno en el servidor. Probá de nuevo en un momento; si se repite, avisá a soporte técnico.';
      } else if (code === 'unavailable') {
        human = 'Servicio temporalmente no disponible. Probá de nuevo dentro de uno o dos minutos.';
      }
      setMsgs([...next, { role: 'assistant', content: `⚠️ ${human}` }]);
    } finally {
      setBusy(false);
    }
  }, [busy, empresaId, fullPath, input, msgs, pathname, user]);

  const endFabDrag = useCallback((e: React.PointerEvent, el: HTMLButtonElement) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      dragRef.current = null;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (!d) return;
      if (e.type === 'pointercancel') {
        if (d.moved) {
          try {
            sessionStorage.setItem(FAB_STORAGE_KEY, JSON.stringify(fabPosRef.current));
          } catch {
            /* ignore */
          }
        }
        return;
      }
      if (d.moved) {
        try {
          sessionStorage.setItem(FAB_STORAGE_KEY, JSON.stringify(fabPosRef.current));
        } catch {
          /* ignore */
        }
      } else {
        setOpen((o) => !o);
      }
    }, []);

  if (loading || !user || hideGloboRoute(pathname || '') || !portalRoot) {
    return null;
  }

  const fabBottomCss = `max(${fabPos.bottom}px, calc(8px + env(safe-area-inset-bottom, 0px)))`;
  const fabRightCss = `max(${fabPos.right}px, calc(8px + env(safe-area-inset-right, 0px)))`;
  const panelBottomCss = `calc(${fabBottomCss} + ${FAB_PX + FAB_GAP_PX}px)`;

  const overlay = (
    <>
      <button
        type="button"
        style={{ bottom: fabBottomCss, right: fabRightCss, touchAction: 'none' }}
        className="fixed z-[9999] flex h-14 w-14 shrink-0 cursor-grab items-center justify-center rounded-full bg-indigo-600 text-white shadow-[0_10px_40px_-10px_rgba(79,70,229,0.85),0_4px_16px_rgba(0,0,0,0.2)] ring-[3px] ring-white/40 active:cursor-grabbing active:scale-[0.98] focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-400 dark:ring-slate-900/60"
        aria-expanded={open}
        aria-label={open ? 'Cerrar asistente' : 'Abrir asistente COSP'}
        title="Tocá para abrir/cerrar. Mantené y arrastrá para mover."
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          dragRef.current = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            startBottom: fabPosRef.current.bottom,
            startRight: fabPosRef.current.right,
            moved: false,
          };
          (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d || e.pointerId !== d.pointerId) return;
          const dx = e.clientX - d.startX;
          const dy = e.clientY - d.startY;
          if (Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD_PX) d.moved = true;
          if (!d.moved) return;
          const next = clampFabPos({
            right: d.startRight - dx,
            bottom: d.startBottom - dy,
          });
          setFabPos(next);
        }}
        onPointerUp={(e) => endFabDrag(e, e.currentTarget)}
        onPointerCancel={(e) => endFabDrag(e, e.currentTarget)}
      >
        {open ? <X size={24} strokeWidth={2.5} /> : <Sparkles size={24} strokeWidth={2.5} />}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Asistente COSP"
          style={{
            bottom: panelBottomCss,
            right: fabRightCss,
          }}
          className="fixed z-[9999] flex w-[min(100vw-2rem,22rem)] flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.35)] backdrop-blur-md dark:border-slate-600/80 dark:bg-slate-900/95"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-indigo-50 px-3 py-2 dark:border-slate-800 dark:bg-indigo-950/40">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-wide text-indigo-800 dark:text-indigo-200">Asistente</p>
              <p className="truncate text-[9px] font-bold text-slate-500 dark:text-slate-400" title={fullPath}>
                {moduleTitleEs(inferModuleKeyFromPath(fullPath || pathname))}
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

          <div ref={scrollRef} className="max-h-[min(52vh,360px)] space-y-3 overflow-y-auto px-3 py-3 text-[12px] leading-loose">
            {msgs.length === 0 && (
              <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                Preguntá cómo funciona COSP o el módulo en el que estás. La conversación no se guarda: al cerrar sesión o limpiar, se borra.
                Podés <strong className="text-slate-700 dark:text-slate-300">arrastrar el botón violeta</strong> para moverlo; la posición se recuerda en esta sesión del navegador.
              </p>
            )}
            {msgs.map((m, i) => (
              <div
                key={i}
                className={`rounded-xl font-medium ${
                  m.role === 'user'
                    ? 'ml-3 bg-indigo-600 px-3 py-2 text-white'
                    : 'mr-1 border border-slate-100 bg-slate-50 px-3 py-2.5 text-slate-800 leading-loose dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'
                }`}
              >
                {m.role === 'assistant' ? formatAssistantMessage(m.content) : m.content}
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
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-bold leading-normal text-slate-800 outline-none focus:border-indigo-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
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

  return createPortal(overlay, portalRoot);
}
