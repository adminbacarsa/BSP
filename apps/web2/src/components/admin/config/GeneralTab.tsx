import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
    Save, Building, FileText, Mail, Phone, AlertTriangle, Trash2,
    ShieldAlert, RefreshCw, Moon, Sun, Monitor, Zap, Hexagon, ArrowRight, X, Loader2,
    UserCircle, BookOpen, ShieldCheck, ExternalLink
} from 'lucide-react';
import { functions, db } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';

const PHRASE_DELETE_ALL_SHIFTS = 'BORRAR TODOS LOS TURNOS';

export default function GeneralTab() {
    const { isSuperAdmin, userRole } = useAuth();
    const { empresaId } = useEmpresa();
    const canRunMassDelete =
        isSuperAdmin ||
        (userRole || '').trim().toUpperCase().replace(/\s+/g, '_') === 'ADMIN';

    const [cleaningTarget, setCleaningTarget] = useState<string | null>(null);
    const [shiftDeleteModalOpen, setShiftDeleteModalOpen] = useState(false);
    const [shiftDeletePhrase, setShiftDeletePhrase] = useState('');
    const [company, setCompany] = useState({ name: '', cuit: '', address: '', website: '', email: '', phone: '' });
    const [loadingCompany, setLoadingCompany] = useState(true);
    const [savingCompany, setSavingCompany] = useState(false);

    // TEMA SELECCIONADO
    const [theme, setTheme] = useState('light');

    // Cargar datos de organización desde Firestore (por empresa activa)
    useEffect(() => {
        const saved = (localStorage.getItem('cosp-theme') || localStorage.getItem('theme') || 'light') as any;
        setTheme(saved);
    }, []);

    useEffect(() => {
        if (!empresaId) return;
        setLoadingCompany(true);
        getDoc(doc(db, 'empresas', empresaId))
            .then(snap => {
                if (snap.exists()) {
                    const data = snap.data();
                    setCompany({
                        name:    data.name    || '',
                        cuit:    data.cuit    || '',
                        address: data.direccion || data.address || '',
                        website: data.website || '',
                        email:   data.email   || '',
                        phone:   data.phone   || '',
                    });
                } else {
                    setCompany({ name: '', cuit: '', address: '', website: '', email: '', phone: '' });
                }
            })
            .catch(() => {})
            .finally(() => setLoadingCompany(false));
    }, [empresaId]);

    const handleApplyTheme = (newTheme: string) => {
        setTheme(newTheme);
        import('@/lib/themeManager').then(m => m.applyTheme(newTheme as any));
    };

    const handleChange = (e: any) => setCompany({ ...company, [e.target.name]: e.target.value });

    const handleSaveCompany = async () => {
        if (!empresaId) return;
        setSavingCompany(true);
        try {
            await setDoc(
                doc(db, 'empresas', empresaId),
                { name: company.name, cuit: company.cuit, direccion: company.address, website: company.website, email: company.email, phone: company.phone, updatedAt: new Date().toISOString() },
                { merge: true }
            );
            toast.success('Datos de organización guardados');
        } catch (err: any) {
            toast.error('Error al guardar: ' + (err?.message || err));
        } finally {
            setSavingCompany(false);
        }
    };

    const runLimpiarBaseDeDatos = async (target: 'AUDIT' | 'SHIFTS') => {
        setCleaningTarget(target);
        try {
            const cleanFn = httpsCallable(functions, 'limpiarBaseDeDatos');
            await cleanFn({ target });
            toast.success(
                target === 'SHIFTS'
                    ? 'Colección turnos vaciada. Podés cargar planificación desde cero.'
                    : 'Limpieza completada con éxito'
            );
        } catch (error: any) {
            const msg = error?.message || String(error);
            toast.error(msg.includes('permission-denied') ? 'Sin permiso: solo ADMIN o SUPERADMIN.' : 'Error: ' + msg);
        } finally {
            setCleaningTarget(null);
        }
    };

    const handleSystemClean = async (target: 'AUDIT' | 'SHIFTS') => {
        if (!canRunMassDelete) {
            toast.error('Solo ADMIN o SUPERADMIN pueden ejecutar la limpieza masiva.');
            return;
        }
        toast('⚠️ ¿Borrar historial operativo?', {
            description: 'Irreversible.',
            action: {
                label: 'SÍ, BORRAR',
                onClick: async () => {
                    await runLimpiarBaseDeDatos(target);
                },
            },
            cancel: { label: 'Cancelar', onClick: () => {} },
        });
    };

    const openShiftMassDeleteModal = () => {
        if (!canRunMassDelete) {
            toast.error('Solo ADMIN o SUPERADMIN pueden borrar todos los turnos.');
            return;
        }
        setShiftDeletePhrase('');
        setShiftDeleteModalOpen(true);
    };

    const confirmShiftMassDelete = async () => {
        if (shiftDeletePhrase.trim() !== PHRASE_DELETE_ALL_SHIFTS) {
            toast.error(`Escribí exactamente: ${PHRASE_DELETE_ALL_SHIFTS}`);
            return;
        }
        setShiftDeleteModalOpen(false);
        await runLimpiarBaseDeDatos('SHIFTS');
    };

    return (
        <div className="space-y-8 animate-in fade-in pb-10">
            
            {/* 1. SELECTOR DE TEMAS (5 OPCIONES REALES) */}
            <div className="bg-white dark:bg-slate-800 p-8 rounded-[2rem] border border-slate-200 dark:border-slate-700 shadow-xl">
                <h3 className="text-xl font-black text-slate-800 dark:text-white mb-6 flex items-center gap-2">
                    <Monitor className="text-indigo-600"/> TEMAS Y APARIENCIA
                </h3>
                
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    {/* LIGHT */}
                    <button onClick={() => handleApplyTheme('light')} className={`p-4 rounded-2xl border-2 flex flex-col items-center gap-3 transition-all hover:scale-105 ${theme === 'light' ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-100 hover:border-slate-300'}`}>
                        <div className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center shadow-sm"><Sun size={20} className="text-slate-600"/></div>
                        <span className="text-xs font-black uppercase text-slate-600">Claro</span>
                    </button>

                    {/* DARK */}
                    <button onClick={() => handleApplyTheme('dark')} className={`p-4 rounded-2xl border-2 flex flex-col items-center gap-3 transition-all hover:scale-105 ${theme === 'dark' ? 'border-indigo-500 bg-slate-900 text-white' : 'border-slate-100 hover:border-slate-300'}`}>
                        <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center shadow-sm"><Moon size={20} className="text-white"/></div>
                        <span className="text-xs font-black uppercase text-slate-600 dark:text-slate-400">Oscuro</span>
                    </button>

                    {/* CONTRASTE */}
                    <button onClick={() => handleApplyTheme('contrast')} className={`p-4 rounded-2xl border-2 flex flex-col items-center gap-3 transition-all hover:scale-105 ${theme === 'contrast' ? 'border-black bg-black text-yellow-400' : 'border-slate-100 hover:border-slate-300'}`}>
                        <div className="w-10 h-10 rounded-full bg-black border border-white flex items-center justify-center shadow-sm"><Zap size={20} className="text-yellow-400"/></div>
                        <span className="text-xs font-black uppercase text-slate-600">Contraste</span>
                    </button>

                    {/* AZUL / NAVY */}
                    <button onClick={() => handleApplyTheme('blue')} className={`p-4 rounded-2xl border-2 flex flex-col items-center gap-3 transition-all hover:scale-105 ${theme === 'blue' ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-100 hover:border-slate-300'}`}>
                        <div className="w-10 h-10 rounded-full bg-blue-900 flex items-center justify-center shadow-sm"><Hexagon size={20} className="text-blue-200"/></div>
                        <span className="text-xs font-black uppercase text-slate-600">Azul Pro</span>
                    </button>

                    {/* SISTEMA */}
                    <button onClick={() => handleApplyTheme('system')} className={`p-4 rounded-2xl border-2 flex flex-col items-center gap-3 transition-all hover:scale-105 ${theme === 'system' ? 'border-slate-400 bg-slate-100 text-slate-800' : 'border-slate-100 hover:border-slate-300'}`}>
                        <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center shadow-sm"><Monitor size={20} className="text-slate-600"/></div>
                        <span className="text-xs font-black uppercase text-slate-600">Sistema</span>
                    </button>
                </div>
                <p className="mt-4 text-xs text-slate-400 font-medium">Nota: El modo "Claro" ahora usa tipografía de alto contraste (Gris oscuro/Negro) para mejor legibilidad.</p>
            </div>

            {/* 2. DATOS DE LA EMPRESA */}
            <div className="bg-white dark:bg-slate-800 p-8 rounded-[2rem] border border-slate-200 dark:border-slate-700 shadow-xl relative overflow-hidden">
                <h3 className="text-xl font-black text-slate-800 dark:text-white mb-8 flex items-center gap-3 relative z-10">
                    <div className="p-3 bg-indigo-50 dark:bg-indigo-900/50 rounded-xl text-indigo-600 dark:text-indigo-400"><Building size={24}/></div>
                    DATOS DE LA ORGANIZACIÓN
                </h3>
                {loadingCompany ? (
                    <div className="flex items-center gap-2 text-slate-400 py-8"><Loader2 size={18} className="animate-spin"/> Cargando datos...</div>
                ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
                    <div><label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">Razón Social</label><input name="name" value={company.name} onChange={handleChange} className="w-full p-4 bg-slate-50 dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 focus:border-indigo-500 rounded-xl font-bold text-slate-900 dark:text-white outline-none transition-all"/></div>
                    <div><label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">CUIT</label><input name="cuit" value={company.cuit} onChange={handleChange} className="w-full p-4 bg-slate-50 dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 focus:border-indigo-500 rounded-xl font-mono font-medium text-slate-900 dark:text-white outline-none transition-all"/></div>
                    <div className="md:col-span-2"><label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">Dirección</label><div className="relative"><FileText size={20} className="absolute left-4 top-4 text-slate-400"/><input name="address" value={company.address} onChange={handleChange} className="w-full pl-12 p-4 bg-slate-50 dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 focus:border-indigo-500 rounded-xl font-medium text-slate-900 dark:text-white outline-none transition-all"/></div></div>
                </div>
                )}
                <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-700 flex justify-end">
                    <button onClick={handleSaveCompany} disabled={savingCompany || loadingCompany} className="bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 text-white px-8 py-4 rounded-xl font-black text-xs uppercase flex items-center gap-2 shadow-xl hover:-translate-y-1 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                        {savingCompany ? <Loader2 size={18} className="animate-spin"/> : <Save size={18}/>}
                        {savingCompany ? 'GUARDANDO...' : 'GUARDAR DATOS'}
                    </button>
                </div>
            </div>

            {/* 2b. PORTALES DE ACCESO */}
            <div className="bg-white dark:bg-slate-800 p-8 rounded-[2rem] border border-slate-200 dark:border-slate-700 shadow-xl">
                <h3 className="text-xl font-black text-slate-800 dark:text-white mb-6 flex items-center gap-3">
                    <div className="p-3 bg-indigo-50 dark:bg-indigo-900/50 rounded-xl text-indigo-600 dark:text-indigo-400"><ExternalLink size={24}/></div>
                    PORTALES DE ACCESO
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Link
                        href="/empleado/dashboard"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex flex-col gap-3 p-5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl hover:border-indigo-300 hover:shadow-md transition-all"
                    >
                        <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/60 rounded-xl flex items-center justify-center text-indigo-600 dark:text-indigo-400 group-hover:bg-indigo-200 transition-colors">
                            <UserCircle size={22}/>
                        </div>
                        <div>
                            <p className="font-black text-slate-800 dark:text-white text-sm uppercase">Portal Empleado</p>
                            <p className="text-[11px] text-slate-400 font-medium mt-0.5">Turnos, presencia y novedades del guardia</p>
                        </div>
                        <span className="text-[10px] font-black text-indigo-500 uppercase flex items-center gap-1 mt-auto">
                            Abrir <ArrowRight size={11}/>
                        </span>
                    </Link>

                    <Link
                        href="/objetivo/dashboard"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex flex-col gap-3 p-5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl hover:border-emerald-300 hover:shadow-md transition-all"
                    >
                        <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/60 rounded-xl flex items-center justify-center text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-200 transition-colors">
                            <BookOpen size={22}/>
                        </div>
                        <div>
                            <p className="font-black text-slate-800 dark:text-white text-sm uppercase">Libro de Guardia</p>
                            <p className="text-[11px] text-slate-400 font-medium mt-0.5">Portal del objetivo — accesos y novedades</p>
                        </div>
                        <span className="text-[10px] font-black text-emerald-500 uppercase flex items-center gap-1 mt-auto">
                            Abrir <ArrowRight size={11}/>
                        </span>
                    </Link>

                    <Link
                        href="/cliente/dashboard"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex flex-col gap-3 p-5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl hover:border-violet-300 hover:shadow-md transition-all"
                    >
                        <div className="w-10 h-10 bg-violet-100 dark:bg-violet-900/60 rounded-xl flex items-center justify-center text-violet-600 dark:text-violet-400 group-hover:bg-violet-200 transition-colors">
                            <ShieldCheck size={22}/>
                        </div>
                        <div>
                            <p className="font-black text-slate-800 dark:text-white text-sm uppercase">Portal Cliente</p>
                            <p className="text-[11px] text-slate-400 font-medium mt-0.5">Personal autorizado y accesos del día</p>
                        </div>
                        <span className="text-[10px] font-black text-violet-500 uppercase flex items-center gap-1 mt-auto">
                            Abrir <ArrowRight size={11}/>
                        </span>
                    </Link>
                </div>
            </div>

            {/* 3. ZONA DE MANTENIMIENTO */}
            <div className="bg-rose-50 dark:bg-rose-950/20 p-8 rounded-[2rem] border-2 border-rose-100 dark:border-rose-900/50 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10"><ShieldAlert size={120} className="text-rose-600"/></div>
                <h3 className="text-xl font-black text-rose-700 dark:text-rose-400 mb-2 flex items-center gap-3"><AlertTriangle size={24}/> ZONA DE MANTENIMIENTO</h3>
                <p className="text-sm text-rose-600/80 mb-2 font-medium">Acciones destructivas e irreversibles. Solo <strong>ADMIN</strong> o <strong>SUPERADMIN</strong> (en Firebase + función desplegada).</p>
                {!canRunMassDelete && (
                    <p className="text-xs text-amber-700 dark:text-amber-400 mb-6 font-bold">Tu sesión no tiene rol ADMIN/SUPERADMIN: los botones están deshabilitados.</p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10">
                    <button type="button" onClick={() => handleSystemClean('AUDIT')} disabled={!!cleaningTarget || !canRunMassDelete} className="p-4 bg-white dark:bg-slate-900 border border-rose-200 rounded-xl flex items-center justify-between hover:border-rose-400 group transition-all disabled:opacity-50">
                        <span className="font-bold text-rose-700 text-sm text-left">Borrar historial operaciones<br/><span className="font-normal text-[10px] text-rose-500">colección historial_operaciones</span></span>
                        {cleaningTarget === 'AUDIT' ? <RefreshCw className="animate-spin text-rose-500 shrink-0"/> : <Trash2 className="text-rose-300 group-hover:text-rose-600 shrink-0"/>}
                    </button>
                    <button type="button" onClick={openShiftMassDeleteModal} disabled={!!cleaningTarget || !canRunMassDelete} className="p-4 bg-white dark:bg-slate-900 border-2 border-rose-400 rounded-xl flex items-center justify-between hover:bg-rose-50 dark:hover:bg-rose-950/40 group transition-all disabled:opacity-50">
                        <span className="font-bold text-rose-800 text-sm text-left">Borrado total de turnos<br/><span className="font-normal text-[10px] text-rose-600">Elimina toda la colección <code className="bg-rose-100 dark:bg-rose-900 px-1 rounded">turnos</code> (planificación / operaciones)</span></span>
                        {cleaningTarget === 'SHIFTS' ? <RefreshCw className="animate-spin text-rose-500 shrink-0"/> : <Trash2 className="text-rose-400 group-hover:text-rose-700 shrink-0"/>}
                    </button>
                </div>
            </div>

            {shiftDeleteModalOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-rose-200 dark:border-rose-800">
                        <div className="flex justify-between items-start mb-4">
                            <h4 className="text-lg font-black text-rose-700 dark:text-rose-400 flex items-center gap-2"><AlertTriangle size={22}/> Borrado total de turnos</h4>
                            <button type="button" onClick={() => setShiftDeleteModalOpen(false)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500"><X size={20}/></button>
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
                            Se eliminarán <strong>todos</strong> los documentos de la colección <code className="text-xs bg-slate-100 dark:bg-slate-900 px-1 rounded">turnos</code> en Firestore (incluye vacantes huérfanas, planificación cargada, etc.). No afecta empleados, clientes ni servicios SLA.
                        </p>
                        <p className="text-xs font-bold text-rose-600 mb-2">Para confirmar, escribí exactamente:</p>
                        <p className="text-xs font-mono bg-rose-50 dark:bg-rose-950/50 p-2 rounded border border-rose-200 mb-3">{PHRASE_DELETE_ALL_SHIFTS}</p>
                        <input
                            type="text"
                            autoFocus
                            value={shiftDeletePhrase}
                            onChange={(e) => setShiftDeletePhrase(e.target.value)}
                            className="w-full p-3 border-2 border-slate-200 dark:border-slate-600 rounded-xl font-mono text-sm dark:bg-slate-900 dark:text-white mb-4"
                            placeholder="Escribí la frase aquí"
                        />
                        <div className="flex gap-3 justify-end">
                            <button type="button" onClick={() => setShiftDeleteModalOpen(false)} className="px-4 py-2 rounded-xl font-bold text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700">Cancelar</button>
                            <button
                                type="button"
                                disabled={shiftDeletePhrase.trim() !== PHRASE_DELETE_ALL_SHIFTS || !!cleaningTarget}
                                onClick={confirmShiftMassDelete}
                                className="px-6 py-2 rounded-xl font-black text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Ejecutar borrado
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}