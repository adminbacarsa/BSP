import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
    Save, Building, FileText, Mail, Phone, AlertTriangle, Trash2, 
    ShieldAlert, RefreshCw, Moon, Sun, Monitor, Zap, Hexagon, Camera, ArrowRight 
} from 'lucide-react';
import { functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { toast } from 'sonner';

export default function GeneralTab() {
    const [cleaningTarget, setCleaningTarget] = useState<string | null>(null);
    const [company, setCompany] = useState({ name: 'CronoApp Security', cuit: '', address: '', website: '', email: '', phone: '' });
    
    // TEMA SELECCIONADO
    const [theme, setTheme] = useState('system');

    useEffect(() => {
        // Cargar tema
        const savedTheme = localStorage.getItem('theme') || 'system';
        applyTheme(savedTheme);
    }, []);

    const applyTheme = (newTheme: string) => {
        setTheme(newTheme);
        localStorage.setItem('theme', newTheme);
        
        // Logica de clases en <html>
        const root = document.documentElement;
        root.classList.remove('dark', 'theme-contrast', 'theme-blue');
        
        if (newTheme === 'dark') root.classList.add('dark');
        if (newTheme === 'contrast') root.classList.add('theme-contrast'); // Clase para CSS global
        if (newTheme === 'blue') root.classList.add('theme-blue');         // Clase para CSS global
        
        // 'light' es el default sin clases extra
        
        if (newTheme === 'system') {
            if (window.matchMedia('(prefers-color-scheme: dark)').matches) root.classList.add('dark');
        }
    };

    const handleChange = (e: any) => setCompany({...company, [e.target.name]: e.target.value});

    const handleSaveCompany = () => {
        // Aquí podrías guardar en Firebase, por ahora simulamos
        toast.success("Datos de organización guardados");
    };

    const handleSystemClean = async (target: 'AUDIT' | 'SHIFTS') => {
        toast("⚠️ ¡PELIGRO! ¿Borrar datos?", {
            description: "Esta acción no se puede deshacer.",
            action: {
                label: 'SÍ, BORRAR TODO',
                onClick: async () => {
                    setCleaningTarget(target);
                    try {
                        const cleanFn = httpsCallable(functions, 'limpiarBaseDeDatos');
                        await cleanFn({ target });
                        toast.success("Limpieza completada con éxito");
                    } catch (error: any) { 
                        toast.error("Error: " + error.message); 
                    } finally { 
                        setCleaningTarget(null); 
                    }
                }
            },
            cancel: { label: 'Cancelar', onClick: () => {} },
        });
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
                    <button onClick={() => applyTheme('light')} className={`p-4 rounded-2xl border-2 flex flex-col items-center gap-3 transition-all hover:scale-105 ${theme === 'light' ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-100 hover:border-slate-300'}`}>
                        <div className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center shadow-sm"><Sun size={20} className="text-slate-600"/></div>
                        <span className="text-xs font-black uppercase text-slate-600">Claro</span>
                    </button>

                    {/* DARK */}
                    <button onClick={() => applyTheme('dark')} className={`p-4 rounded-2xl border-2 flex flex-col items-center gap-3 transition-all hover:scale-105 ${theme === 'dark' ? 'border-indigo-500 bg-slate-900 text-white' : 'border-slate-100 hover:border-slate-300'}`}>
                        <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center shadow-sm"><Moon size={20} className="text-white"/></div>
                        <span className="text-xs font-black uppercase text-slate-600 dark:text-slate-400">Oscuro</span>
                    </button>

                    {/* CONTRASTE */}
                    <button onClick={() => applyTheme('contrast')} className={`p-4 rounded-2xl border-2 flex flex-col items-center gap-3 transition-all hover:scale-105 ${theme === 'contrast' ? 'border-black bg-black text-yellow-400' : 'border-slate-100 hover:border-slate-300'}`}>
                        <div className="w-10 h-10 rounded-full bg-black border border-white flex items-center justify-center shadow-sm"><Zap size={20} className="text-yellow-400"/></div>
                        <span className="text-xs font-black uppercase text-slate-600">Contraste</span>
                    </button>

                    {/* AZUL / NAVY */}
                    <button onClick={() => applyTheme('blue')} className={`p-4 rounded-2xl border-2 flex flex-col items-center gap-3 transition-all hover:scale-105 ${theme === 'blue' ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-100 hover:border-slate-300'}`}>
                        <div className="w-10 h-10 rounded-full bg-blue-900 flex items-center justify-center shadow-sm"><Hexagon size={20} className="text-blue-200"/></div>
                        <span className="text-xs font-black uppercase text-slate-600">Azul Pro</span>
                    </button>

                    {/* SISTEMA */}
                    <button onClick={() => applyTheme('system')} className={`p-4 rounded-2xl border-2 flex flex-col items-center gap-3 transition-all hover:scale-105 ${theme === 'system' ? 'border-slate-400 bg-slate-100 text-slate-800' : 'border-slate-100 hover:border-slate-300'}`}>
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
                    <div><label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">Razón Social</label><input name="name" value={company.name} onChange={handleChange} className="w-full p-4 bg-slate-50 dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 focus:border-indigo-500 rounded-xl font-bold text-slate-900 dark:text-white outline-none transition-all"/></div>
                    <div><label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">CUIT</label><input name="cuit" value={company.cuit} onChange={handleChange} className="w-full p-4 bg-slate-50 dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 focus:border-indigo-500 rounded-xl font-mono font-medium text-slate-900 dark:text-white outline-none transition-all"/></div>
                    <div className="md:col-span-2"><label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">Dirección</label><div className="relative"><FileText size={20} className="absolute left-4 top-4 text-slate-400"/><input name="address" value={company.address} onChange={handleChange} className="w-full pl-12 p-4 bg-slate-50 dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 focus:border-indigo-500 rounded-xl font-medium text-slate-900 dark:text-white outline-none transition-all"/></div></div>
                </div>
                <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-700 flex justify-end">
                    <button onClick={handleSaveCompany} className="bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 text-white px-8 py-4 rounded-xl font-black text-xs uppercase flex items-center gap-2 shadow-xl hover:-translate-y-1 transition-all"><Save size={18}/> GUARDAR DATOS</button>
                </div>
            </div>

            {/* 2b. CÁMARAS NVR */}
            <div className="bg-white dark:bg-slate-800 p-8 rounded-[2rem] border border-slate-200 dark:border-slate-700 shadow-xl">
                <h3 className="text-xl font-black text-slate-800 dark:text-white mb-4 flex items-center gap-3">
                    <div className="p-3 bg-indigo-50 dark:bg-indigo-900/50 rounded-xl text-indigo-600 dark:text-indigo-400"><Camera size={24}/></div>
                    CÁMARAS NVR
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Configurá rutas de cámaras, asignación a cliente/objetivo y horarios de atención (ej. solo de noche o fines de semana).</p>
                <Link
                    href="/admin/camera-routes"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all"
                >
                    Abrir panel de Cámaras NVR
                    <ArrowRight size={18}/>
                </Link>
            </div>

            {/* 3. ZONA DE MANTENIMIENTO */}
            <div className="bg-rose-50 dark:bg-rose-950/20 p-8 rounded-[2rem] border-2 border-rose-100 dark:border-rose-900/50 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10"><ShieldAlert size={120} className="text-rose-600"/></div>
                <h3 className="text-xl font-black text-rose-700 dark:text-rose-400 mb-2 flex items-center gap-3"><AlertTriangle size={24}/> ZONA DE MANTENIMIENTO</h3>
                <p className="text-sm text-rose-600/80 mb-6 font-medium">Acciones destructivas e irreversibles para limpiar la base de datos.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10">
                    <button onClick={() => handleSystemClean('AUDIT')} disabled={!!cleaningTarget} className="p-4 bg-white dark:bg-slate-900 border border-rose-200 rounded-xl flex items-center justify-between hover:border-rose-400 group transition-all">
                        <span className="font-bold text-rose-700 text-sm">Borrar Historial</span>
                        {cleaningTarget === 'AUDIT' ? <RefreshCw className="animate-spin text-rose-500"/> : <Trash2 className="text-rose-300 group-hover:text-rose-600"/>}
                    </button>
                    <button onClick={() => handleSystemClean('SHIFTS')} disabled={!!cleaningTarget} className="p-4 bg-white dark:bg-slate-900 border border-rose-200 rounded-xl flex items-center justify-between hover:border-rose-400 group transition-all">
                        <span className="font-bold text-rose-700 text-sm">Borrar Turnos</span>
                        {cleaningTarget === 'SHIFTS' ? <RefreshCw className="animate-spin text-rose-500"/> : <Trash2 className="text-rose-300 group-hover:text-rose-600"/>}
                    </button>
                </div>
            </div>
        </div>
    );
}