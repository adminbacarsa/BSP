import React, { useState } from 'react';
import { Ban, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ProformaBillingRow, PurchaseOrder, PurchaseOrderKind, PurchaseOrderLine } from '@/lib/crm/slaBilling.types';
import {
  allocatePurchaseOrder,
  BOLSA_UNASSIGNED_SHARED_BY_ANY_OBJECTIVE,
  ocConsumptionLevel,
  purchaseOrderKindLabel,
  resolvePurchaseOrderKind,
  type OcConsumptionLevel,
} from '@/lib/crm/purchaseOrderAllocation';
import { purchaseOrderService } from '@/services/purchaseOrderService';

type ObjectiveOpt = { id: string; name: string };

const KINDS: PurchaseOrderKind[] = ['GENERAL', 'POR_OBJETIVO', 'BOLSA'];

const KIND_HELP: Record<PurchaseOrderKind, string> = {
  GENERAL: 'Un tope total único que consumen todos los objetivos del cliente que usan esta OC.',
  POR_OBJETIVO: 'Horas autorizadas por objetivo; el total de la OC es la suma de las líneas.',
  BOLSA: BOLSA_UNASSIGNED_SHARED_BY_ANY_OBJECTIVE
    ? 'Total fijo con asignación por objetivo. Lo sin asignar queda disponible y lo puede consumir cualquier objetivo que agote su asignación. Nunca se supera el total.'
    : 'Total fijo con asignación por objetivo. Lo sin asignar queda disponible para reasignar. Nunca se supera el total.',
};

function fmtYmd(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (ymd || '—');
}

const fmtH = (n: number | undefined): string => (n == null ? '—' : `${Math.round(n * 10) / 10} hs`);

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

function levelClasses(level: OcConsumptionLevel): { text: string; bar: string; box: string } {
  if (level === 'full') return { text: 'text-rose-600', bar: 'bg-rose-500', box: 'border-rose-200 bg-rose-50/60' };
  if (level === 'warn') return { text: 'text-amber-600', bar: 'bg-amber-500', box: 'border-amber-200 bg-amber-50/60' };
  return { text: 'text-slate-500', bar: 'bg-emerald-500', box: 'border-slate-100' };
}

