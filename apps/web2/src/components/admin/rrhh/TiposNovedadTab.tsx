import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus, Edit2, Save, X, RotateCcw, Ban, CheckCircle, Tag, Clock,
} from 'lucide-react';
import { novedadTypeService } from '@/services/novedadTypeService';
import type { NovedadType } from '@/lib/rrhh/novedadTypes';
import { ABSENCE_CODE_OPTIONS, type AbsenceCode } from '@/lib/rrhh/novedadTypeCodes';

type Props = {
  empresaId: string;
  canEdit: boolean;
  onToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  onTypesChanged?: (types: NovedadType[]) => void;
};

type FormState = {
  label: string;
  code: AbsenceCode;
  defaultDays: string;
  requiresAuth: boolean;
  medicalVerification: boolean;
  sortOrder: string;
};

const emptyForm = (): FormState => ({
  label: '',
  code: 'L',
  defaultDays: '',
  requiresAuth: true,
  medicalVerification: false,
  sortOrder: '500',
});

export function TiposNovedadTab({ empresaId, canEdit, onToast, onTypesChanged }: Props) {
  const [types, setTypes] = useState<NovedadType[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [showInactive, setShowInactive] = useState(false);

  const load = async () => {
    if (!empresaId) return;
    setLoading(true);
    try {
      const rows = await novedadTypeService.ensureSeeded(empresaId);
      setTypes(rows);
      onTypesChanged?.(rows);
    } catch (e) {
      console.error('[tipos_novedad]', e);
      onToast('No se pudieron cargar los tipos de novedad', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId]);

  const visible = useMemo(
    () => types.filter((t) => showInactive || t.status === 'ACTIVE'),
    [types, showInactive],
  );

  const openNew = () => {
    setIsNew(true);
    setEditingId(null);
    setForm(emptyForm());
  };

  const openEdit = (t: NovedadType) => {
    if (!t.id) return;
    setIsNew(false);
    setEditingId(t.id);
    setForm({
      label: t.label,
      code: t.code,
      defaultDays: t.defaultDays != null ? String(t.defaultDays) : '',
      requiresAuth: t.requiresAuth,
      medicalVerification: t.medicalVerification,
      sortOrder: String(t.sortOrder ?? 500),
    });
  };

  const cancelForm = () => {
    setIsNew(false);
    setEditingId(null);
    setForm(emptyForm());
  };

  const parseDays = (): number | null => {
    const raw = form.defaultDays.trim();
    if (!raw) return null;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) return null;
    return n;
  };

  const handleSave = async () => {
    const label = form.label.trim();
    if (!label) {
      onToast('Ingresá el nombre del tipo', 'error');
      return;
    }
    const dup = types.find(
      (t) =>
        t.label.toLowerCase() === label.toLowerCase() &&
        t.id !== editingId &&
        t.status === 'ACTIVE',
    );
    if (dup) {
      onToast('Ya existe un tipo activo con ese nombre', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        label,
        code: form.code,
        defaultDays: parseDays(),
        requiresAuth: form.requiresAuth,
        medicalVerification: form.medicalVerification,
        sortOrder: parseInt(form.sortOrder, 10) || 500,
      };
      if (isNew) {
        await novedadTypeService.create(empresaId, payload);
        onToast('Tipo de novedad creado', 'success');
      } else if (editingId) {
        await novedadTypeService.update(editingId, payload);
        onToast('Tipo de novedad actualizado', 'success');
      }
      cancelForm();
      await load();
    } catch (e) {
      console.error(e);
      onToast('Error al guardar el tipo', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (t: NovedadType) => {
    if (!t.id) return;
    try {
      await novedadTypeService.deactivate(t.id);
      onToast(`Desactivado: ${t.label}`, 'success');
      await load();
    } catch (e) {
      onToast('No se pudo desactivar', 'error');
    }
  };

  const handleReactivate = async (t: NovedadType) => {
    if (!t.id) return;
    try {
      await novedadTypeService.reactivate(t.id);
      onToast(`Reactivado: ${t.label}`, 'success');
      await load();
    } catch (e) {
      onToast('No se pudo reactivar', 'error');
    }
  };

  const inputClass =
    'w-full p-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-400';
  const labelClass = 'text-[10px] font-black uppercase text-slate-500 block mb-1 ml-1';

  return (
    <div className="flex-1 flex flex-col md:flex-row gap-6 overflow-hidden">
      {/* Formulario */}
      <div className="w-full md:w-1/3 bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 p-6 overflow-y-auto shadow-sm">
        <h3 className="text-lg font-black text-slate-900 dark:text-white uppercase mb-1 flex items-center gap-2">
          {isNew || editingId ? <Edit2 size={18} /> : <Tag size={18} />}
          {isNew ? 'Nuevo tipo' : editingId ? 'Editar tipo' : 'Tipos de novedad'}
        </h3>
        <p className="text-[11px] text-slate-400 font-bold mb-4">
          Parametrizá días por defecto (CCT/convenio). Al cargar una novedad se usan estos valores. No altera ausencias ya cargadas.
        </p>

        {!isNew && !editingId ? (
          canEdit && (
            <button
              type="button"
              onClick={openNew}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl font-black text-xs uppercase flex items-center justify-center gap-2 shadow-sm"
            >
              <Plus size={14} /> Crear tipo
            </button>
          )
        ) : (
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Nombre</label>
              <input
                className={inputClass}
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="Ej. MAVIC"
                disabled={!canEdit}
              />
            </div>
            <div>
              <label className={labelClass}>Código grilla</label>
              <select
                className={inputClass}
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value as AbsenceCode }))}
                disabled={!canEdit}
              >
                {ABSENCE_CODE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Días por defecto</label>
              <div className="relative">
                <Clock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="number"
                  min={1}
                  className={`${inputClass} pl-9`}
                  value={form.defaultDays}
                  onChange={(e) => setForm((f) => ({ ...f, defaultDays: e.target.value }))}
                  placeholder="Vacío = sin autocompletar"
                  disabled={!canEdit}
                />
              </div>
              <p className="text-[9px] text-slate-400 font-bold mt-1 ml-1">
                Ej. Matrimonio 10, Mudanza 2, MAVIC 1. Dejá vacío si el usuario define el rango a mano.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.requiresAuth}
                  onChange={(e) => setForm((f) => ({ ...f, requiresAuth: e.target.checked }))}
                  disabled={!canEdit}
                />
                Requiere autorización
              </label>
              <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.medicalVerification}
                  onChange={(e) => setForm((f) => ({ ...f, medicalVerification: e.target.checked }))}
                  disabled={!canEdit}
                />
                Verificación médica
              </label>
            </div>
            <div>
              <label className={labelClass}>Orden</label>
              <input
                type="number"
                className={inputClass}
                value={form.sortOrder}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
                disabled={!canEdit}
              />
            </div>
            {canEdit && (
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl font-black text-xs uppercase flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Save size={14} /> {saving ? 'Guardando…' : 'Guardar'}
                </button>
                <button
                  type="button"
                  onClick={cancelForm}
                  className="px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-500 font-black text-xs uppercase hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Listado */}
      <div className="flex-1 bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 p-6 overflow-hidden flex flex-col shadow-sm">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h3 className="text-sm font-black uppercase text-slate-700 dark:text-white">
            Catálogo ({visible.length})
          </h3>
          <label className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Ver inactivos
          </label>
        </div>

        {loading ? (
          <p className="text-sm text-slate-400 font-bold py-8 text-center">Cargando tipos…</p>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar">
            {visible.map((t) => (
              <div
                key={t.id || t.label}
                className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                  t.status === 'ACTIVE'
                    ? 'border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30'
                    : 'border-slate-100 dark:border-slate-700 opacity-60 bg-slate-100/50'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-black text-sm text-slate-800 dark:text-white uppercase truncate">
                      {t.label}
                    </span>
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600">
                      {t.code}
                    </span>
                    {t.isSystem && (
                      <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-500 uppercase">
                        Sistema
                      </span>
                    )}
                    {t.status === 'INACTIVE' && (
                      <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-600 uppercase">
                        Inactivo
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                    {t.defaultDays != null ? `${t.defaultDays} día${t.defaultDays !== 1 ? 's' : ''} por defecto` : 'Sin días por defecto'}
                    {t.requiresAuth ? ' · Auth' : ''}
                    {t.medicalVerification ? ' · Médica' : ''}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEdit(t)}
                      className="p-2 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100"
                      title="Editar"
                    >
                      <Edit2 size={12} />
                    </button>
                    {t.status === 'ACTIVE' ? (
                      <button
                        type="button"
                        onClick={() => handleDeactivate(t)}
                        className="p-2 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100"
                        title="Desactivar"
                      >
                        <Ban size={12} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleReactivate(t)}
                        className="p-2 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                        title="Reactivar"
                      >
                        <RotateCcw size={12} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
            {visible.length === 0 && (
              <p className="text-sm text-slate-400 font-bold py-8 text-center">Sin tipos para mostrar.</p>
            )}
          </div>
        )}
        <p className="text-[9px] text-slate-400 font-bold mt-3 flex items-center gap-1">
          <CheckCircle size={10} /> Las novedades ya cargadas no se modifican al editar estos parámetros.
        </p>
      </div>
    </div>
  );
}
