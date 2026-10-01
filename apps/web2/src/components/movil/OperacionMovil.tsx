import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'sonner';
import { BottomSheet } from '@/components/movil/BottomSheet';
import { MovilBottomNav } from '@/components/movil/MovilBottomNav';
import { OperacionScreens, useOnlineFlag, type GuardShift, type MovilObjective } from '@/components/movil/OperacionScreens';
import { COVERAGE_CASCADE_ORDER } from '@cosp/ops-core';
import { guardTone } from '@/lib/movil/guardTone';
import { enqueueFirestoreWrite, movilWriteQueue } from '@/lib/movil/writeQueue';
import { movilCallableGate, runCallableOnline } from '@/lib/movil/callableOnline';
import { writeMovilChoice } from '@/lib/movil/useMovilMode';

const STEP_LABEL: Record<string, string> = {
  RET: 'RET',
  REF: 'REF',
  ESC: 'ESC',
  EXTEND: 'Ext+Adel',
  ADVANCE: 'Ext+Adel',
  EVENTUAL: 'Eventuales',
  FT: 'FT',
};

interface Props {
  empresa: string;
  logic: {
    stats: { activos: number; retenidos: number; ausentes: number; vacantes: number; plan: number };
    setViewTab: (tab: string) => void;
    handleAction: (action: string, shiftId: string, payload?: unknown) => Promise<unknown> | void;
  };
  notices?: string[];
  objectives: Array<MovilObjective & Record<string, unknown>>;
  modeLabel: string;
  isPilot: boolean;
  pilotName?: string;
  apoyo?: string;
  pendingPilotName?: string;
  onTomarMando: () => Promise<void>;
  onPasarAuto: () => Promise<void>;
  onRequestPilot: () => Promise<void>;
  onAcceptPilot: () => Promise<void>;
  onRejectPilot: () => Promise<void>;
  onLlego: (shift: GuardShift) => Promise<void>;
  onProtocolo: (shift: GuardShift) => void;
  onRetencion: (shift: GuardShift) => void;
}

export function OperacionMovil(props: Props) {
  const router = useRouter();
  const online = useOnlineFlag();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [salaOpen, setSalaOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => movilWriteQueue.subscribe(() => {
    const labels = [...movilWriteQueue.pending(), ...movilCallableGate.pending()];
    setPending(labels[0] || null);
  }), []);

  const panelQuery = String(router.query.panel || '');
  const objective = props.objectives.find((item) => item.objectiveId === selectedId) || null;
  const panel = panelQuery === 'alertas' ? 'alertas' : objective ? 'objetivo' : 'home';
  const alerts = useMemo(
    () => props.objectives.flatMap((item) => item.shifts).filter((shift) => {
      const tone = guardTone(shift);
      return tone === 'aus' || tone === 'vac' || tone === 'ret' || tone === 'late';
    }),
    [props.objectives],
  );
  const steps = Array.from(new Set(COVERAGE_CASCADE_ORDER.map((step) => STEP_LABEL[step] || step)));

  const call = async (label: string, run: () => Promise<void>) => {
    try {
      await runCallableOnline(label, run);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Requiere conexión');
    }
  };

  return (
    <>
      <OperacionScreens
        empresa={props.empresa}
        modeLabel={props.modeLabel}
        online={online}
        pendingLabel={pending}
        stats={props.logic.stats}
        notices={props.notices}
        objectives={props.objectives}
        objective={objective}
        alerts={alerts}
        panel={panel === 'alertas' ? 'alertas' : panel}
        onBack={() => setSelectedId(null)}
        onOpen={setSelectedId}
        onCounter={(id) => props.logic.setViewTab(id)}
        onLlego={(shift) => { void call('Llegó?', () => props.onLlego(shift)); }}
        onRevertir={(shift) => { void call('Revertir', () => props.onLlego(shift)); }}
        onSalida={(shift) => {
          void enqueueFirestoreWrite(`Salida ${shift.employeeName || ''}`.trim(), async () => {
            await props.logic.handleAction('CHECKOUT', shift.id, 'Salida desde el celular');
          })
            .then((result) => {
              if (result === 'queued') toast.message('Pendiente de enviar');
              else toast.success('Salida registrada');
            });
        }}
        onProtocolo={props.onProtocolo}
        onRetencion={props.onRetencion}
        onSala={() => setSalaOpen(true)}
      />
      <BottomSheet open={salaOpen || panelQuery === 'sala'} title="Sala" onClose={() => { setSalaOpen(false); if (panelQuery === 'sala') void router.push('/admin/operaciones/'); }}>
        <div className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-[11px] font-black uppercase text-emerald-800">Operador manual</p>
          <p className="text-sm font-bold">A mando: {props.pilotName || '—'}{props.isPilot ? ' (vos)' : ''}</p>
          <p className="text-xs font-semibold text-slate-500">Apoyo: {props.apoyo || 'nadie'}</p>
        </div>
        {props.pendingPilotName && (
          <div className="mb-3 rounded-2xl border border-indigo-200 p-3">
            <p className="text-sm font-black">{props.pendingPilotName} pide el mando</p>
            <div className="mt-2 flex gap-2">
              <button type="button" className="min-h-12 flex-1 rounded-2xl bg-indigo-600 text-sm font-black text-white" onClick={() => { void call('Aceptar mando', props.onAcceptPilot); }}>Aceptar</button>
              <button type="button" className="min-h-12 flex-1 rounded-2xl bg-slate-100 text-sm font-black" onClick={() => { void call('Rechazar mando', props.onRejectPilot); }}>No</button>
            </div>
          </div>
        )}
        {!props.isPilot && (
          <button type="button" className="mb-2 min-h-12 w-full rounded-2xl bg-indigo-600 text-sm font-black text-white" onClick={() => { void call('Pedir mando', props.onRequestPilot); }}>Pedir mando</button>
        )}
        <button type="button" className="mb-2 min-h-12 w-full rounded-2xl border border-emerald-300 bg-white text-sm font-black text-emerald-800" onClick={() => { void call('Tomar mando', props.onTomarMando); }}>Tomar mando</button>
        <button type="button" className="mb-4 min-h-12 w-full rounded-2xl bg-rose-50 text-sm font-black text-rose-700" onClick={() => { void call('Pasar a Auto', props.onPasarAuto); }}>Pasar a Auto</button>
        <p className="mb-2 text-[11px] font-bold text-slate-500">Protocolo vigente: {steps.join(' → ')}. Los candidatos y Convocar abren la hoja del protocolo.</p>
        <button type="button" className="mb-2 min-h-11 w-full rounded-2xl bg-indigo-50 text-sm font-black text-indigo-800" onClick={() => { setSalaOpen(false); window.dispatchEvent(new Event('cosp-assistant-open')); }}>Asistente</button>
        <button type="button" className="mb-2 min-h-11 w-full rounded-2xl border border-slate-200 text-sm font-bold" onClick={() => writeMovilChoice('0')}>Ver como escritorio</button>
        <button type="button" className="min-h-11 w-full rounded-2xl bg-indigo-600 text-sm font-black text-white" onClick={() => {
          if (typeof Notification === 'undefined') return;
          void Notification.requestPermission().then((perm) => {
            if (perm === 'granted') window.location.reload();
          });
        }}>Activar avisos de este celular</button>
      </BottomSheet>
      <MovilBottomNav alertCount={alerts.length} />
    </>
  );
}
