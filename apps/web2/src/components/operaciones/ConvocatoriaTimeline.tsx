import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';

type Ev = {
  id: string;
  type?: string;
  origin?: string;
  result?: string;
  response?: string;
  channel?: string;
  outcome?: string;
  reason?: string;
  originSource?: string;
  etaMinutes?: number;
  tokenSuffix?: string;
  deviceId?: string;
  platform?: string;
  appVersion?: string;
  at?: { toDate?: () => Date };
};

function hhmm(ev: Ev): string {
  const d = ev.at?.toDate?.();
  if (!d) return '';
  return d.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

function line(ev: Ev): string {
  if (ev.type === 'CREADA') return `Creada · ${ev.origin || 'CC'}`;
  if (ev.type === 'PUSH' || ev.type === 'ENVIADA') {
    const tok = ev.tokenSuffix ? ` ·…${ev.tokenSuffix}` : '';
    return `Enviada ${ev.result || 'sent'}${tok}`;
  }
  if (ev.type === 'ACEPTADA') {
    const src = ev.originSource === 'DEVICE' ? 'celular' : ev.originSource === 'DOMICILIO' ? 'domicilio' : '';
    return `Aceptada${src ? ` · ${src}` : ''}${ev.etaMinutes ? ` · ETA ${ev.etaMinutes} min` : ''}`;
  }
  if (ev.type === 'RECORDATORIO') return 'Recordatorio 2/3 del ETA';
  if (ev.type === 'DEMORADO') return 'Demorado · aviso al CC';
  if (ev.type === 'FICHO') return 'Fichó';
  if (ev.type === 'CANCELADA') return `Cancelada${ev.reason ? ` · ${ev.reason}` : ''}`;
  if (ev.type === 'RESPUESTA') {
    const who = [ev.channel, ev.platform, ev.appVersion].filter(Boolean).join(' · ');
    return `Respuesta ${ev.response || ''}${who ? ` · ${who}` : ''}${ev.reason ? ` · ${ev.reason}` : ''}`;
  }
  if (ev.type === 'RESULTADO') return `Resultado ${ev.outcome || ''}${ev.reason ? ` · ${ev.reason}` : ''}`;
  return ev.type || 'evento';
}

export function ConvocatoriaTimeline({ convocatoriaId }: { convocatoriaId: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Ev[]>([]);

  useEffect(() => {
    if (!open || !convocatoriaId) return;
    const q = query(
      collection(db, 'convocatorias_cobertura', convocatoriaId, 'eventos'),
      orderBy('at', 'asc'),
    );
    return onSnapshot(q, (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Ev, 'id'>) })));
    });
  }, [open, convocatoriaId]);

  return (
    <div className="mt-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[8px] font-bold text-violet-600 hover:underline"
      >
        {open ? 'Ocultar línea' : 'Línea de tiempo'}
      </button>
      {open && (
        <ul className="mt-0.5 space-y-0.5">
          {rows.length === 0 && <li className="text-[8px] text-slate-400">Sin eventos</li>}
          {rows.map((ev) => (
            <li key={ev.id} className="text-[8px] text-slate-600 font-mono">
              {hhmm(ev)} {line(ev)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
