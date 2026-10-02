import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placeToolbarMenu, type MenuPlace } from '@/lib/planificacion/toolbarFloatMenu';

export function ToolbarMenuPanel(props: {
  pos: MenuPlace;
  menuKey: string;
  className?: string;
  panelRef?: React.Ref<HTMLDivElement>;
  hidden?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      ref={props.panelRef}
      data-toolbar-menu={props.menuKey}
      className={props.className}
      style={{ position: 'fixed', top: props.pos.top, left: props.pos.left, maxHeight: props.pos.maxHeight, zIndex: 9999, visibility: props.hidden ? 'hidden' : 'visible' }}
    >
      {props.children}
    </div>
  );
}

/** Desplegable de la barra de Planificación: portal en document.body, fijo al botón, cierra afuera / Escape / scroll. */
export function ToolbarFloatMenu(props: {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  align?: 'start' | 'end';
  minWidth?: number;
  estimatedHeight?: number;
  menuKey: string;
  className?: string;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<MenuPlace | null>(null);
  const minWidth = props.minWidth ?? 160;
  const estimatedHeight = props.estimatedHeight ?? 220;

  useLayoutEffect(() => {
    if (!props.open) {
      setPos(null);
      return;
    }
    const rect = props.anchorRef.current?.getBoundingClientRect();
    if (!rect || typeof window === 'undefined') return;
    const measured = panelRef.current;
    setPos(placeToolbarMenu({
      anchor: rect,
      menuWidth: Math.max(minWidth, measured?.scrollWidth || minWidth),
      menuHeight: measured?.scrollHeight || estimatedHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      align: props.align,
    }));
  }, [props.open, props.align, props.anchorRef, minWidth, estimatedHeight]);

  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    const onScroll = (e: Event) => {
      const node = e.target;
      if (node instanceof Element && node.closest('[data-toolbar-menu]')) return;
      props.onClose();
    };
    const onResize = () => {
      const rect = props.anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const measured = panelRef.current;
      setPos(placeToolbarMenu({
        anchor: rect,
        menuWidth: Math.max(minWidth, measured?.scrollWidth || minWidth),
        menuHeight: measured?.scrollHeight || estimatedHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        align: props.align,
      }));
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [props.open, props.onClose, props.anchorRef, props.align, minWidth, estimatedHeight]);

  if (!props.open || typeof document === 'undefined') return null;
  const placed = pos ?? { top: -9999, left: 8, maxHeight: estimatedHeight };
  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" aria-hidden onClick={props.onClose} />
      <ToolbarMenuPanel pos={placed} menuKey={props.menuKey} panelRef={panelRef} hidden={!pos} className={`overflow-y-auto custom-scrollbar ${props.className || ''}`}>
        {props.children}
      </ToolbarMenuPanel>
    </>,
    document.body,
  );
}