function levelSuffix(level: OcConsumptionLevel): string {
  if (level === 'full') return ' · tope alcanzado';
  if (level === 'warn') return ' · supera el 80 %';
  return '';
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
  const [kind, setKind] = useState<PurchaseOrderKind>('GENERAL');
  const [ocNumber, setOcNumber] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [authorizedHours, setAuthorizedHours] = useState('');
  const [lineHours, setLineHours] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  if (!clientId) return null;

  const objectiveName = (id: string) => objectives.find((o) => o.id === id)?.name || id || '—';
  const usesTotal = kind === 'GENERAL' || kind === 'BOLSA';
  const usesLines = kind === 'POR_OBJETIVO' || kind === 'BOLSA';
  const draftLines = linesFromInputs(objectives, lineHours);
  const draftAssigned = draftLines.reduce((a, l) => a + (Number(l.authorizedHours) || 0), 0);
  const draftTotal = usesTotal ? Number(authorizedHours) : draftAssigned;

  const resetForm = () => {
    setEditingId(null);
    setKind('GENERAL');
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
    setKind(resolvePurchaseOrderKind(o));
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
    if (startDate > endDate) {
      toast.error('La vigencia termina antes de empezar');
      return;
    }
    const totalRaw = authorizedHours.trim();
    const total = totalRaw ? Number(totalRaw) : null;
    if (totalRaw && (!Number.isFinite(total) || (total as number) < 0)) {
      toast.error('Las horas autorizadas no son un número válido');
      return;
    }
    const lines = usesLines ? draftLines : [];
    if (kind === 'POR_OBJETIVO' && lines.length === 0) {
      toast.error('Por objetivo: cargá horas en al menos un objetivo');
      return;
    }
    if (kind === 'BOLSA') {
      if (total == null) {
        toast.error('Bolsa a repartir: cargá el total de la OC');
        return;
      }
      if (draftAssigned > total) {
        toast.error(`Lo asignado (${draftAssigned} hs) supera el total (${total} hs)`);
        return;
      }
    }
    setSaving(true);
    try {
      if (editingId) {
        await purchaseOrderService.update(editingId, {
          kind,
          ocNumber: ocNumber.trim(),
          startDate,
          endDate,
          authorizedHours: usesTotal ? total : null,
          lines: usesLines && lines.length ? lines : null,
        });
        toast.success('Orden de compra actualizada');
      } else {
        await purchaseOrderService.create(
          {
            empresaId,
            clientId,
            kind,
            ocNumber: ocNumber.trim(),
            startDate,
            endDate,
            status: 'ACTIVE',
            authorizedHours: usesTotal && total != null ? total : undefined,
            lines: usesLines && lines.length ? lines : undefined,
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
    if (!confirm(`¿Anular la OC ${o.ocNumber}? Queda en el historial y deja de poder elegirse en Servicios.`)) return;
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

  const handleDelete = async (o: PurchaseOrder) => {
    setSaving(true);
    try {
      const using = await purchaseOrderService.findSlaUsingOrder(o.id);
      if (using.length > 0) {
        const list = using.map((s) => `• ${s.objectiveName}${s.closed ? ' (cerrado)' : ''}`).join('\n');
        const ok = confirm(
          `La OC ${o.ocNumber} está asignada a ${using.length} contrato${using.length === 1 ? '' : 's'}:\n${list}\n\n` +
          'Al eliminarla se desasigna de esos contratos: quedan en modo Orden de compra SIN OC ' +
          '(facturan lo ejecutado sin tope hasta que elijas otra). ¿Eliminar de todas formas?',
        );
        if (!ok) return;
        const open = using.filter((s) => !s.closed);
        const closed = using.filter((s) => s.closed);
        if (open.length) await purchaseOrderService.unassignFromSla(open.map((s) => s.id));
        if (closed.length) {
          toast.warning(`${closed.length} contrato${closed.length === 1 ? '' : 's'} cerrado${closed.length === 1 ? '' : 's'} no se pudo desasignar (solo lectura).`);
        }
        toast.warning(`${open.length} contrato${open.length === 1 ? ' quedó' : 's quedaron'} en modo Orden de compra sin OC. Revisalos en Servicios.`);
      } else if (!confirm(`¿Eliminar definitivamente la OC ${o.ocNumber}? Esta acción no se puede deshacer.`)) {
        return;
      }
      await purchaseOrderService.remove(o.id);
      toast.success('Orden de compra eliminada');
      if (editingId === o.id) resetForm();
      await onRefresh();
    } catch (e) {
      console.error(e);
      toast.error('No se pudo eliminar la OC');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'p-2 rounded-lg border text-xs font-bold dark:bg-slate-900 dark:border-slate-600 dark:text-white';

  return (
    <div className="mb-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Órdenes de compra (Ministerio / OC externa)</p>
        {editingId && <span className="text-[10px] font-black uppercase text-indigo-600">Editando OC</span>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <select className={`col-span-2 ${inputCls}`} value={kind} onChange={(e) => setKind(e.target.value as PurchaseOrderKind)}>
          {KINDS.map((k) => <option key={k} value={k}>{purchaseOrderKindLabel(k)}</option>)}
        </select>
        <input className={`col-span-2 ${inputCls}`} placeholder="Nº OC" value={ocNumber} onChange={(e) => setOcNumber(e.target.value)} />
        <input type="date" className={inputCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <input type="date" className={inputCls} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </div>
      <p className="text-[10px] text-slate-400 leading-snug">{KIND_HELP[kind]}</p>

      {usesTotal && (
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-bold uppercase text-slate-400 shrink-0">Total autorizado</label>
          <input className={`w-32 ${inputCls}`} placeholder="Hs" value={authorizedHours} onChange={(e) => setAuthorizedHours(e.target.value)} />
          {kind === 'BOLSA' && Number.isFinite(draftTotal) && authorizedHours.trim() !== '' && (
            <span className={`text-[10px] font-bold ${draftAssigned > draftTotal ? 'text-rose-600' : 'text-slate-500'}`}>
              asignado {draftAssigned} hs · sin asignar {Math.max(0, draftTotal - draftAssigned)} hs
            </span>
          )}
        </div>
      )}

      {usesLines && (
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase text-slate-400">
            {kind === 'BOLSA' ? 'Asignación por objetivo' : 'Horas autorizadas por objetivo'}
            {kind === 'POR_OBJETIVO' && draftAssigned > 0 ? ` · total ${draftAssigned} hs` : ''}
          </p>
          {objectives.length === 0 ? (
            <p className="text-[10px] text-slate-400">El cliente no tiene objetivos cargados.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {objectives.map((o) => (
                <label key={o.id} className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                  <span className="flex-1 truncate font-bold">{o.name || o.id}</span>
                  <input
                    className={`w-24 p-1.5 ${inputCls}`}
                    placeholder="Hs"
                    value={lineHours[o.id] ?? ''}
                    onChange={(e) => setLineHours((prev) => ({ ...prev, [o.id]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <button type="button" disabled={saving} onClick={() => void handleSave()} className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-[10px] font-black uppercase disabled:opacity-50 inline-flex items-center justify-center gap-1 active:scale-95">
          {editingId ? <Pencil size={12} /> : <Plus size={12} />}
          {editingId ? 'Guardar cambios' : 'Agregar OC'}
        </button>
        {editingId && (
          <button type="button" disabled={saving} onClick={resetForm} className="px-4 py-2 rounded-lg border border-slate-200 text-[10px] font-black uppercase text-slate-500 hover:bg-slate-50">
            Cancelar
          </button>
        )}
      </div>

      {orders.length > 0 && (
        <ul className="text-xs space-y-2">
          {orders.map((o) => {
            const cancelled = o.status === 'CANCELLED';
            const oKind = resolvePurchaseOrderKind(o);
            const mine = billingRows.filter((r) => r.ocId === o.id);
            const summary = allocatePurchaseOrder(o, mine.map((r) => ({ objectiveId: r.objectiveId, prestadoHours: r.prestadoHours })));
            const level = ocConsumptionLevel(summary.ratio);
            const cls = levelClasses(level);
            const objectiveIds = Array.from(new Set([
              ...(o.lines || []).map((l) => String(l.objectiveId || '').trim()).filter(Boolean),
              ...summary.byObjective.map((a) => a.objectiveId),
            ]));
            const allocById = new Map(summary.byObjective.map((a) => [a.objectiveId, a]));
            return (
              <li key={o.id} className={`rounded-xl border p-3 space-y-2 ${cancelled ? 'border-slate-200 opacity-70' : cls.box}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className={`font-bold text-slate-700 dark:text-slate-200 ${cancelled ? 'line-through' : ''}`}>
                      OC {o.ocNumber} · {fmtYmd(o.startDate)} → {fmtYmd(o.endDate)}
                      {cancelled ? ' · ANULADA' : ''}
                    </p>
                    <p className="text-[10px] font-bold text-indigo-600">{purchaseOrderKindLabel(oKind)}</p>
                  </div>
                  {!cancelled && (
                    <div className="flex gap-1 shrink-0">
                      <button type="button" disabled={saving} onClick={() => startEdit(o)} className="px-2 py-1 rounded-lg text-[10px] font-black uppercase text-indigo-600 hover:bg-indigo-50 inline-flex items-center gap-1">
                        <Pencil size={11} /> Modificar
                      </button>
                      <button type="button" disabled={saving} onClick={() => void handleCancel(o)} className="px-2 py-1 rounded-lg text-[10px] font-black uppercase text-amber-600 hover:bg-amber-50 inline-flex items-center gap-1">
                        <Ban size={11} /> Anular
                      </button>
                      <button type="button" disabled={saving} onClick={() => void handleDelete(o)} className="px-2 py-1 rounded-lg text-[10px] font-black uppercase text-rose-600 hover:bg-rose-50 inline-flex items-center gap-1">
                        <Trash2 size={11} /> Eliminar
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[10px]">
                  <div><span className="block uppercase font-black text-slate-400">Total</span><span className="font-bold text-slate-700 dark:text-slate-200">{fmtH(summary.totalHours)}</span></div>
                  <div><span className="block uppercase font-black text-slate-400">Asignado</span><span className="font-bold text-slate-700 dark:text-slate-200">{oKind === 'GENERAL' ? '—' : fmtH(summary.assignedHours)}</span></div>
                  <div><span className="block uppercase font-black text-slate-400">Sin asignar</span><span className="font-bold text-slate-700 dark:text-slate-200">{oKind === 'BOLSA' ? fmtH(summary.unassignedHours) : '—'}</span></div>
                  <div><span className="block uppercase font-black text-slate-400">Consumido</span><span className={`font-bold ${cls.text}`}>{consumptionLoading ? '…' : fmtH(summary.consumedHours)}</span></div>
                  <div><span className="block uppercase font-black text-slate-400">Saldo</span><span className={`font-bold ${cls.text}`}>{consumptionLoading ? '…' : fmtH(summary.balanceHours)}</span></div>
                </div>
                {summary.ratio != null && !consumptionLoading && (
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className={`h-full ${cls.bar}`} style={{ width: `${Math.min(100, Math.round(summary.ratio * 100))}%` }} />
                  </div>
                )}
                <p className={`text-[10px] font-bold ${cls.text}`}>
                  {consumptionLoading
                    ? 'Calculando consumo del período…'
                    : mine.length === 0
                      ? `Sin contratos usando esta OC en ${periodLabel}.`
                      : `Consumo ${periodLabel}: ejecutado facturable de ${mine.length} contrato${mine.length === 1 ? '' : 's'}${levelSuffix(level)}`}
                </p>

                {objectiveIds.length > 0 && (
                  <ul className="space-y-1 border-t border-slate-100 pt-2">
                    {objectiveIds.map((oid) => {
                      const a = allocById.get(oid);
                      const assigned = a?.assignedHours ?? (o.lines || []).filter((l) => String(l.objectiveId || '').trim() === oid).reduce((s, l) => s + (Number(l.authorizedHours) || 0), 0);
                      const objLevel = ocConsumptionLevel(a?.ratio);
                      const objCls = levelClasses(objLevel);
                      return (
                        <li key={oid} className="flex flex-wrap items-baseline gap-x-2 text-[10px]">
                          <span className="font-bold text-slate-700 dark:text-slate-200 min-w-[8rem] truncate">{objectiveName(oid)}</span>
                          {oKind !== 'GENERAL' && <span className="text-slate-400">asignado {fmtH(assigned)}</span>}
                          <span className={objCls.text}>consumido {consumptionLoading ? '…' : fmtH(a?.consumedHours ?? 0)}</span>
                          <span className={objCls.text}>saldo {consumptionLoading ? '…' : fmtH(a?.balanceHours)}</span>
                          {a && a.fromUnassignedHours > 0 && <span className="text-indigo-600">+{fmtH(a.fromUnassignedHours)} de la bolsa</span>}
                          {!consumptionLoading && objLevel !== 'ok' && <span className={`font-black ${objCls.text}`}>{objLevel === 'full' ? '100 %' : '80 %'}</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
