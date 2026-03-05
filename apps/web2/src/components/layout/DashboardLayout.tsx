import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '@/context/AuthContext';
import { auth } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import { Toaster } from 'sonner';
import { PageHeaderProvider, usePageHeader } from '@/context/PageHeaderContext';
import { 
  Menu, X, LogOut, Briefcase, BarChart3, Users, 
  Settings, Calendar, LayoutDashboard, Radio, ShieldCheck, Camera, ClipboardList, ChevronDown, ChevronRight, Activity, AlertCircle
} from 'lucide-react';

/** Título del header según el módulo (ruta) actual */
function getTitleByPath(pathname: string): string | null {
  if (pathname.startsWith('/admin/dashboard')) return 'Dashboard';
  if (pathname.startsWith('/admin/operaciones')) {
    if (pathname.includes('/vivo')) return 'Vivo';
    if (pathname.includes('/map-view')) return 'Mapa táctico';
    return 'Operaciones | COSP';
  }
  if (pathname.startsWith('/admin/planificacion')) return 'Planificador';
  if (pathname.startsWith('/admin/camera-routes')) return 'NVR | Servidor';
  if (pathname.startsWith('/admin/reportes-eventos-camaras')) return 'Reporte eventos';
  if (pathname.startsWith('/admin/alertas-dashboard')) return 'Dashboard alertas';
  if (pathname.startsWith('/admin/crm')) return 'CRM Clientes';
  if (pathname.startsWith('/admin/servicios')) return 'Servicios';
  if (pathname.startsWith('/admin/reportes')) return 'Reportes';
  if (pathname.startsWith('/admin/rrhh')) return 'RRHH';
  if (pathname.startsWith('/admin/configuracion')) return 'Configuración';
  if (pathname.startsWith('/admin/empleados')) return 'Empleados';
  if (pathname.startsWith('/admin/cotizador')) return 'Cotizador';
  return null;
}

function DashboardHeader({ isSidebarOpen, onToggleSidebar }: { isSidebarOpen: boolean; onToggleSidebar: () => void }) {
  const router = useRouter();
  const { user } = useAuth();
  const pageHeader = usePageHeader();
  // Inicializar siempre true para evitar hydration mismatch (servidor no tiene navigator)
  const [isOnline, setIsOnline] = useState(true);
  const [userRole, setUserRole] = useState<string>('');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsOnline(navigator.onLine);
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);
  useEffect(() => {
    if (!user) {
      setUserRole('');
      return;
    }
    user.getIdTokenResult()
      .then((res) => {
        const claims = (res?.claims || {}) as Record<string, unknown>;
        const role = (claims?.role ?? claims?.type ?? '') as string;
        setUserRole(role ? String(role) : '');
      })
      .catch(() => setUserRole(''));
  }, [user]);
  const titleByPath = getTitleByPath(router.pathname);
  const title = pageHeader.title ?? titleByPath ?? (isSidebarOpen ? 'Panel de Control' : 'CronoApp');
  const operatorName = user?.displayName || user?.email?.split('@')[0] || 'Usuario';
  const roleLabel = userRole || 'Operador';
  return (
    <div className="bg-white dark:bg-slate-800 p-4 shadow-sm border-b border-slate-200 dark:border-slate-700 flex items-center gap-4 sticky top-0 z-30 flex-wrap">
      <button
        onClick={onToggleSidebar}
        className="p-2 rounded-lg hover:bg-slate-100 text-slate-600 dark:text-slate-200 transition-colors shrink-0"
      >
        <Menu size={24} />
      </button>
      <span className="font-black text-slate-700 dark:text-white uppercase tracking-tight shrink-0">
        {title}
      </span>
      <div className="flex items-center gap-3 ml-auto min-w-0 flex-1 justify-end">
        {pageHeader.right != null && <div className="flex items-center gap-2">{pageHeader.right}</div>}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400 hidden sm:inline">{roleLabel}: <b className="text-slate-800 dark:text-slate-200">{operatorName}</b></span>
          {isOnline ? (
            <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-1 rounded-full border border-emerald-200 dark:border-emerald-800">
              <Activity size={12} /> ONLINE
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-1 rounded-full border border-amber-200 dark:border-amber-800">
              <AlertCircle size={12} /> OFFLINE
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [nvrMenuOpen, setNvrMenuOpen] = useState(false);
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
             <div className="flex flex-col min-w-0">
               <span className="text-xl font-black tracking-tighter text-indigo-400">COSP V 1.0</span>
               <span className="text-[11px] text-slate-400 truncate max-w-[14rem]">Grupo Bacar</span>
             </div>
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

          {/* NVR | Servidor: al hacer clic se despliegan Reporte eventos y Dashboard alertas */}
          {isSidebarOpen ? (
            <>
              <button type="button" onClick={() => setNvrMenuOpen(!nvrMenuOpen)} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium text-sm text-slate-300 hover:bg-slate-800 hover:text-white ${isActive('/admin/camera-routes') || isActive('/admin/reportes-eventos-camaras') || isActive('/admin/alertas-dashboard') ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/50' : ''}`}>
                <Camera size={20}/>
                <span className="flex-1 text-left">NVR | Servidor</span>
                {nvrMenuOpen ? <ChevronDown size={18}/> : <ChevronRight size={18}/>}
              </button>
              {nvrMenuOpen && (
                <div className="pl-8 space-y-1">
                  <Link href="/admin/camera-routes" prefetch={false} className={getLinkClass('/admin/camera-routes')} title="NVR | Servidor">
                    <Camera size={18}/> <span>Cámaras / Servidor</span>
                  </Link>
                  <Link href="/admin/reportes-eventos-camaras" prefetch={false} className={getLinkClass('/admin/reportes-eventos-camaras')} title="Reporte eventos cámaras">
                    <ClipboardList size={18}/> <span>Reporte eventos</span>
                  </Link>
                  <Link href="/admin/alertas-dashboard" prefetch={false} className={getLinkClass('/admin/alertas-dashboard')} title="Dashboard alertas">
                    <BarChart3 size={18}/> <span>Dashboard alertas</span>
                  </Link>
                </div>
              )}
            </>
          ) : (
            <Link href="/admin/camera-routes" prefetch={false} className={getLinkClass('/admin/camera-routes')} title="NVR | Servidor">
              <Camera size={20}/> {!isSidebarOpen && <span className="sr-only">NVR</span>}
            </Link>
          )}

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
        <PageHeaderProvider>
          <DashboardHeader isSidebarOpen={isSidebarOpen} onToggleSidebar={() => setSidebarOpen(!isSidebarOpen)} />
          <main className="p-4 lg:p-8">
            {children}
          </main>
        </PageHeaderProvider>
      </div>
    </div>
  );
}