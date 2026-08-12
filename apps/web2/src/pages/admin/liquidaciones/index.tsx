import React, { useState, useMemo, useCallback, useEffect } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { PageShell, PageHeader, ContentCard, MetricCard, TabBar } from '@/components/ui';
import {
    ClipboardList, RefreshCw, Download, AlertTriangle, ChevronDown,
    ChevronUp, CheckCircle2, Edit3, Trash2, Save, X, Moon, Sun,
    Clock, Users, CalendarDays, Loader2, Key, Plus, Copy, ShieldOff,
} from 'lucide-react';
import { useEmpresa } from '@/context/EmpresaContext';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/router';
import {
    useLiquidaciones, applyAjuste, buildLiquidacionCsv,
    EmployeeLiquidacion, AjusteAdj, AjusteLiquidacion,
} from '@/hooks/useLiquidaciones';
import {
    getCctPayrollPeriodByOffset, formatCctPeriodLabel, formatCctPeriodRangeDisplay,
} from '@/lib/cctPayrollPeriod';
import { collection, query, where, onSnapshot, Timestamp } from 'firebase/firestore';
import { db, app } from '@/lib/firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';

// ─── Helpers ────────────────────────────────────────────────────────────────

function pad2(n: number) { return String(n).padStart(2, '0'); }
function fmtH(v: number) { return v === 0 ? '—' : v.toFixed(1); }
function fmtD(v: number) { return v === 0 ? '—' : String(v); }

interface CycleOption {
    cycleId: string;
    label: string;
    range: string;
}

function buildCycleOptions(): CycleOption[] {
    return Array.from({ length: 14 }, (_, i) => {
        const period = getCctPayrollPeriodByOffset(i);
        const cycleId = `${period.closingYear}-${pad2(period.closingMonth)}`;
        return {
            cycleId,
            label: formatCctPeriodLabel(period),
            range: formatCctPeriodRangeDisplay(period),
        };
    });
}

// ─── Formulario de corrección ─────────────────────────────────────────────────

interface CorrectionFormProps {
    item: EmployeeLiquidacion;
    ajuste: AjusteLiquidacion | undefined;
    hoursMode: 'planned' | 'real';
    onSave: (adj: AjusteAdj, nota: string) => Promise<void>;
    onDelete: () => Promise<void>;
    onClose: () => void;
}

const EMPTY_ADJ: AjusteAdj = {};

