import React, { useState } from 'react';
import { Ban, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { ProformaBillingRow, PurchaseOrder, PurchaseOrderLine } from '@/lib/crm/slaBilling.types';
import { purchaseOrderService } from '@/services/purchaseOrderService';

type ObjectiveOpt = { id: string; name: string };

function fmtYmd(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (ymd || '—');
}

function authorizedTotal(oc: PurchaseOrder): number | undefined {
  if (oc.authorizedHours != null && Number.isFinite(Number(oc.authorizedHours))) return Number(oc.authorizedHours);
  const sum = (oc.lines || []).reduce((a, l) => a + (Number(l.authorizedHours) || 0), 0);
  return sum > 0 ? sum : undefined;
}

function linesFromInputs(objectives: ObjectiveOpt[], hours: Record<string, string>): PurchaseOrderLine[] {
  const lines: PurchaseOrderLine[] = [];
  for (const o of objectives) {
    const raw = String(hours[o.id] ?? '').trim();
    if (!raw) continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) continue;
    lines.push({ objectiveId: o.id, authorizedHours: n });
  }
  return lines;
}

export function ProformaOcQuickPanel(props: {
  clientId?: string;
  empresaId: string;
  orders: PurchaseOrder[];
  objectives: ObjectiveOpt[];
  billingRows: ProformaBillingRow[];
  periodLabel: string;
  consumptionLoading: boolean;
  actorName: string;
  onRefresh: () => void | Promise<void>;
}) {
  const { clientId, empresaId, orders, objectives, billingRows, periodLabel, consumptionLoading, actorName, onRefresh } = props;
  const [ocNumber, setOcNumber] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [authorizedHours, setAuthorizedHours] = useState('');
  const [lineHours, setLineHours] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  if (!clientId) return null;

  const resetForm = () => {
    setEditingId(null);
    setOcNumber('');
    setStartDate('');
    setEndDate('');
    setAuthorizedHours('');
    setLineHours({});
  };

  const startEdit = (o: PurchaseOrder) => {
    const next: Record<string, string> = {};
    for (const line of o.lines || []) {
      const oid = String(line.objectiveId || '').trim();
      if (oid && line.authorizedHours != null) next[oid] = String(line.authorizedHours);
    }
    setEditingId(o.id);
    setOcNumber(o.ocNumber || '');
    setStartDate(o.startDate || '');
    setEndDate(o.endDate || '');
    setAuthorizedHours(o.authorizedHours != null ? String(o.authorizedHours) : '');
    setLineHours(next);
  };

  const handleSave = async () => {
    if (!ocNumber.trim() || !startDate || !endDate) {
      toast.error('Completá número de OC y vigencia');
      return;
    }
    const lines = linesFromInputs(objectives, lineHours);
    const hours = authorizedHours.trim() ? Number(authorizedHours) : null;
    if (authorizedHours.trim() && !Number.isFinite(hours)) {
      toast.error('Las horas autorizadas no son un número');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await purchaseOrderService.update(editingId, {
          ocNumber: ocNumber.trim(),
          startDate,
          endDate,
          authorizedHours: hours,
          lines,
        });
        toast.success('Orden de compra actualizada');
      } else {
        await purchaseOrderService.create(
          {
            empresaId,
            clientId,
            ocNumber: ocNumber.trim(),
            startDate,
            endDate,
            status: 'ACTIVE',
            authorizedHours: hours ?? undefined,
            lines: lines.length ? lines : undefined,
            currency: 'ARS',
          },
          { empresaId },
        );
        toast.success('Orden de compra creada');
      }
      resetForm();
      await onRefresh();
    } catch (e) {
      console.error(e);
      toast.error(editingId ? 'No se pudo actualizar la OC' : 'No se pudo crear la OC');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (o: PurchaseOrder) => {
    if (!confirm(`¿Anular la OC ${o.ocNumber}? No se borra: deja de poder elegirse en Servicios.`)) return;
    setSaving(true);
    try {
      await purchaseOrderService.cancel(o.id, actorName || 'Operador');
      toast.success('Orden de compra anulada');
      if (editingId === o.id) resetForm();
      await onRefresh();
    } catch (e) {
      console.error(e);
      toast.error('No se pudo anular la OC');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 space-y-3">
      <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Órdenes de compra (Ministerio / OC externa)</p>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <input className="col-span-2 p-2 rounded-lg border text-xs font-bold dark:bg-slate-900 dark:border-slate-600 dark:text-white" placeholder="Nº OC" value={ocNumber} onChange={(e) => setOcNumber(e.target.value)} />
        <input type="date" className="p-2 rounded-lg border text-xs font-bold dark:bg-slate-900 dark:border-slate-600 dark:text-white" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <input type="date" className="p-2 rounded-lg border text-xs font-bold dark:bg-slate-900 dark:border-slate-600 dark:text-white" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        <input className="p-2 rounded-lg border text-xs font-bold dark:bg-slate-900 dark:border-slate-600 dark:text-white" placeholder="Hs auth. total" value={authorizedHours} onChange={(e) => setAuthorizedHours(e.target.value)} />
      </div>
      {objectives.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase text-slate-400">Horas autorizadas por objetivo (opcional)</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {objectives.map((o) => (
              <label key={o.id} className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                <span className="flex-1 truncate font-bold">{o.name || o.id}</span>
                <input
                  className="w-24 p-1.5 rounded-lg border text-xs font-bold dark:bg-slate-900 dark:border-slate-600 dark:text-white"
                  placeholder="Hs"
                  value={lineHours[o.id] ?? ''}
                  onChange={(e) => setLineHours((prev) => ({ ...prev, [o.id]: e.target.value }))}
                />
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" disabled={saving} onClick={() => void handleSave()} className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-[10px] font-black uppercase disabled:opacity-50 inline-flex items-center justify-center gap-1">
          {editingId ? <Pencil size={12} /> : <Plus size={12} />}
          {editingId ? 'Guardar OC' : 'Agregar OC'}
        </button>
        {editingId && (
          <button type="button" disabled={saving} onClick={resetForm} className="px-4 py-2 rounded-lg border border-slate-200 text-[10px] font-black uppercase text-slate-500">
            Cancelar
          </button>
        )}
      </div>
      {orders.length > 0 && (
        <ul className="text-xs space-y-2">
          {orders.map((o) => {
            const cancelled = o.status === 'CANCELLED';
            const mine = billingRows.filter((r) => r.ocId === o.id);
            const consumed = mine.reduce((a, r) => a + (Number(r.prestadoHours) || 0), 0);
            const authorized = authorizedTotal(o);
            const ratio = authorized != null && authorized > 0 ? consumed / authorized : null;
            const balance = authorized != null ? authorized - consumed : undefined;
            const hot = ratio != null && ratio >= 1;
            const warn = ratio != null && ratio >= 0.8 && !hot;
            const tone = hot ? 'bg-rose-500' : warn ? 'bg-amber-500' : 'bg-emerald-500';
            const toneText = hot ? 'text-rose-600' : warn ? 'text-amber-600' : 'text-slate-500';
            return (
              <li key={o.id} className={`rounded-xl border p-3 space-y-1.5 ${cancelled ? 'border-slate-200 opacity-70' : hot ? 'border-rose-200 bg-rose-50/60' : warn ? 'border-amber-200 bg-amber-50/60' : 'border-slate-100'}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className={`font-bold text-slate-700 dark:text-slate-200 ${cancelled ? 'line-through' : ''}`}>
                    OC {o.ocNumber} · {fmtYmd(o.startDate)} → {fmtYmd(o.endDate)}
                    {authorized != null ? ` · ${authorized} hs` : ''}
                    {cancelled ? ' · ANULADA' : ''}
                  </p>
                  {!cancelled && (
                    <div className="flex gap-1 shrink-0">
                      <button type="button" onClick={() => startEdit(o)} className="px-2 py-1 rounded-lg text-[10px] font-black uppercase text-indigo-600 hover:bg-indigo-50">Editar</button>
                      <button type="button" disabled={saving} onClick={() => void handleCancel(o)} className="px-2 py-1 rounded-lg text-[10px] font-black uppercase text-rose-600 hover:bg-rose-50 inline-flex items-center gap-1">
                        <Ban size={11} /> Anular
                      </button>
                    </div>
                  )}
                </div>
                {(o.lines || []).length > 0 && (
                  <p className="text-[10px] text-slate-400">
                    Por objetivo: {(o.lines || []).map((l) => {
                      const name = objectives.find((ob) => ob.id === l.objectiveId)?.name || l.objectiveId || '—';
                      return `${name} ${l.authorizedHours ?? 0} hs`;
                    }).join(' · ')}
                  </p>
                )}
                <p className={`text-[11px] font-bold ${toneText}`}>
                  {consumptionLoading
                    ? 'Calculando consumo del período…'
                    : authorized == null
                      ? `Consumidas ${periodLabel}: ${consumed} hs (sin techo cargado)`
                      : `Consumidas ${periodLabel}: ${consumed} hs · saldo ${Math.max(0, Math.round((balance ?? 0) * 10) / 10)} hs${hot ? ' · tope alcanzado' : warn ? ' · supera el 80 %' : ''}`}
                </p>
                {ratio != null && (
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
