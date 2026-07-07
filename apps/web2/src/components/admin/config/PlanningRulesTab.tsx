import React, { useCallback, useEffect, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import {
  Save, RotateCcw, Scale, Clock, Shield, Layers, Loader2, Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import {
  DEFAULT_PLANNING_RULES,
  mergePlanningRulesFromFirestore,
  PLANNING_CYCLE_KEYS,
  type PlanningCycleKey,
  type PlanningRulesConfig,
} from '@/lib/planning/planning-rules.types';

function numField(
  value: number,
  onChange: (n: number) => void,
  min: number,
  max: number,
): React.ReactNode {
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
    />
  );
}

export default function PlanningRulesTab() {
  const { user, isSuperAdmin } = useAuth();
  const { empresaId, empresaNombre } = useEmpresa();
  const [rules, setRules] = useState<PlanningRulesConfig>(DEFAULT_PLANNING_RULES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const loadRules = useCallback(async () => {
    if (!empresaId) return;
    setLoading(true);
    try {
      const snap = await getDoc(doc(db, 'planning_rules', empresaId));
      if (snap.exists()) {
        setRules(mergePlanningRulesFromFirestore(snap.data() as Partial<PlanningRulesConfig>));
      } else {
        setRules({ ...DEFAULT_PLANNING_RULES, cycles: { ...DEFAULT_PLANNING_RULES.cycles } });
      }
      setDirty(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('No se pudieron cargar las reglas: ' + msg);
    } finally {
      setLoading(false);
    }
  }, [empresaId]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const patch = (partial: Partial<PlanningRulesConfig>) => {
    setRules((prev) => ({ ...prev, ...partial }));
    setDirty(true);
  };

  const patchCycle = (key: PlanningCycleKey, partial: Partial<PlanningRulesConfig['cycles'][PlanningCycleKey]>) => {
    setRules((prev) => ({
      ...prev,
      cycles: {
        ...prev.cycles,
        [key]: { ...prev.cycles[key], ...partial },
      },
    }));
    setDirty(true);
  };

  const handleSave = async () => {
    if (!empresaId) return;
    setSaving(true);
    try {
      const payload: PlanningRulesConfig = {
        ...rules,
        updatedAt: new Date().toISOString(),
        updatedBy: user?.email ?? user?.uid ?? 'admin',
      };
      await setDoc(doc(db, 'planning_rules', empresaId), payload, { merge: true });
      setRules(payload);
      setDirty(false);
      toast.success('Reglas de planificación guardadas');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('Error al guardar: ' + msg);
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = () => {
    setRules({ ...DEFAULT_PLANNING_RULES, cycles: { ...DEFAULT_PLANNING_RULES.cycles } });
    setDirty(true);
    toast.message('Valores por defecto CCT 422/05 — guardá para persistir');
  };

  if (!empresaId) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900 text-sm">
        Seleccioná una empresa activa en el panel para configurar reglas de planificación.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl bg-white p-12 shadow-sm text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        Cargando reglas…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/80 p-4 flex gap-3 shadow-sm">
        <Info className="h-5 w-5 text-indigo-600 shrink-0 mt-0.5" />
        <div className="text-sm text-indigo-950">
          <p className="font-semibold">Reglas operativas por empresa</p>
          <p className="mt-1 text-indigo-800/90">
            VPLAN y el motor de planificación leen <code className="text-xs bg-white/60 px-1 rounded">planning_rules/{empresaId}</code>.
            Los cambios aplican en la próxima corrida sin redeploy.
            Empresa: <strong>{empresaNombre ?? empresaId}</strong>
            {!isSuperAdmin && ' · Solo administradores de la empresa pueden editar.'}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 space-y-4">
          <div className="flex items-center gap-2 text-slate-800 font-bold">
            <Scale className="h-5 w-5 text-indigo-600" />
            Límites CCT y horas
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
              Tope horas facturables / ciclo
              {numField(rules.cctMaxBillableHours, (n) => patch({ cctMaxBillableHours: n }), 80, 320)}
            </label>
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
              Horas objetivo promedio / empleado
              {numField(rules.targetAvgHoursPerEmployee, (n) => patch({ targetAvgHoursPerEmployee: n }), 120, 240)}
            </label>
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
              Descanso mínimo entre bandas (h)
              {numField(rules.minRestHoursBetweenBands, (n) => patch({ minRestHoursBetweenBands: n }), 4, 16)}
            </label>
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
              Tope horas trabajo seguidas (alerta)
              {numField(rules.maxConsecutiveWorkHours, (n) => patch({ maxConsecutiveWorkHours: n }), 24, 96)}
            </label>
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
              Tolerancia gap horas vs SLA (±h)
              {numField(rules.slaHoursTolerance, (n) => patch({ slaHoursTolerance: n }), 0, 48)}
            </label>
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
              Cobertura mínima OK (0–1)
              <input
                type="number"
                min={0.9}
                max={1}
                step={0.01}
                value={rules.coverageRatioMin}
                onChange={(e) => patch({ coverageRatioMin: Number(e.target.value) })}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </label>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 space-y-4">
          <div className="flex items-center gap-2 text-slate-800 font-bold">
            <Shield className="h-5 w-5 text-emerald-600" />
            Solver VPLAN
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
              Iteraciones máx. cierre SLA
              {numField(rules.solverMaxIterations, (n) => patch({ solverMaxIterations: n }), 4, 96)}
            </label>
            <label className="flex items-center gap-3 pt-6 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={rules.protectCoverageOnEnforce}
                onChange={(e) => patch({ protectCoverageOnEnforce: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600"
              />
              Proteger cobertura al aplicar CCT/bandas
            </label>
          </div>
          <p className="text-xs text-slate-500">
            Si está activo, no convierte turnos a F cuando eso abriría un slot SLA descubierto.
          </p>
        </section>
      </div>

      <section className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-slate-800 font-bold">
            <Layers className="h-5 w-5 text-indigo-600" />
            Ciclos CCT habilitados
          </div>
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500 flex items-center gap-2">
            Ciclo por defecto
            <select
              value={rules.defaultCycle}
              onChange={(e) => patch({ defaultCycle: e.target.value as PlanningCycleKey })}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium shadow-sm"
            >
              {PLANNING_CYCLE_KEYS.filter((k) => rules.cycles[k].enabled).map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4">Ciclo</th>
                <th className="py-2 pr-4">Activo</th>
                <th className="py-2 pr-4">Días trab</th>
                <th className="py-2 pr-4">Días F</th>
                <th className="py-2">Hs turno</th>
              </tr>
            </thead>
            <tbody>
              {PLANNING_CYCLE_KEYS.map((key) => (
                <tr key={key} className="border-b border-slate-50">
                  <td className="py-3 pr-4 font-bold text-slate-800">{key}</td>
                  <td className="py-3 pr-4">
                    <input
                      type="checkbox"
                      checked={rules.cycles[key].enabled}
                      onChange={(e) => patchCycle(key, { enabled: e.target.checked })}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                    />
                  </td>
                  <td className="py-3 pr-4 w-24">
                    {numField(
                      rules.cycles[key].workDays,
                      (n) => patchCycle(key, { workDays: n }),
                      1,
                      12,
                    )}
                  </td>
                  <td className="py-3 pr-4 w-24">
                    {numField(
                      rules.cycles[key].restDays,
                      (n) => patchCycle(key, { restDays: n }),
                      1,
                      7,
                    )}
                  </td>
                  <td className="py-3 w-28">
                    <select
                      value={rules.cycles[key].shiftHours}
                      onChange={(e) => patchCycle(key, { shiftHours: Number(e.target.value) as 8 | 12 })}
                      className="w-full rounded-xl border border-slate-200 px-2 py-1.5 text-sm"
                    >
                      <option value={8}>8 h</option>
                      <option value={12}>12 h</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex flex-wrap gap-3 justify-end">
        <button
          type="button"
          onClick={handleResetDefaults}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-600 shadow-sm hover:bg-slate-50 active:scale-95 transition"
        >
          <RotateCcw className="h-4 w-4" />
          Restaurar defaults
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg hover:bg-indigo-700 disabled:opacity-50 active:scale-95 transition"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Guardar reglas
        </button>
      </div>

      {rules.updatedAt && (
        <p className="text-xs text-slate-400 text-right flex items-center justify-end gap-1">
          <Clock className="h-3 w-3" />
          Última actualización: {new Date(rules.updatedAt).toLocaleString('es-AR')}
          {rules.updatedBy ? ` · ${rules.updatedBy}` : ''}
        </p>
      )}
    </div>
  );
}