function CorrectionForm({ item, ajuste, hoursMode, onSave, onDelete, onClose }: CorrectionFormProps) {
    const modeLabel = hoursMode === 'planned' ? 'Planif.' : 'Reales';
    const [saving, setSaving] = useState(false);
    const [nota, setNota] = useState(ajuste?.nota || '');
    const [adj, setAdj] = useState<Record<string, string>>(() => {
        const a = ajuste?.adj || {};
        const out: Record<string, string> = {};
        Object.entries(a).forEach(([k, v]) => { if (v !== undefined) out[k] = String(v); });
        return out;
    });

    const setField = (k: string, v: string) => setAdj(prev => ({ ...prev, [k]: v }));
    const clearField = (k: string) => setAdj(prev => { const n = { ...prev }; delete n[k]; return n; });

    const buildAdj = (): AjusteAdj => {
        const result: AjusteAdj = {};
        const trySet = (k: keyof AjusteAdj) => {
            const v = adj[k];
            if (v !== undefined && v !== '') (result as any)[k] = parseFloat(v) || 0;
        };
        ['hsReales','diurnas','nocturnas','al100FT','plusFeriado',
         'vacacionesDias','enfermedadDias','art','licenciaEspecialDias',
         'permisoGremialDias','injustificadaDias','otrosDias'].forEach(k => trySet(k as keyof AjusteAdj));
        return result;
    };

    const handleSave = async () => {
        setSaving(true);
        try { await onSave(buildAdj(), nota); onClose(); }
        finally { setSaving(false); }
    };
    const handleDelete = async () => {
        setSaving(true);
        try { await onDelete(); onClose(); }
        finally { setSaving(false); }
    };

    const acumulado = item.acumulado;
    const nov = item.novedadesRRHH;

    type FieldDef = { key: keyof AjusteAdj; label: string; original: number; isInt?: boolean };
    const hoursFields: FieldDef[] = [
        { key: 'hsReales', label: `Hs ${modeLabel}`, original: acumulado.hsReales },
        { key: 'diurnas', label: 'Diurnas', original: acumulado.diurnas },
        { key: 'nocturnas', label: 'Nocturnas', original: acumulado.nocturnas },
        { key: 'al100FT', label: 'FT 100%', original: acumulado.al100FT },
        { key: 'plusFeriado', label: 'Plus Feriado', original: acumulado.plusFeriado },
    ];
    const novFields: FieldDef[] = [
        { key: 'vacacionesDias', label: 'Vacaciones', original: nov.vacacionesDias, isInt: true },
        { key: 'enfermedadDias', label: 'Enfermedad', original: nov.enfermedadDias, isInt: true },
        { key: 'art', label: 'ART', original: nov.art, isInt: true },
        { key: 'licenciaEspecialDias', label: 'Lic. Especial', original: nov.licenciaEspecialDias, isInt: true },
        { key: 'permisoGremialDias', label: 'P. Gremial', original: nov.permisoGremialDias, isInt: true },
        { key: 'injustificadaDias', label: 'Injustificadas', original: nov.injustificadaDias, isInt: true },
        { key: 'otrosDias', label: 'Otros', original: nov.otrosDias, isInt: true },
    ];

    const FieldRow = ({ f }: { f: FieldDef }) => {
        const hasOverride = adj[f.key] !== undefined && adj[f.key] !== '';
        return (
            <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wide w-28 shrink-0" style={{ color: 'var(--txt3)' }}>
                    {f.label}
                </span>
                <span className="text-xs tabular-nums w-12 text-right" style={{ color: 'var(--txt3)' }}>
                    {f.isInt ? fmtD(f.original) : fmtH(f.original)}
                </span>
                <span style={{ color: 'var(--txt3)' }}>→</span>
                <input
                    type="number"
                    step={f.isInt ? '1' : '0.1'}
                    min="0"
                    value={adj[f.key] ?? ''}
                    placeholder={String(f.original)}
                    onChange={e => setField(f.key, e.target.value)}
                    className="w-20 px-2 py-1 rounded text-xs border tabular-nums text-right"
                    style={{
                        backgroundColor: hasOverride ? 'rgba(99,102,241,0.08)' : 'var(--surf3)',
                        borderColor: hasOverride ? 'var(--company-primary,#6366f1)' : 'var(--border)',
                        color: 'var(--txt)',
                        outline: 'none',
                    }}
                />
                {hasOverride && (
                    <button onClick={() => clearField(f.key)} className="opacity-50 hover:opacity-100" title="Limpiar">
                        <X size={12} style={{ color: 'var(--txt3)' }} />
                    </button>
                )}
            </div>
        );
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <p className="text-xs font-black uppercase tracking-wider" style={{ color: 'var(--company-primary,#6366f1)' }}>
                    Corrección manual — {item.employee.fullName}
                </p>
                <button onClick={onClose}><X size={14} style={{ color: 'var(--txt3)' }} /></button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color: 'var(--txt3)' }}>
                        Horas
                    </p>
                    {hoursFields.map(f => <FieldRow key={f.key} f={f} />)}
                </div>
                <div className="space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color: 'var(--txt3)' }}>
                        Novedades RRHH (días)
                    </p>
                    {novFields.map(f => <FieldRow key={f.key} f={f} />)}
                </div>
            </div>

            <div>
                <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: 'var(--txt3)' }}>
                    Nota de ajuste
                </p>
                <textarea
                    value={nota}
                    onChange={e => setNota(e.target.value)}
                    placeholder="Motivo del ajuste..."
                    rows={2}
                    className="w-full px-3 py-2 rounded-lg border text-xs resize-none"
                    style={{
                        backgroundColor: 'var(--surf3)',
                        borderColor: 'var(--border)',
                        color: 'var(--txt)',
                        outline: 'none',
                    }}
                />
            </div>

            <div className="flex items-center gap-2 pt-1">
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black uppercase transition-opacity disabled:opacity-50"
                    style={{ background: 'var(--company-primary,#6366f1)', color: '#fff' }}
                >
                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    Guardar
                </button>
                {ajuste && (
                    <button
                        onClick={handleDelete}
                        disabled={saving}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black uppercase transition-opacity disabled:opacity-50"
                        style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
                    >
                        <Trash2 size={12} />
                        Eliminar ajuste
                    </button>
                )}
            </div>
        </div>
    );
}

// ─── Fila de tabla ────────────────────────────────────────────────────────────

interface RowProps {
    item: EmployeeLiquidacion & { hasAdjustment: boolean };
    isExpanded: boolean;
    onToggle: () => void;
    ajuste: AjusteLiquidacion | undefined;
    hoursMode: 'planned' | 'real';
    onSave: (adj: AjusteAdj, nota: string) => Promise<void>;
    onDelete: () => Promise<void>;
}

