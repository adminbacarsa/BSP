'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';
import { X, SendHorizontal, Trash2 } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { inferModuleKeyFromPath, moduleTitleEs } from '@/lib/assistant/inferModuleKeyFromPath';
import {
  clientDeployForAssistant,
  getClientDeployContext,
  type ClientDeployContext,
} from '@/lib/appBuildInfo';

type ChatMsg = { role: 'user' | 'assistant'; content: string };

const FAB_PX = 64;
const FAB_GAP_PX = 14;
const PANEL_W = 'min(100vw - 1.5rem, 28rem)';
const FAB_STORAGE_KEY = 'cosp-assistant-fab-pos';

/** Escudo COSP (SVG inline: no depende de /icons/* en public). */
function CospShieldIcon({
  size,
  className = '',
  style,
}: {
  size: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 ${className}`}
      style={style}
      aria-hidden
    >
      <path
        d="M24 3.5 8.5 9.8v12.4c0 10.6 6.9 20.5 15.5 22.3 8.6-1.8 15.5-11.7 15.5-22.3V9.8L24 3.5z"
        fill="currentColor"
        fillOpacity={0.22}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M17.5 23.5 22 28l9.5-11.5"
        stroke="currentColor"
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
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
    <p key={pi} className="mb-2.5 last:mb-0 whitespace-pre-wrap leading-relaxed">
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

const deployCtx: ClientDeployContext = getClientDeployContext();

export function AssistantFloatingBubble(): React.ReactNode {
  const router = useRouter();
  const { user, loading, canReadModule, isSuperAdmin } = useAuth();
  const { empresaId: empresaCtxId, empresa } = useEmpresa();
  const brandColor = empresa?.primaryColor || '#6366f1';
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
        empresaId: empresaCtxId || '',
        clientToday: clientLocalTodayYsMmDd(),
        clientDeploy: clientDeployForAssistant(deployCtx),
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
      } else if (code === 'permission-denied') {
        human =
          rawMsg.includes('asistente virtual')
            ? rawMsg
            : 'No tenés permiso para usar el asistente. Pedí acceso al módulo «Asistente IA» en Configuración → Roles.';
      } else if (code === 'internal' || /^internal\b/i.test(rawMsg)) {
        human = 'Fallo interno en el servidor. Probá de nuevo en un momento; si se repite, avisá a soporte técnico.';
      } else if (code === 'unavailable') {
        human = 'Servicio temporalmente no disponible. Probá de nuevo dentro de uno o dos minutos.';
      }
      setMsgs([...next, { role: 'assistant', content: `⚠️ ${human}` }]);
    } finally {
      setBusy(false);
    }
  }, [busy, empresaCtxId, fullPath, input, msgs, pathname, user]);

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

  if (loading || !user || hideGloboRoute(pathname || '') || !portalRoot) return null;
  const pathBase = (pathname || '').split('?')[0];
  const isEmployeePortal = pathBase.startsWith('/empleado');
  if (!isEmployeePortal && !isSuperAdmin && !canReadModule('ASSISTANT')) return null;
  if (empresa !== null && empresa.assistantEnabled === false) {
    return null;
  }

  const fabBottomCss = `max(${fabPos.bottom}px, calc(8px + env(safe-area-inset-bottom, 0px)))`;
  const fabRightCss = `max(${fabPos.right}px, calc(8px + env(safe-area-inset-right, 0px)))`;
  const panelBottomCss = `calc(${fabBottomCss} + ${FAB_PX + FAB_GAP_PX}px)`;

  const overlay = (
    <>
      <button
        type="button"
        style={{
          bottom: fabBottomCss,
          right: fabRightCss,
          touchAction: 'none',
          background: `linear-gradient(135deg, ${brandColor}cc, ${brandColor})`,
          boxShadow: `0 12px 44px -10px ${brandColor}cc, 0 4px 18px rgba(0,0,0,0.22)`,
        }}
        className="fixed z-[9999] flex h-16 w-16 shrink-0 cursor-grab items-center justify-center rounded-full text-white ring-[3px] ring-white/50 active:cursor-grabbing active:scale-[0.98] focus:outline-none dark:ring-slate-900/60"
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
        {open ? (
          <X size={26} strokeWidth={2.5} />
        ) : (
          <CospShieldIcon size={40} className="text-white drop-shadow-sm" />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Asistente COSP"
          style={{
            bottom: panelBottomCss,
            right: fabRightCss,
            width: PANEL_W,
          }}
          className="fixed z-[9999] flex flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 shadow-[0_28px_60px_-14px_rgba(0,0,0,0.38)] backdrop-blur-md dark:border-slate-600/80 dark:bg-slate-900/95"
        >
          <div
            className="flex items-center justify-between gap-2 border-b px-3 py-2 dark:border-slate-800"
            style={{ background: `linear-gradient(90deg, ${brandColor}18, ${brandColor}08)`, borderColor: `${brandColor}30` }}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <CospShieldIcon size={36} className="" style={{ color: brandColor } as React.CSSProperties} />
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-wide dark:text-indigo-100" style={{ color: brandColor }}>
                  Asistente COSP
                </p>
                <p className="truncate text-[10px] font-medium text-slate-600 dark:text-slate-400" title={fullPath}>
                  {moduleTitleEs(inferModuleKeyFromPath(fullPath || pathname))}
                </p>
                <p
                  className="truncate text-[9px] font-bold text-slate-500 dark:text-slate-500"
                  title={deployCtx.versionLabel}
                >
                  <span
                    className={
                      deployCtx.environment === 'emulator'
                        ? 'text-amber-700 dark:text-amber-400'
                        : 'text-emerald-700 dark:text-emerald-400'
                    }
                  >
                    {deployCtx.environment === 'emulator' ? 'Lab' : 'Prod'}
                  </span>
                  {' · '}
                  {deployCtx.buildHash}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMsgs([])}
              className="shrink-0 rounded-xl p-2 text-slate-500 hover:bg-white/90 dark:hover:bg-slate-800"
              title="Limpiar conversación (sesión temporal)"
            >
              <Trash2 size={16} />
            </button>
          </div>

          <div
            ref={scrollRef}
            className="max-h-[min(58vh,360px)] space-y-2.5 overflow-y-auto px-3 py-3 text-[13px] leading-relaxed"
          >
            {msgs.length === 0 && (
              <div className="rounded-xl border px-3 py-2.5 dark:bg-indigo-950/25"
                style={{ borderColor: `${brandColor}30`, backgroundColor: `${brandColor}0d` }}>
                <p className="text-[12px] leading-snug text-slate-600 dark:text-slate-400">
                  Datos de la empresa o ayuda con este módulo. Por ejemplo:{' '}
                  <span className="text-slate-700 dark:text-slate-300">
                    «¿Cuántos empleados?» · «Horas de X en mayo» · «¿Quién está de turno hoy?»
                  </span>
                </p>
                <p className="mt-1.5 text-[10px] text-slate-400 dark:text-slate-500">
                  La charla no se guarda al cerrar sesión.
                </p>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div
                  className={`min-w-0 max-w-[92%] rounded-2xl font-medium ${
                    m.role === 'user'
                      ? 'px-3 py-2 text-[13px] text-white shadow-sm'
                      : 'border border-slate-100 bg-slate-50 px-3 py-2.5 text-slate-800 leading-relaxed dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'
                  }`}
                  style={m.role === 'user' ? { backgroundColor: brandColor } : undefined}
                >
                  {m.role === 'assistant' ? formatAssistantMessage(m.content) : m.content}
                </div>
              </div>
            ))}
            {busy && (
              <p className="rounded-xl border border-dashed px-3 py-2 text-[12px] font-medium dark:bg-indigo-950/30 dark:text-indigo-200"
                style={{ borderColor: `${brandColor}50`, backgroundColor: `${brandColor}12`, color: brandColor }}>
                Consultando datos…
              </p>
            )}
          </div>

          <div className="flex gap-2 border-t border-slate-100 p-2.5 dark:border-slate-800">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
              placeholder="Escribí tu pregunta…"
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] font-medium leading-normal text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-indigo-900"
              disabled={busy}
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || !input.trim()}
              className="shrink-0 rounded-xl px-3 py-2.5 text-white shadow-sm disabled:opacity-40"
              style={{ backgroundColor: brandColor }}
              aria-label="Enviar"
            >
              <SendHorizontal size={20} />
            </button>
          </div>
        </div>
      )}
    </>
  );

  return createPortal(overlay, portalRoot);
}
