import React, { useState } from 'react';
import { Building2, Plus, Save, Play, CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronUp, Bot, EyeOff, Eye, Trash2, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { migrarEmpresa, guardarEmpresa, desactivarEmpresa, activarEmpresa, eliminarEmpresaYDatos, type ProgresoMigracion, type ProgresoEliminacion } from '@/lib/multiempresa';
import { toast } from 'sonner';

export default function EmpresasTab() {
  const { isSuperAdmin } = useAuth();
  const { empresa, empresas, empresaId, switchEmpresa } = useEmpresa();

  // Formulario nueva empresa
  const [form, setForm] = useState({ name: '', cuit: '', direccion: '', plan: 'standard' });
  const [showNueva, setShowNueva] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Formulario edición empresa activa
  const [editForm, setEditForm] = useState({ name: '', cuit: '', direccion: '' });
  const [guardandoEdit, setGuardandoEdit] = useState(false);

  React.useEffect(() => {
    setEditForm({
      name: empresa?.name || '',
      cuit: (empresa as any)?.cuit || '',
      direccion: (empresa as any)?.direccion || '',
    });
  }, [empresa?.id, empresa?.name, (empresa as any)?.cuit, (empresa as any)?.direccion]);

  const handleGuardarActual = async () => {
    if (!empresa) return;
    if (!editForm.name.trim()) return toast.error('El nombre es obligatorio');
    setGuardandoEdit(true);
    try {
      await guardarEmpresa(empresa.id, {
        name: editForm.name.trim(),
        cuit: editForm.cuit.trim(),
        direccion: editForm.direccion.trim(),
      });
      toast.success('Empresa actualizada');
    } catch {
      toast.error('Error al guardar');
    } finally {
      setGuardandoEdit(false);
    }
  };

  // Color de empresa
  const DEFAULT_COLOR = '#6366f1';
  const COLOR_PRESETS = ['#6366f1','#e53e3e','#0ea5e9','#10b981','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#f97316','#64748b'];
  const [colorForm, setColorForm] = useState(empresa?.primaryColor || DEFAULT_COLOR);
  const [guardandoColor, setGuardandoColor] = useState(false);

  React.useEffect(() => {
    setColorForm(empresa?.primaryColor || DEFAULT_COLOR);
  }, [empresa?.id, empresa?.primaryColor]);

  const handleGuardarColor = async () => {
    if (!empresa) return;
    setGuardandoColor(true);
    try {
      await guardarEmpresa(empresa.id, { primaryColor: colorForm } as any);
      toast.success('Color actualizado');
    } catch {
      toast.error('Error al guardar');
    } finally {
      setGuardandoColor(false);
    }
  };

  // Asistente IA
  const [guardandoAsistente, setGuardandoAsistente] = useState(false);
  const asistentActivo = empresa?.assistantEnabled !== false;

  const handleToggleAsistente = async () => {
    if (!empresa) return;
    setGuardandoAsistente(true);
    try {
      await guardarEmpresa(empresa.id, { assistantEnabled: !asistentActivo } as any);
      toast.success(asistentActivo ? 'Asistente desactivado' : 'Asistente activado');
    } catch {
      toast.error('Error al guardar');
    } finally {
      setGuardandoAsistente(false);
    }
  };

  // Mostrar inactivas
  const [mostrarInactivas, setMostrarInactivas] = useState(false);

  // Toggle activo/inactivo por empresa
  const [toggling, setToggling] = useState<string | null>(null);
  const handleToggleActivo = async (e: typeof empresas[0]) => {
    setToggling(e.id);
    try {
      if (e.active === false) { await activarEmpresa(e.id); toast.success(`"${e.name}" reactivada`); }
      else { await desactivarEmpresa(e.id); toast.success(`"${e.name}" desactivada`); }
    } catch { toast.error('Error al cambiar estado'); }
    finally { setToggling(null); }
  };

  // Modal eliminación
  type DeleteStep = 'idle' | 'confirm1' | 'confirm2' | 'deleting';
  const [deleteTarget, setDeleteTarget] = useState<typeof empresas[0] | null>(null);
  const [deleteStep, setDeleteStep] = useState<DeleteStep>('idle');
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [deleteProgreso, setDeleteProgreso] = useState<ProgresoEliminacion | null>(null);

  const abrirEliminar = (e: typeof empresas[0]) => {
    setDeleteTarget(e);
    setDeleteConfirmInput('');
    setDeleteProgreso(null);
    setDeleteStep('confirm1');
  };
  const cerrarEliminar = () => { setDeleteStep('idle'); setDeleteTarget(null); setDeleteConfirmInput(''); setDeleteProgreso(null); };

  const handleEliminar = async () => {
    if (!deleteTarget) return;
    setDeleteStep('deleting');
    try {
      // Cambiar empresa activa ANTES de borrar para que el listener se desuscriba
      // antes de recibir la notificación de eliminación (evita la auto-recreación).
      if (empresaId === deleteTarget.id) switchEmpresa('bacarsa');
      await eliminarEmpresaYDatos(deleteTarget.id, p => setDeleteProgreso(p));
      toast.success(`Empresa "${deleteTarget.name}" y todos sus datos eliminados`);
      cerrarEliminar();
    } catch (err: any) {
      toast.error(err?.message || 'Error al eliminar');
      cerrarEliminar();
    }
  };

  // Migración
  const [progreso, setProgreso] = useState<ProgresoMigracion | null>(null);
  const [migrando, setMigrando] = useState(false);

  // ── Crear nueva empresa ─────────────────────────────────────────────────────
  const handleCrearEmpresa = async () => {
    if (!form.name.trim()) return toast.error('El nombre es obligatorio');
    const id = form.name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    if (!id) return toast.error('Nombre inválido');
    setGuardando(true);
    try {
      await guardarEmpresa(id, { name: form.name.trim(), cuit: form.cuit, direccion: form.direccion, plan: form.plan });
      toast.success(`Empresa "${form.name}" creada (ID: ${id})`);
      setForm({ name: '', cuit: '', direccion: '', plan: 'standard' });
      setShowNueva(false);
    } catch {
      toast.error('Error al crear empresa');
    } finally {
      setGuardando(false);
    }
  };

  // ── Migración ───────────────────────────────────────────────────────────────
  const handleMigrar = async () => {
    if (!confirm(`¿Migrar todos los datos existentes a la empresa "${empresa?.name}" (${empresaId})?\n\nEsto agrega el campo empresaId a todos los documentos sin él. Es una operación segura y no elimina datos.`)) return;
    setMigrando(true);
    setProgreso(null);
    try {
      await migrarEmpresa(empresaId, p => setProgreso(p));
    } catch {
      // El error ya está en progreso.error
    } finally {
      setMigrando(false);
    }
  };

  const migracionCompleta = (empresa as any)?.migracionCompleta === true;
  const porcentaje = progreso && progreso.total > 0
    ? Math.round((progreso.procesados / progreso.total) * 100)
    : progreso?.completa ? 100 : 0;

  return (
    <div className="space-y-6">

      {/* ── Lista de empresas (solo superadmin) ── */}
      {isSuperAdmin && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Building2 size={18} className="text-indigo-600" />
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">Empresas registradas</h3>
            </div>
            <button
              onClick={() => setShowNueva(s => !s)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-black hover:bg-indigo-700 transition-colors"
            >
              <Plus size={13} /> Nueva empresa
              {showNueva ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          </div>

          {/* Filtro inactivas */}
          <div className="flex items-center gap-2 mb-3">
            <button onClick={() => setMostrarInactivas(v => !v)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black border transition-colors ${mostrarInactivas ? 'bg-slate-700 text-white border-slate-600' : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'}`}>
              {mostrarInactivas ? <Eye size={11} /> : <EyeOff size={11} />}
              {mostrarInactivas ? 'Ocultar inactivas' : 'Mostrar inactivas'}
            </button>
          </div>

          {/* Lista */}
          <div className="space-y-2 mb-4">
            {empresas.length === 0 && (
              <p className="text-sm text-slate-400 font-medium py-4 text-center">Sin empresas registradas aún</p>
            )}
            {empresas
              .filter(e => mostrarInactivas || e.active !== false)
              .map(e => (
              <div key={e.id}
                className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                  e.active === false ? 'opacity-50 bg-slate-50 border-slate-200' :
                  e.id === empresaId ? 'bg-indigo-50 border-indigo-300 shadow-sm' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex items-center gap-3 cursor-pointer flex-1 min-w-0" onClick={() => e.active !== false && switchEmpresa(e.id)}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm text-white shrink-0"
                    style={{ backgroundColor: (e as any).primaryColor || '#94a3b8' }}>
                    {(e.name || e.id || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-800 truncate">{e.name || e.id}</p>
                    <p className="text-[10px] text-slate-400 font-mono">{e.id}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  {(e as any).migracionCompleta && (
                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full hidden sm:flex items-center gap-1">
                      <CheckCircle2 size={10} /> Migrada
                    </span>
                  )}
                  {e.id === empresaId && e.active !== false && (
                    <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-full">Activa</span>
                  )}
                  {e.active === false && (
                    <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">Inactiva</span>
                  )}
                  {/* Toggle activo/inactivo — bloqueado si es la empresa activa */}
                  {e.id !== empresaId && (
                    <button onClick={() => handleToggleActivo(e)} disabled={toggling === e.id}
                      title={e.active === false ? 'Reactivar empresa' : 'Desactivar empresa'}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors disabled:opacity-40">
                      {toggling === e.id ? <Loader2 size={14} className="animate-spin" /> : e.active === false ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                  )}
                  {/* Eliminar — bloqueado solo si es la empresa activa */}
                  {e.id !== empresaId && (
                    <button onClick={() => abrirEliminar(e)}
                      title="Eliminar empresa y todos sus datos"
                      className="p-1.5 rounded-lg text-rose-400 hover:text-rose-600 hover:bg-rose-50 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Formulario nueva empresa */}
          {showNueva && (
            <div className="border-t border-slate-200 pt-4 mt-4 space-y-3">
              <p className="text-xs font-black text-slate-500 uppercase tracking-wide">Nueva empresa</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Nombre *</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="Ej: Empresa X SA" />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">CUIT</label>
                  <input value={form.cuit} onChange={e => setForm(f => ({ ...f, cuit: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="30-00000000-0" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Dirección</label>
                  <input value={form.direccion} onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="Calle 123, Ciudad" />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowNueva(false)} className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors">Cancelar</button>
                <button onClick={handleCrearEmpresa} disabled={guardando}
                  className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-indigo-700 disabled:opacity-60 transition-colors">
                  {guardando ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Crear empresa
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Datos de empresa activa ── */}
      {empresa && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Building2 size={18} className="text-indigo-600" />
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">Datos de empresa</h3>
          </div>
          <p className="text-xs text-slate-500 font-medium mb-5">Editá el nombre y los datos de la empresa activa.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="md:col-span-2">
              <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Nombre *</label>
              <input
                value={editForm.name}
                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="Ej: Bacar SA"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">CUIT</label>
              <input
                value={editForm.cuit}
                onChange={e => setEditForm(f => ({ ...f, cuit: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="30-00000000-0"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Dirección</label>
              <input
                value={editForm.direccion}
                onChange={e => setEditForm(f => ({ ...f, direccion: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="Calle 123, Ciudad"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleGuardarActual}
              disabled={guardandoEdit}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              {guardandoEdit ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Guardar cambios
            </button>
          </div>
        </div>
      )}

      {/* ── Color de empresa ── */}
      {empresa && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-4 h-4 rounded-full border border-slate-200 shrink-0" style={{ backgroundColor: colorForm }} />
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">Color de empresa</h3>
          </div>
          <p className="text-xs text-slate-500 font-medium mb-5">
            El sidebar y los elementos de navegación adoptarán este color para la empresa activa.
          </p>

          <div className="flex flex-wrap items-center gap-3 mb-5">
            {/* Picker nativo */}
            <input
              type="color"
              value={colorForm}
              onChange={e => setColorForm(e.target.value)}
              className="w-10 h-10 rounded-xl cursor-pointer border border-slate-200 p-0.5 shrink-0"
              title="Elegir color personalizado"
            />
            {/* Presets */}
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map(c => (
                <button
                  key={c}
                  onClick={() => setColorForm(c)}
                  className="w-8 h-8 rounded-lg transition-all border-2"
                  style={{ backgroundColor: c, borderColor: colorForm === c ? '#0f172a' : 'transparent' }}
                  title={c}
                />
              ))}
            </div>
            <button
              onClick={handleGuardarColor}
              disabled={guardandoColor}
              className="ml-auto flex items-center gap-1.5 px-4 py-2 text-white rounded-xl text-xs font-black disabled:opacity-60 transition-colors"
              style={{ backgroundColor: colorForm }}
            >
              {guardandoColor ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              Guardar
            </button>
          </div>

          {/* Preview */}
          <div className="flex items-center gap-3 p-3 rounded-xl border" style={{ backgroundColor: colorForm + '18', borderColor: colorForm + '40' }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-black text-base shrink-0" style={{ backgroundColor: colorForm }}>
              {(empresa.name || empresa.id || '?').charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-black" style={{ color: colorForm }}>{empresa.name || empresa.id}</p>
              <p className="text-[11px] text-slate-400">Sidebar y navegación en este color</p>
            </div>
            <div className="ml-auto flex gap-1">
              <div className="w-3 h-6 rounded" style={{ backgroundColor: colorForm }} />
              <div className="w-3 h-6 rounded opacity-60" style={{ backgroundColor: colorForm }} />
              <div className="w-3 h-6 rounded opacity-30" style={{ backgroundColor: colorForm }} />
            </div>
          </div>
        </div>
      )}

      {/* ── Asistente IA ── */}
      {empresa && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Bot size={18} className="text-indigo-600" />
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">Asistente IA</h3>
          </div>
          <p className="text-xs text-slate-500 font-medium mb-5">
            Habilitá o deshabilitá el globo flotante del asistente COSP para esta empresa.
          </p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-slate-700">
                {asistentActivo ? 'Asistente activo' : 'Asistente desactivado'}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {asistentActivo ? 'El globo de chat aparece en todas las pantallas.' : 'El globo no aparece para esta empresa.'}
              </p>
            </div>
            <button
              onClick={handleToggleAsistente}
              disabled={guardandoAsistente}
              className={`relative inline-flex h-7 w-13 items-center rounded-full transition-colors focus:outline-none disabled:opacity-60 ${asistentActivo ? 'bg-indigo-600' : 'bg-slate-300'}`}
              style={{ width: '3.25rem' }}
              title={asistentActivo ? 'Desactivar asistente' : 'Activar asistente'}
            >
              {guardandoAsistente
                ? <Loader2 size={12} className="absolute left-1/2 -translate-x-1/2 animate-spin text-white" />
                : <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${asistentActivo ? 'translate-x-[1.625rem]' : 'translate-x-[0.25rem]'}`} />
              }
            </button>
          </div>
        </div>
      )}

      {/* ── Migración de datos ── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <Play size={18} className={migracionCompleta ? 'text-emerald-500' : 'text-amber-500'} />
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">
            Migración de datos
          </h3>
          {migracionCompleta && (
            <span className="ml-auto text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1">
              <CheckCircle2 size={10} /> Completada el {(empresa as any)?.migracionFecha?.slice(0, 10)}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 font-medium mb-4 leading-relaxed">
          Asigna el campo <code className="bg-slate-100 px-1 rounded font-mono">empresaId: "{empresaId}"</code> a todos los documentos existentes que aún no lo tienen. Es una operación <strong>segura y reversible</strong> — no elimina ningún dato.
        </p>

        {/* Progreso */}
        {progreso && (
          <div className="mb-4 p-3 rounded-xl border bg-slate-50 space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-slate-600">
              <span>{progreso.mensaje}</span>
              <span>{porcentaje}%</span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${progreso.completa ? 'bg-emerald-500' : progreso.error ? 'bg-rose-500' : 'bg-indigo-500'}`}
                style={{ width: `${porcentaje}%` }}
              />
            </div>
            {progreso.error && (
              <p className="text-xs text-rose-600 font-bold flex items-center gap-1"><AlertCircle size={12} />{progreso.error}</p>
            )}
            {progreso.completa && (
              <p className="text-xs text-emerald-600 font-bold flex items-center gap-1"><CheckCircle2 size={12} /> ¡Listo! Todos los datos pertenecen ahora a <strong>{empresa?.name}</strong>.</p>
            )}
          </div>
        )}

        <button
          onClick={handleMigrar}
          disabled={migrando || migracionCompleta}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black transition-colors ${
            migracionCompleta
              ? 'bg-slate-100 text-slate-400 cursor-default'
              : 'bg-amber-500 hover:bg-amber-600 text-white shadow-sm'
          }`}
        >
          {migrando ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
          {migracionCompleta ? 'Migración ya completada' : migrando ? 'Migrando...' : `Migrar datos a "${empresa?.name}"`}
        </button>
      </div>

      {/* ── Asignar usuarios a empresa (info) ── */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
        <p className="text-xs font-black text-blue-700 uppercase tracking-wide mb-1">¿Cómo asignar usuarios a una empresa?</p>
        <p className="text-xs text-blue-600 font-medium leading-relaxed">
          En la pestaña <strong>Usuarios Admin</strong>, cada usuario puede tener el campo <code className="bg-blue-100 px-1 rounded font-mono">empresaId</code> que determina a qué empresa pertenece.
          Los usuarios sin <code className="font-mono bg-blue-100 px-1 rounded">empresaId</code> quedan en <strong>"bacarsa"</strong> por defecto.
          El <strong>SuperAdmin</strong> puede ver y cambiar entre todas las empresas desde el selector en el topbar.
        </p>
      </div>

      {/* ── Modal eliminación ── */}
      {deleteStep !== 'idle' && deleteTarget && (
        <div className="fixed inset-0 z-[9990] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">

            {/* Step 1: advertencia */}
            {deleteStep === 'confirm1' && (
              <>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center shrink-0">
                    <AlertTriangle size={20} className="text-rose-600" />
                  </div>
                  <div>
                    <p className="text-sm font-black text-slate-800">Eliminar empresa</p>
                    <p className="text-xs text-slate-500">Esta acción <strong>no se puede deshacer</strong></p>
                  </div>
                </div>
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 space-y-1">
                  <p className="text-xs font-black text-rose-700 uppercase tracking-wide mb-2">Se eliminará permanentemente:</p>
                  {['Empresa: ' + deleteTarget.name, 'Turnos', 'Empleados', 'Clientes', 'Servicios SLA', 'Ausencias y novedades', 'Planificaciones'].map(item => (
                    <p key={item} className="text-xs text-rose-600 flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-rose-400 shrink-0" /> {item}
                    </p>
                  ))}
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={cerrarEliminar} className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700">Cancelar</button>
                  <button onClick={() => setDeleteStep('confirm2')}
                    className="px-4 py-2 bg-rose-600 text-white rounded-xl text-xs font-black hover:bg-rose-700">
                    Entiendo, continuar
                  </button>
                </div>
              </>
            )}

            {/* Step 2: confirmar escribiendo el ID */}
            {deleteStep === 'confirm2' && (
              <>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center shrink-0">
                    <Trash2 size={20} className="text-rose-600" />
                  </div>
                  <div>
                    <p className="text-sm font-black text-slate-800">Confirmación final</p>
                    <p className="text-xs text-slate-500">Segunda validación requerida</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-slate-600 mb-2">
                    Escribí el ID de la empresa para confirmar: <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono font-bold text-rose-700">{deleteTarget.id}</code>
                  </p>
                  <input
                    value={deleteConfirmInput}
                    onChange={e => setDeleteConfirmInput(e.target.value)}
                    placeholder={`Escribí: ${deleteTarget.id}`}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-rose-400"
                    autoFocus
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={cerrarEliminar} className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700">Cancelar</button>
                  <button
                    onClick={handleEliminar}
                    disabled={deleteConfirmInput.trim() !== deleteTarget.id}
                    className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 text-white rounded-xl text-xs font-black hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Trash2 size={13} /> Eliminar todo
                  </button>
                </div>
              </>
            )}

            {/* Step 3: progreso */}
            {deleteStep === 'deleting' && (
              <>
                <div className="flex items-center gap-3">
                  <Loader2 size={22} className="animate-spin text-rose-500 shrink-0" />
                  <p className="text-sm font-black text-slate-800">Eliminando datos...</p>
                </div>
                {deleteProgreso && (
                  <div className="bg-slate-50 rounded-xl p-3 space-y-1">
                    <p className="text-xs text-slate-600 font-medium">Colección: <strong>{deleteProgreso.coleccion}</strong></p>
                    <p className="text-xs text-slate-500">{deleteProgreso.eliminados} documentos eliminados</p>
                  </div>
                )}
                <p className="text-[10px] text-slate-400 text-center">No cerres esta ventana</p>
              </>
            )}

          </div>
        </div>
      )}

    </div>
  );
}