function LiqRow({ item, isExpanded, onToggle, ajuste, hoursMode, onSave, onDelete }: RowProps) {
    const a = item.acumulado;
    const l = item.liquidacion200;
    const n = item.novedadesRRHH;
    const hasWarnings = item.warnings.length > 0;

    return (
        <>
            <tr
                onClick={onToggle}
                className="cursor-pointer transition-colors"
                style={isExpanded
                    ? { backgroundColor: 'rgba(99,102,241,0.06)' }
                    : { ':hover': { backgroundColor: 'var(--surf2)' } } as any
                }
            >
                {/* Indicadores */}
                <td className="pl-3 pr-1 py-2 w-8">
                    {item.hasAdjustment && (
                        <span title="Ajuste manual aplicado">
                            <Edit3 size={12} style={{ color: 'var(--company-primary,#6366f1)' }} />
                        </span>
                    )}
                </td>
                <td className="pr-1 py-2 w-6">
                    {hasWarnings && (
                        <span title={item.warnings.join('\n')}>
                            <AlertTriangle size={12} className="text-amber-500" />
                        </span>
                    )}
                </td>
                {/* Empleado */}
                <td className="px-2 py-2 whitespace-nowrap">
                    <span className="text-xs tabular-nums font-medium" style={{ color: 'var(--txt3)' }}>
                        {item.employee.fileNumber || '—'}
                    </span>
                </td>
                <td className="px-2 py-2 whitespace-nowrap">
                    <span className="text-xs font-bold" style={{ color: 'var(--txt)' }}>
                        {item.employee.fullName}
                    </span>
                </td>
                {/* Horas */}
                <td className="px-2 py-2 text-right tabular-nums text-xs" style={{ color: 'var(--txt3)' }}>{fmtH(a.hsTeoricas)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-xs font-bold" style={{ color: 'var(--txt)' }}>{fmtH(a.hsReales)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-xs" style={{ color: '#f59e0b' }}>{fmtH(a.diurnas)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-xs" style={{ color: '#8b5cf6' }}>{fmtH(a.nocturnas)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-xs" style={{ color: a.al100FT > 0 ? '#ef4444' : 'var(--txt3)' }}>{fmtH(a.al100FT)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-xs" style={{ color: a.plusFeriado > 0 ? '#06b6d4' : 'var(--txt3)' }}>{fmtH(a.plusFeriado)}</td>
                {/* Bolsa 200 */}
                <td className="px-2 py-2 text-right tabular-nums text-xs font-bold border-l" style={{ color: 'var(--txt)', borderColor: 'var(--border)' }}>{fmtH(l.bolsa)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-xs" style={{ color: 'var(--txt)' }}>{fmtH(l.hsSimples)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-xs" style={{ color: l.al50 > 0 ? '#f97316' : 'var(--txt3)' }}>{fmtH(l.al50)}</td>
                {/* Novedades */}
                <td className="px-2 py-2 text-right tabular-nums text-xs border-l" style={{ color: n.vacacionesDias > 0 ? '#10b981' : 'var(--txt3)', borderColor: 'var(--border)' }}>{fmtD(n.vacacionesDias)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-xs" style={{ color: n.enfermedadDias > 0 ? '#f59e0b' : 'var(--txt3)' }}>{fmtD(n.enfermedadDias)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-xs" style={{ color: n.art > 0 ? '#f59e0b' : 'var(--txt3)' }}>{fmtD(n.art)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-xs" style={{ color: n.licenciaEspecialDias > 0 ? '#10b981' : 'var(--txt3)' }}>{fmtD(n.licenciaEspecialDias)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-xs" style={{ color: n.permisoGremialDias > 0 ? '#6366f1' : 'var(--txt3)' }}>{fmtD(n.permisoGremialDias)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-xs" style={{ color: n.injustificadaDias > 0 ? '#ef4444' : 'var(--txt3)' }}>{fmtD(n.injustificadaDias)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-xs" style={{ color: n.otrosDias > 0 ? '#8b5cf6' : 'var(--txt3)' }}>{fmtD(n.otrosDias)}</td>
                {/* Expand toggle */}
                <td className="px-3 py-2 text-right">
                    {isExpanded
                        ? <ChevronUp size={14} style={{ color: 'var(--txt3)' }} />
                        : <ChevronDown size={14} style={{ color: 'var(--txt3)' }} />
                    }
                </td>
            </tr>
            {isExpanded && (
                <tr>
                    <td colSpan={22} className="px-6 py-5 border-t border-b" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surf2)' }}>
                        {hasWarnings && (
                            <div className="mb-4 p-3 rounded-lg border" style={{ borderColor: 'rgba(245,158,11,0.3)', backgroundColor: 'rgba(245,158,11,0.05)' }}>
                                <p className="text-[10px] font-black uppercase text-amber-500 mb-1 tracking-widest">Advertencias</p>
                                {item.warnings.map((w, i) => (
                                    <p key={i} className="text-xs" style={{ color: 'var(--txt3)' }}>{w}</p>
                                ))}
                            </div>
                        )}
                        <CorrectionForm
                            item={item}
                            ajuste={ajuste}
                            hoursMode={hoursMode}
                            onSave={onSave}
                            onDelete={onDelete}
                            onClose={onToggle}
                        />
                    </td>
                </tr>
            )}
        </>
    );
}

// ─── Tab: Claves API ──────────────────────────────────────────────────────────

interface ApiKey {
    id: string;
    name: string;
    empresaId: string;
    scopes: string[];
    status: 'active' | 'revoked';
    apiKeyPrefix: string;
    createdAt: Date | null;
    revokedAt: Date | null;
}

function tsToDate(v: any): Date | null {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (v instanceof Timestamp) return v.toDate();
    if (typeof v.toDate === 'function') return v.toDate();
    return null;
}

interface ApiKeysTabProps { empresaId: string }

function ApiKeysTab({ empresaId }: ApiKeysTabProps) {
    const [keys, setKeys] = useState<ApiKey[]>([]);
    const [loadingKeys, setLoadingKeys] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [formName, setFormName] = useState('');
    const [formScopes, setFormScopes] = useState<string[]>(['payroll.read']);
    const [saving, setSaving] = useState(false);
    const [newKey, setNewKey] = useState<{ id: string; apiKey: string } | null>(null);
    const [copied, setCopied] = useState(false);
    const [revoking, setRevoking] = useState<string | null>(null);

    useEffect(() => {
        if (!empresaId) return;
        setLoadingKeys(true);
        const q = query(collection(db, 'integraciones_api'), where('empresaId', '==', empresaId));
        const unsub = onSnapshot(q, (snap) => {
            const list: ApiKey[] = snap.docs.map(d => {
                const data = d.data();
                return {
                    id: d.id,
                    name: data.name || '',
                    empresaId: data.empresaId || '',
                    scopes: data.scopes || [],
                    status: data.status === 'revoked' ? 'revoked' : 'active',
                    apiKeyPrefix: data.apiKeyPrefix || '',
                    createdAt: tsToDate(data.createdAt),
                    revokedAt: tsToDate(data.revokedAt),
                };
            });
            list.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
            setKeys(list);
            setLoadingKeys(false);
        }, () => setLoadingKeys(false));
        return () => unsub();
    }, [empresaId]);

    const toggleScope = (s: string) =>
        setFormScopes(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

    const handleCreate = async () => {
        if (!formName.trim() || formScopes.length === 0) return;
        setSaving(true);
        try {
            const fns = getFunctions(app, 'us-central1');
            const callable = httpsCallable<any, { id: string; apiKey: string; prefix: string }>(fns, 'createPayrollApiKey');
            const result = await callable({ name: formName.trim(), scopes: formScopes, empresaId });
            setNewKey({ id: result.data.id, apiKey: result.data.apiKey });
            setShowForm(false);
            setFormName('');
            setFormScopes(['payroll.read']);
        } finally {
            setSaving(false);
        }
    };

    const handleRevoke = async (keyId: string) => {
        if (!window.confirm('¿Revocar esta clave? La acción es irreversible.')) return;
        setRevoking(keyId);
        try {
            const fns = getFunctions(app, 'us-central1');
            const callable = httpsCallable<any, { success: boolean }>(fns, 'revokePayrollApiKey');
            await callable({ keyId });
        } finally {
            setRevoking(null);
        }
    };

    const copyKey = () => {
        if (!newKey) return;
        navigator.clipboard.writeText(newKey.apiKey).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const activeKeys = keys.filter(k => k.status === 'active');
    const revokedKeys = keys.filter(k => k.status === 'revoked');

    return (
        <div className="space-y-6">
            {/* Key recién generada — mostrar una sola vez */}
            {newKey && (
                <ContentCard>
                    <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'rgba(16,185,129,0.15)' }}>
                            <Key size={16} className="text-emerald-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-black uppercase tracking-widest text-emerald-500 mb-1">Clave generada</p>
                            <p className="text-[11px] mb-3" style={{ color: 'var(--txt3)' }}>
                                Copiá la clave ahora — no se vuelve a mostrar.
                            </p>
                            <div className="flex items-center gap-2">
                                <code className="flex-1 px-3 py-2 rounded-lg text-xs font-mono break-all" style={{ backgroundColor: 'var(--surf3)', color: 'var(--txt)' }}>
                                    {newKey.apiKey}
                                </code>
                                <button
                                    onClick={copyKey}
                                    className="px-3 py-2 rounded-lg text-xs font-black uppercase flex items-center gap-1.5 shrink-0"
                                    style={{ background: copied ? 'rgba(16,185,129,0.2)' : 'var(--surf3)', color: copied ? '#10b981' : 'var(--txt3)' }}
                                >
                                    <Copy size={12} />
                                    {copied ? 'Copiado' : 'Copiar'}
                                </button>
                                <button onClick={() => setNewKey(null)}>
                                    <X size={14} style={{ color: 'var(--txt3)' }} />
                                </button>
                            </div>
                        </div>
                    </div>
                </ContentCard>
            )}

            {/* Encabezado + botón nueva clave */}
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm font-black uppercase tracking-wider" style={{ color: 'var(--txt)' }}>
                        Claves activas: {activeKeys.length}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--txt3)' }}>
                        Cada clave permite acceso a la API REST de liquidación por parte de sistemas externos.
                    </p>
                </div>
                {!showForm && (
                    <button
                        onClick={() => setShowForm(true)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black uppercase"
                        style={{ background: 'var(--company-primary,#6366f1)', color: '#fff' }}
                    >
                        <Plus size={13} />
                        Nueva clave
                    </button>
                )}
            </div>

            {/* Formulario de nueva clave */}
            {showForm && (
                <ContentCard>
                    <p className="text-xs font-black uppercase tracking-widest mb-4" style={{ color: 'var(--company-primary,#6366f1)' }}>
                        Nueva clave de API
                    </p>
                    <div className="space-y-4">
                        <div>
                            <label className="text-[10px] font-black uppercase tracking-widest block mb-1" style={{ color: 'var(--txt3)' }}>
                                Nombre / descripción
                            </label>
                            <input
                                value={formName}
                                onChange={e => setFormName(e.target.value)}
                                placeholder="ej: Integración sistema de RRHH"
                                className="w-full px-3 py-2 rounded-xl border text-sm"
                                style={{ backgroundColor: 'var(--surf3)', borderColor: 'var(--border)', color: 'var(--txt)', outline: 'none' }}
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-black uppercase tracking-widest block mb-2" style={{ color: 'var(--txt3)' }}>
                                Permisos (scopes)
                            </label>
                            {[
                                { scope: 'payroll.read', label: 'payroll.read', desc: 'Ver liquidación y ciclos' },
                                { scope: 'payroll.close', label: 'payroll.close', desc: 'Cerrar ciclos (genera snapshot inmutable)' },
                            ].map(({ scope, label, desc }) => (
                                <label key={scope} className="flex items-center gap-3 mb-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={formScopes.includes(scope)}
                                        onChange={() => toggleScope(scope)}
                                        className="w-4 h-4 rounded"
                                        style={{ accentColor: 'var(--company-primary,#6366f1)' }}
                                    />
                                    <div>
                                        <span className="text-xs font-black" style={{ color: 'var(--txt)' }}>{label}</span>
                                        <span className="text-xs ml-2" style={{ color: 'var(--txt3)' }}>{desc}</span>
                                    </div>
                                </label>
                            ))}
                        </div>
                        <div className="flex gap-2 pt-1">
                            <button
                                onClick={handleCreate}
                                disabled={saving || !formName.trim() || formScopes.length === 0}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black uppercase disabled:opacity-40"
                                style={{ background: 'var(--company-primary,#6366f1)', color: '#fff' }}
                            >
                                {saving ? <Loader2 size={12} className="animate-spin" /> : <Key size={12} />}
                                Generar clave
                            </button>
                            <button
                                onClick={() => setShowForm(false)}
                                className="px-3 py-1.5 rounded-lg text-xs font-black uppercase border"
                                style={{ borderColor: 'var(--border)', color: 'var(--txt3)' }}
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </ContentCard>
            )}

            {/* Lista de claves */}
            {loadingKeys ? (
                <div className="flex items-center gap-3 py-8 justify-center" style={{ color: 'var(--txt3)' }}>
                    <Loader2 size={18} className="animate-spin" />
                    <span className="text-sm font-bold">Cargando claves…</span>
                </div>
            ) : (
                <ContentCard padding={false}>
                    {keys.length === 0 ? (
                        <div className="py-12 text-center">
                            <Key size={32} className="mx-auto mb-3 opacity-20" style={{ color: 'var(--txt3)' }} />
                            <p className="text-sm font-bold" style={{ color: 'var(--txt3)' }}>Sin claves generadas</p>
                        </div>
                    ) : (
                        <div>
                            {keys.map((k, idx) => (
                                <div key={k.id} className={`flex items-center gap-4 px-5 py-4 ${idx > 0 ? 'border-t' : ''}`}
                                    style={idx > 0 ? { borderColor: 'var(--border)' } : undefined}>
                                    <div className={`w-2 h-2 rounded-full shrink-0 ${k.status === 'active' ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-sm font-bold" style={{ color: 'var(--txt)' }}>{k.name}</span>
                                            {k.scopes.map(s => (
                                                <span key={s} className="px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wide"
                                                    style={{ background: 'rgba(99,102,241,0.12)', color: 'var(--company-primary,#6366f1)' }}>
                                                    {s}
                                                </span>
                                            ))}
                                            {k.status === 'revoked' && (
                                                <span className="px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wide text-red-500"
                                                    style={{ background: 'rgba(239,68,68,0.1)' }}>
                                                    Revocada
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-[11px] mt-0.5 tabular-nums" style={{ color: 'var(--txt3)' }}>
                                            Prefijo: <code className="font-mono">{k.apiKeyPrefix}…</code>
                                            {k.createdAt && ` · Creada: ${k.createdAt.toLocaleDateString('es-AR')}`}
                                            {k.revokedAt && ` · Revocada: ${k.revokedAt.toLocaleDateString('es-AR')}`}
                                        </p>
                                    </div>
                                    {k.status === 'active' && (
                                        <button
                                            onClick={() => handleRevoke(k.id)}
                                            disabled={revoking === k.id}
                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black uppercase shrink-0 disabled:opacity-40"
                                            style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
                                        >
                                            {revoking === k.id ? <Loader2 size={12} className="animate-spin" /> : <ShieldOff size={12} />}
                                            Revocar
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </ContentCard>
            )}

            {/* Referencia de la API */}
            <ContentCard>
                <p className="text-[10px] font-black uppercase tracking-widest mb-3" style={{ color: 'var(--txt3)' }}>
                    Cómo usar la API
                </p>
                <div className="space-y-2">
                    {[
                        ['Ciclos', 'GET https://us-central1-comtroldata.cloudfunctions.net/payrollApi/v1/payroll/cycles'],
                        ['Liquidación', 'GET …/v1/payroll/liquidacion?cycleId=2026-07&hoursMode=real'],
                        ['Auth header', 'X-API-Key: csp_…tu_clave…'],
                    ].map(([label, code]) => (
                        <div key={label}>
                            <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: 'var(--txt3)' }}>{label}</span>
                            <code className="block mt-0.5 px-3 py-1.5 rounded text-[11px] font-mono break-all"
                                style={{ backgroundColor: 'var(--surf3)', color: 'var(--txt)' }}>
                                {code}
                            </code>
                        </div>
                    ))}
                </div>
            </ContentCard>
        </div>
    );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function LiquidacionesPage() {
    const router = useRouter();
    const { empresaId } = useEmpresa();
    const { canReadModule } = useAuth();

    const [activeTab, setActiveTab] = useState<'liquidacion' | 'claves'>('liquidacion');

    // Redirigir si no tiene permiso
    React.useEffect(() => {
        if (!canReadModule('API_KEYS') && !canReadModule('CONFIG')) {
            router.replace('/admin/dashboard');
        }
    }, [canReadModule, router]);

    const cycleOptions = useMemo(() => buildCycleOptions(), []);
    const [cycleId, setCycleId] = useState<string>(cycleOptions[1]?.cycleId || cycleOptions[0]?.cycleId || '');
    const [hoursMode, setHoursMode] = useState<'planned' | 'real'>('real');
    const [search, setSearch] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const { snapshot, loading, error, ajustes, refresh, saveAjuste, deleteAjuste } = useLiquidaciones({
        cycleId,
        hoursMode,
        empresaId: empresaId || '',
    });

    const selectedCycle = cycleOptions.find(c => c.cycleId === cycleId);

    // Fusionar items con ajustes
    const mergedItems = useMemo(() => {
        if (!snapshot) return [];
        return snapshot.items.map(item =>
            applyAjuste(item, ajustes.get(item.employee.id))
        );
    }, [snapshot, ajustes]);

    // Filtro por nombre / legajo
    const filteredItems = useMemo(() => {
        if (!search.trim()) return mergedItems;
        const q = search.toLowerCase();
        return mergedItems.filter(it =>
            it.employee.fullName.toLowerCase().includes(q) ||
            (it.employee.fileNumber || '').toLowerCase().includes(q) ||
            (it.employee.dni || '').includes(q)
        );
    }, [mergedItems, search]);

    // Totales
    const totals = useMemo(() => {
        let hsTeoricas = 0, hsReales = 0, diurnas = 0, nocturnas = 0, al100FT = 0, plusFeriado = 0;
        let bolsa = 0, hsSimples = 0, al50 = 0;
        let withAdjustment = 0, withWarnings = 0;
        for (const it of mergedItems) {
            hsTeoricas += it.acumulado.hsTeoricas;
            hsReales   += it.acumulado.hsReales;
            diurnas    += it.acumulado.diurnas;
            nocturnas  += it.acumulado.nocturnas;
            al100FT    += it.acumulado.al100FT;
            plusFeriado+= it.acumulado.plusFeriado;
            bolsa      += it.liquidacion200.bolsa;
            hsSimples  += it.liquidacion200.hsSimples;
            al50       += it.liquidacion200.al50;
            if (it.hasAdjustment) withAdjustment++;
            if (it.warnings.length > 0) withWarnings++;
        }
        return { hsTeoricas, hsReales, diurnas, nocturnas, al100FT, plusFeriado, bolsa, hsSimples, al50, withAdjustment, withWarnings };
    }, [mergedItems]);

    const handleExport = useCallback(() => {
        if (!snapshot) return;
        const csv = buildLiquidacionCsv(mergedItems, cycleId, hoursMode);
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `liquidacion_${cycleId}_${hoursMode}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }, [snapshot, mergedItems, cycleId, hoursMode]);

    const modeLabel = hoursMode === 'planned' ? 'Planificadas' : 'Reales';

    return (
        <DashboardLayout>
            <PageShell>
                <PageHeader
                    title="Liquidaciones"
                    subtitle="CCT 422/05 — SUVICO"
                    icon={ClipboardList}
                    actions={
                        activeTab === 'liquidacion' ? (
                            <div className="flex items-center gap-2">
                                {snapshot && !loading && (
                                    <button
                                        onClick={handleExport}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black uppercase border transition-opacity hover:opacity-80"
                                        style={{ borderColor: 'var(--border)', color: 'var(--txt3)' }}
                                    >
                                        <Download size={13} />
                                        CSV
                                    </button>
                                )}
                                <button
                                    onClick={refresh}
                                    disabled={loading}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black uppercase border transition-opacity hover:opacity-80 disabled:opacity-40"
                                    style={{ borderColor: 'var(--border)', color: 'var(--txt3)' }}
                                >
                                    <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                                    Actualizar
                                </button>
                            </div>
                        ) : undefined
                    }
                />

                {/* Tabs */}
                <div className="mb-6">
                    <TabBar
                        tabs={[
                            { id: 'liquidacion', label: 'Liquidación', icon: ClipboardList },
                            { id: 'claves', label: 'Claves API', icon: Key },
                        ]}
                        active={activeTab}
                        onChange={(id) => setActiveTab(id as 'liquidacion' | 'claves')}
                    />
                </div>

                {/* Contenido según tab */}
                {activeTab === 'claves' && empresaId && (
                    <ApiKeysTab empresaId={empresaId} />
                )}

                {activeTab === 'liquidacion' && (
                <>{/* Filtros */}
                <div className="flex flex-wrap items-center gap-3 mb-6">
                    {/* Selector de ciclo */}
                    <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--txt3)' }}>
                            Período CCT
                        </span>
                        <select
                            value={cycleId}
                            onChange={e => { setCycleId(e.target.value); setExpandedId(null); }}
                            className="px-3 py-2 rounded-xl border text-xs font-bold"
                            style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)', color: 'var(--txt)', outline: 'none' }}
                        >
                            {cycleOptions.map(opt => (
                                <option key={opt.cycleId} value={opt.cycleId}>
                                    {opt.label} — {opt.range}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Toggle modo horas */}
                    <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--txt3)' }}>
                            Modo horas
                        </span>
                        <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                            <button
                                onClick={() => { setHoursMode('real'); setExpandedId(null); }}
                                className="flex items-center gap-1.5 px-3 py-2 text-xs font-black uppercase transition-colors"
                                style={hoursMode === 'real'
                                    ? { background: 'var(--company-primary,#6366f1)', color: '#fff' }
                                    : { background: 'var(--surf)', color: 'var(--txt3)' }}
                            >
                                <CheckCircle2 size={12} />
                                Fichadas
                            </button>
                            <button
                                onClick={() => { setHoursMode('planned'); setExpandedId(null); }}
                                className="flex items-center gap-1.5 px-3 py-2 text-xs font-black uppercase transition-colors border-l"
                                style={hoursMode === 'planned'
                                    ? { background: 'var(--company-primary,#6366f1)', color: '#fff', borderColor: 'transparent' }
                                    : { background: 'var(--surf)', color: 'var(--txt3)', borderColor: 'var(--border)' }}
                            >
                                <CalendarDays size={12} />
                                Planificadas
                            </button>
                        </div>
                    </div>

                    {/* Búsqueda */}
                    <div className="flex flex-col gap-0.5 flex-1 min-w-[200px]">
                        <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--txt3)' }}>
                            Buscar empleado
                        </span>
                        <input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Nombre, legajo o DNI..."
                            className="px-3 py-2 rounded-xl border text-xs"
                            style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)', color: 'var(--txt)', outline: 'none' }}
                        />
                    </div>

                    {snapshot && (
                        <div className="flex flex-col gap-0.5 self-end">
                            <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--txt3)' }}>
                                Estado
                            </span>
                            <span className={`px-3 py-2 rounded-xl text-xs font-black uppercase ${snapshot.lockedAt ? 'text-emerald-600' : 'text-amber-600'}`}
                                style={{ background: snapshot.lockedAt ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)' }}>
                                {snapshot.lockedAt ? `Cerrado` : 'Abierto'}
                            </span>
                        </div>
                    )}
                </div>

                {/* Cards resumen */}
                {snapshot && !loading && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
                        <MetricCard title="Empleados" value={mergedItems.length} icon={Users} color="#6366f1"
                            subtext={`${totals.withWarnings} con avisos`} />
                        <MetricCard title={`Hs ${modeLabel}`} value={totals.hsReales.toFixed(1)} icon={Clock} color="#10b981"
                            subtext={`Teóricas: ${totals.hsTeoricas.toFixed(1)}`} />
                        <MetricCard title="Diurnas" value={totals.diurnas.toFixed(1)} icon={Sun} color="#f59e0b" />
                        <MetricCard title="Nocturnas" value={totals.nocturnas.toFixed(1)} icon={Moon} color="#8b5cf6" />
                        <MetricCard title="Bolsa 200hs" value={totals.bolsa.toFixed(1)} icon={ClipboardList} color="#06b6d4"
                            subtext={`Al 50%: ${totals.al50.toFixed(1)}`} />
                        <MetricCard title="Con ajuste" value={totals.withAdjustment} icon={Edit3} color="#f97316"
                            subtext={`de ${mergedItems.length} empleados`} />
                    </div>
                )}

                {/* Error */}
                {error && (
                    <ContentCard>
                        <div className="flex items-center gap-3 text-red-500">
                            <AlertTriangle size={18} />
                            <p className="text-sm font-bold">{error}</p>
                        </div>
                    </ContentCard>
                )}

                {/* Loading */}
                {loading && (
                    <div className="flex items-center justify-center py-24 gap-3" style={{ color: 'var(--txt3)' }}>
                        <Loader2 size={24} className="animate-spin" />
                        <span className="text-sm font-bold">Calculando liquidación…</span>
                    </div>
                )}

                {/* Tabla */}
                {!loading && !error && snapshot && (
                    <ContentCard padding={false}>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse" style={{ minWidth: '1100px' }}>
                                <thead>
                                    <tr className="border-b" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surf2)' }}>
                                        <th className="pl-3 pr-1 py-2 w-8" />
                                        <th className="pr-1 py-2 w-6" />
                                        <th className="px-2 py-2 text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--txt3)' }}>Leg.</th>
                                        <th className="px-2 py-2 text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--txt3)' }}>Apellido y Nombre</th>
                                        <th className="px-2 py-2 text-right text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--txt3)' }}>Hs Teór.</th>
                                        <th className="px-2 py-2 text-right text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--txt3)' }}>Hs {modeLabel.slice(0,6)}.</th>
                                        <th className="px-2 py-2 text-right text-[10px] font-black uppercase tracking-wider" style={{ color: '#f59e0b' }}>Diurnas</th>
                                        <th className="px-2 py-2 text-right text-[10px] font-black uppercase tracking-wider" style={{ color: '#8b5cf6' }}>Noct.</th>
                                        <th className="px-2 py-2 text-right text-[10px] font-black uppercase tracking-wider" style={{ color: '#ef4444' }}>FT 100%</th>
                                        <th className="px-2 py-2 text-right text-[10px] font-black uppercase tracking-wider" style={{ color: '#06b6d4' }}>+Feriado</th>
                                        <th className="px-2 py-2 text-right text-[10px] font-black uppercase tracking-wider border-l" style={{ color: 'var(--txt)', borderColor: 'var(--border)' }}>Bolsa</th>
                                        <th className="px-2 py-2 text-right text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--txt)' }}>Simples</th>
                                        <th className="px-2 py-2 text-right text-[10px] font-black uppercase tracking-wider" style={{ color: '#f97316' }}>Al 50%</th>
                                        <th className="px-2 py-2 text-right text-[10px] font-black uppercase tracking-wider border-l" style={{ color: '#10b981', borderColor: 'var(--border)' }}>V</th>
                                        <th className="px-2 py-2 text-right text-[10px] font-black uppercase tracking-wider" style={{ color: '#f59e0b' }}>E</th>
                                        <th className="px-2 py-2 text-right text-[10px] font-black uppercase tracking-wider" style={{ color: '#f59e0b' }}>ART</th>
                                        <th className="px-2 py-2 text-right text-[10px] font-black uppercase tracking-wider" style={{ color: '#10b981' }}>L</th>
                                        <th className="px-2 py-2 text-right text-[10px] font-black uppercase tracking-wider" style={{ color: '#6366f1' }}>PG</th>
                                        <th className="px-2 py-2 text-right text-[10px] font-black uppercase tracking-wider" style={{ color: '#ef4444' }}>AA</th>
                                        <th className="px-2 py-2 text-right text-[10px] font-black uppercase tracking-wider" style={{ color: '#8b5cf6' }}>Otros</th>
                                        <th className="px-3 py-2 w-8" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredItems.length === 0 ? (
                                        <tr>
                                            <td colSpan={22} className="text-center py-16 text-sm font-bold" style={{ color: 'var(--txt3)' }}>
                                                {search ? 'Sin resultados para la búsqueda.' : 'Sin empleados en este ciclo.'}
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredItems.map((item, idx) => (
                                            <React.Fragment key={item.employee.id}>
                                                {idx > 0 && (
                                                    <tr aria-hidden="true">
                                                        <td colSpan={22} className="h-px p-0" style={{ backgroundColor: 'var(--border)' }} />
                                                    </tr>
                                                )}
                                                <LiqRow
                                                    item={item}
                                                    isExpanded={expandedId === item.employee.id}
                                                    onToggle={() => setExpandedId(prev => prev === item.employee.id ? null : item.employee.id)}
                                                    ajuste={ajustes.get(item.employee.id)}
                                                    hoursMode={hoursMode}
                                                    onSave={(adj, nota) => saveAjuste(item.employee.id, adj, nota)}
                                                    onDelete={() => deleteAjuste(item.employee.id)}
                                                />
                                            </React.Fragment>
                                        ))
                                    )}
                                </tbody>
                                {/* Fila de totales */}
                                {filteredItems.length > 0 && (
                                    <tfoot>
                                        <tr className="border-t" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surf2)' }}>
                                            <td colSpan={4} className="pl-3 py-2 text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--txt3)' }}>
                                                Total · {filteredItems.length} empleados
                                            </td>
                                            <td className="px-2 py-2 text-right tabular-nums text-xs font-bold" style={{ color: 'var(--txt3)' }}>{totals.hsTeoricas.toFixed(1)}</td>
                                            <td className="px-2 py-2 text-right tabular-nums text-xs font-bold" style={{ color: 'var(--txt)' }}>{totals.hsReales.toFixed(1)}</td>
                                            <td className="px-2 py-2 text-right tabular-nums text-xs font-bold" style={{ color: '#f59e0b' }}>{totals.diurnas.toFixed(1)}</td>
                                            <td className="px-2 py-2 text-right tabular-nums text-xs font-bold" style={{ color: '#8b5cf6' }}>{totals.nocturnas.toFixed(1)}</td>
                                            <td className="px-2 py-2 text-right tabular-nums text-xs font-bold" style={{ color: '#ef4444' }}>{totals.al100FT.toFixed(1)}</td>
                                            <td className="px-2 py-2 text-right tabular-nums text-xs font-bold" style={{ color: '#06b6d4' }}>{totals.plusFeriado.toFixed(1)}</td>
                                            <td className="px-2 py-2 text-right tabular-nums text-xs font-bold border-l" style={{ color: 'var(--txt)', borderColor: 'var(--border)' }}>{totals.bolsa.toFixed(1)}</td>
                                            <td className="px-2 py-2 text-right tabular-nums text-xs font-bold" style={{ color: 'var(--txt)' }}>{totals.hsSimples.toFixed(1)}</td>
                                            <td className="px-2 py-2 text-right tabular-nums text-xs font-bold" style={{ color: '#f97316' }}>{totals.al50.toFixed(1)}</td>
                                            <td colSpan={8} />
                                        </tr>
                                    </tfoot>
                                )}
                            </table>
                        </div>

                        {/* Footer */}
                        {snapshot && (
                            <div className="flex items-center justify-between px-4 py-3 border-t" style={{ borderColor: 'var(--border)' }}>
                                <span className="text-[10px]" style={{ color: 'var(--txt3)' }}>
                                    Generado: {new Date(snapshot.generatedAt).toLocaleString('es-AR')}
                                    {snapshot.lockedAt && ` · Cerrado: ${new Date(snapshot.lockedAt).toLocaleString('es-AR')}`}
                                </span>
                                <span className="text-[10px]" style={{ color: 'var(--txt3)' }}>
                                    {snapshot.pagination.total} empleados totales
                                </span>
                            </div>
                        )}
                    </ContentCard>
                )}

                {/* Leyenda columnas */}
                {!loading && snapshot && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4">
                        {[
                            ['V', 'Vacaciones', '#10b981'],
                            ['E', 'Enfermedad', '#f59e0b'],
                            ['ART', 'Autorizada/ART', '#f59e0b'],
                            ['L', 'Lic. Especial', '#10b981'],
                            ['PG', 'Permiso Gremial', '#6366f1'],
                            ['AA', 'Injustificada', '#ef4444'],
                            ['Otros', 'Códigos no mapeados', '#8b5cf6'],
                        ].map(([abbr, full, color]) => (
                            <span key={abbr} className="text-[10px] font-medium" style={{ color: 'var(--txt3)' }}>
                                <span className="font-black" style={{ color }}>{abbr}</span> = {full}
                            </span>
                        ))}
                    </div>
                )}
                </>)}
            </PageShell>
        </DashboardLayout>
    );
}
