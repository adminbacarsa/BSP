import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '@/context/AuthContext';
import { auth } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import { Toaster } from 'sonner';
import { 
  Menu, X, LogOut, Briefcase, BarChart3, Users, 
  Settings, Calendar, LayoutDashboard, Radio, ShieldCheck, Siren, Camera
} from 'lucide-react';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const router = useRouter();
  const { user } = useAuth();

  const handleLogout = async () => {
    try {
      await signOut(auth);
      window.location.href = '/login';
    } catch (error) {
      console.error("Error cerrando sesión:", error);
    }
  };

  const isActive = (path: string) => router.pathname.startsWith(path);
  
  const getLinkClass = (path: string, special = false) => {
    const base = `flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium text-sm ${!isSidebarOpen ? 'justify-center px-2' : ''}`;
    
    if (isActive(path)) {
       return `${base} bg-indigo-600 text-white shadow-lg shadow-indigo-900/50`;
    }
    
    if (special) {
       return `${base} bg-rose-600/10 text-rose-400 hover:bg-rose-600 hover:text-white border border-rose-900/50 hover:border-rose-500`;
    }
    
    return `${base} text-slate-300 hover:bg-slate-800 hover:text-white`;
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors duration-300 flex">
      <Toaster position="top-right" richColors closeButton expand={true} />

      {/* SIDEBAR */}
      <aside 
        className={`fixed top-0 left-0 z-40 h-screen transition-all duration-300 bg-slate-900 text-white border-r border-slate-800 flex flex-col
        ${isSidebarOpen ? 'w-64 translate-x-0' : 'w-20 -translate-x-full lg:translate-x-0'} 
        `}
      >
        
        <div className={`p-6 flex items-center ${isSidebarOpen ? 'justify-between' : 'justify-center'} shrink-0`}>
          {isSidebarOpen ? (
             <span className="text-xl font-black tracking-tighter text-indigo-400">CRONOAPP</span>
          ) : (
             <ShieldCheck className="text-indigo-400" />
          )}
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-slate-400 hover:text-white"><X/></button>
        </div>

        <nav className="px-3 space-y-2 mt-4 flex-1 overflow-y-auto custom-scrollbar">
          
          {isSidebarOpen && <div className="px-4 py-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">Operativa</div>}
          
          <Link href="/admin/dashboard" prefetch={false} className={getLinkClass('/admin/dashboard')} title="Dashboard">
            <LayoutDashboard size={20}/> {isSidebarOpen && <span>Dashboard</span>}
          </Link>
          
          <Link href="/admin/operaciones" prefetch={false} className={getLinkClass('/admin/operaciones', true)} title="Centro Control">
            <Radio size={20}/> {isSidebarOpen && <span>Centro Control</span>}
          </Link>
          
          <Link href="/admin/planificacion" prefetch={false} className={getLinkClass('/admin/planificacion')} title="Planificador">
            <Calendar size={20}/> {isSidebarOpen && <span>Planificador</span>}
          </Link>

          <Link href="/admin/pruebas-alertas" prefetch={false} className={getLinkClass('/admin/pruebas-alertas')} title="Pruebas NVR">
            <Siren size={20}/> {isSidebarOpen && <span>Pruebas NVR</span>}
          </Link>
          <Link href="/admin/camera-routes" prefetch={false} className={getLinkClass('/admin/camera-routes')} title="Cámaras NVR">
            <Camera size={20}/> {isSidebarOpen && <span>Cámaras NVR</span>}
          </Link>

          {isSidebarOpen && <div className="px-4 py-2 text-[10px] font-black text-slate-500 uppercase tracking-widest mt-4">Gestión</div>}
          
          <Link href="/admin/crm" prefetch={false} className={getLinkClass('/admin/crm')} title="CRM Clientes">
            <Briefcase size={20}/> {isSidebarOpen && <span>CRM Clientes</span>}
          </Link>
          
          <Link href="/admin/servicios" prefetch={false} className={getLinkClass('/admin/servicios')} title="Servicios">
            <ShieldCheck size={20}/> {isSidebarOpen && <span>Servicios</span>}
          </Link>

          {/* ✅ AQUÍ ESTÁ EL ENLACE RESTAURADO */}
          <Link href="/admin/reportes" prefetch={false} className={getLinkClass('/admin/reportes')} title="Reportes">
            <BarChart3 size={20}/> {isSidebarOpen && <span>Reportes</span>}
          </Link>
          
          <Link href="/admin/rrhh" prefetch={false} className={getLinkClass('/admin/rrhh')} title="RRHH">
            <Users size={20}/> {isSidebarOpen && <span>RRHH</span>}
          </Link>

           {isSidebarOpen && <div className="px-4 py-2 text-[10px] font-black text-slate-500 uppercase tracking-widest mt-4">Sistema</div>}
          
          <Link href="/admin/configuracion" prefetch={false} className={getLinkClass('/admin/configuracion')} title="Configuración">
            <Settings size={20}/> {isSidebarOpen && <span>Configuración</span>}
          </Link>
        </nav>

        <div className="p-4 border-t border-slate-800 shrink-0 flex flex-col gap-2">
           <button onClick={handleLogout} className="w-full flex items-center justify-center gap-3 px-4 py-3 text-rose-400 hover:bg-rose-900/20 hover:text-rose-300 rounded-xl transition-all font-medium text-sm" title="Cerrar Sesión">
            <LogOut size={20}/> {isSidebarOpen && <span>Salir</span>}
          </button>
        </div>
      </aside>

      {/* CONTENIDO */}
      <div className={`flex-1 transition-all duration-300 ${isSidebarOpen ? 'lg:ml-64' : 'lg:ml-20'}`}>
        <div className="bg-white dark:bg-slate-800 p-4 shadow-sm border-b border-slate-200 dark:border-slate-700 flex items-center gap-4 sticky top-0 z-30">
           <button 
             onClick={() => setSidebarOpen(!isSidebarOpen)} 
             className="p-2 rounded-lg hover:bg-slate-100 text-slate-600 dark:text-slate-200 transition-colors"
           >
             <Menu size={24} />
           </button>
           <span className="font-black text-slate-700 dark:text-white uppercase tracking-tight">
             {isSidebarOpen ? 'Panel de Control' : 'CronoApp'}
           </span>
        </div>

        <main className="p-4 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}