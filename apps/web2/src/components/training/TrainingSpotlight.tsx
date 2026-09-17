import React, { useEffect, useState, useCallback } from 'react';

interface SpotlightRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

interface TrainingSpotlightProps {
  selector: string | undefined;
}

const PAD = 8;

export function TrainingSpotlight({ selector }: TrainingSpotlightProps) {
  const [rect, setRect] = useState<SpotlightRect | null>(null);

  const updateRect = useCallback(() => {
    if (!selector || typeof document === 'undefined') { setRect(null); return; }
    const el = document.querySelector(selector);
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    setRect({
      top: r.top - PAD,
      left: r.left - PAD,
      right: r.right + PAD,
      bottom: r.bottom + PAD,
    });
  }, [selector]);

  useEffect(() => {
    updateRect();
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    // Reintenta hasta encontrar el elemento (puede tardar en montarse)
    const interval = setInterval(updateRect, 600);
    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
      clearInterval(interval);
    };
  }, [updateRect]);

  if (!rect) return null;

  const { top, left, right, bottom } = rect;
  const w = right - left;
  const h = bottom - top;

  return (
    <div className="fixed inset-0 pointer-events-none z-[850]" aria-hidden="true">
      {/* Oscurecer las 4 zonas alrededor del target */}
      <div className="absolute bg-black/55" style={{ top: 0, left: 0, right: 0, height: Math.max(0, top) }} />
      <div className="absolute bg-black/55" style={{ top: bottom, left: 0, right: 0, bottom: 0 }} />
      <div className="absolute bg-black/55" style={{ top, left: 0, width: Math.max(0, left), height: h }} />
      <div className="absolute bg-black/55" style={{ top, left: right, right: 0, height: h }} />

      {/* Borde pulsante alrededor del elemento */}
      <div
        className="absolute rounded-lg"
        style={{
          top,
          left,
          width: w,
          height: h,
          boxShadow: '0 0 0 3px #fbbf24, 0 0 0 5px rgba(251,191,36,0.4)',
          animation: 'training-pulse 1.8s ease-in-out infinite',
        }}
      />

      <style>{`
        @keyframes training-pulse {
          0%, 100% { box-shadow: 0 0 0 3px #fbbf24, 0 0 0 5px rgba(251,191,36,0.4); }
          50%       { box-shadow: 0 0 0 3px #f59e0b, 0 0 0 10px rgba(251,191,36,0.15); }
        }
      `}</style>
    </div>
  );
}
