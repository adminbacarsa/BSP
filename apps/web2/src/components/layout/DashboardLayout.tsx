import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { auth } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import { Toaster } from 'sonner';
import { PageHeaderProvider, usePageHeader } from '@/context/PageHeaderContext';
import {
  Menu, X, LogOut, Briefcase, BarChart3, Users,
  Settings, Calendar, LayoutDashboard, Radio, ShieldCheck, Activity, AlertCircle, BookOpen, Building2, ChevronDown, TrendingUp
} from 'lucide-react';
import { getStoredTheme, type AppTheme } from '@/lib/themeManager';

// ─── Company color theming ────────────────────────────────────────────────────
function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g: h = ((b - r) / d + 2) / 6; break;
    case b: h = ((r - g) / d + 4) / 6; break;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}
function hslToHex(h: number, s: number, l: number): string {
  const sl = s / 100, ll = l / 100;
  const a = sl * Math.min(ll, 1 - ll);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (ll - a * Math.max(Math.min(k - 3, 9 - k, 1), -1))).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
const BRAND_STYLE_ID = 'cosp-brand-overrides';

function buildCompanyTheme(hex: string): Record<string, string> {
  const [h, s] = hexToHsl(hex);
  const sat = Math.min(s, 88);
  return {
    '--sb-bg':                    hslToHex(h, sat, 13),
    '--sb-border':                hslToHex(h, sat - 10, 22),
    '--sb-text':                  hslToHex(h, 22, 83),
    '--sb-muted':                 hslToHex(h, 18, 52),
    '--sb-section':               hslToHex(h, sat - 20, 40),
    '--sb-active-bg':             hex,
    '--sb-active-text':           '#ffffff',
    '--sb-hover-bg':              hslToHex(h, sat - 10, 21),
    '--sb-hover-text':            '#ffffff',
    '--sb-logo':                  hslToHex(h, Math.min(sat + 8, 100), 78),
    '--sb-logo-sub':              hslToHex(h, 18, 55),
    '--sb-logout':                '#f43f5e',
    '--sb-special-bg':            'rgba(239,68,68,0.12)',
    '--sb-special-text':          '#fca5a5',
    '--sb-special-border':        'rgba(239,68,68,0.3)',
    '--app-bg':                   '#f8fafc',
    '--topbar-bg':                '#ffffff',
    '--topbar-border':            '#e2e8f0',
    '--topbar-text':              '#0f172a',
    '--company-primary':          hex,
    '--company-primary-dark':     hslToHex(h, sat, 35),
    '--company-primary-darker':   hslToHex(h, sat, 27),
    '--company-primary-light':    hslToHex(h, Math.min(sat, 70), 65),
    '--company-primary-lighter':  hslToHex(h, Math.min(sat, 55), 92),
    '--company-primary-lightest': hslToHex(h, Math.min(sat, 45), 96),
    '--company-primary-ring':     hex + '80',
  };
}
const COMPANY_THEME_VARS = [
  '--sb-bg','--sb-border','--sb-text','--sb-muted','--sb-section',
  '--sb-active-bg','--sb-active-text','--sb-hover-bg','--sb-hover-text',
  '--sb-logo','--sb-logo-sub','--app-bg','--topbar-bg','--topbar-border',
  '--topbar-text','--company-primary','--company-primary-dark',
  '--company-primary-darker','--company-primary-light',
  '--company-primary-lighter','--company-primary-lightest','--company-primary-ring',
];

/** Título del header según el módulo (ruta) actual */
function getTitleByPath(pathname: string): string | null {
  if (pathname.startsWith('/admin/dashboard'))       return 'Dashboard';
  if (pathname.startsWith('/admin/operaciones'))     return 'Operaciones | COSP';
  if (pathname.startsWith('/admin/planificacion'))   return 'Planificador';
  if (pathname.startsWith('/admin/camera-routes'))   return 'NVR | Servidor';
  if (pathname.startsWith('/admin/reportes-eventos-camaras')) return 'Reporte eventos';
  if (pathname.startsWith('/admin/alertas-dashboard')) return 'Dashboard alertas';
  if (pathname.startsWith('/admin/crm'))             return 'CRM Clientes';
  if (pathname.startsWith('/admin/servicios'))       return 'Servicios';
  if (pathname.startsWith('/admin/reportes'))        return 'Reportes';
  if (pathname.startsWith('/admin/rrhh'))            return 'RRHH';
  if (pathname.startsWith('/admin/guia'))            return 'Guía interactiva';
  if (pathname.startsWith('/admin/configuracion'))   return 'Configuración';
  if (pathname.startsWith('/admin/empleados'))       return 'Empleados';
  if (pathname.startsWith('/admin/cotizador'))       return 'Cotizador';
  if (pathname.startsWith('/admin/analisis'))        return 'Análisis Operativo';
  return null;
}

// ─── TOPBAR ──────────────────────────────────────────────────────────────────
function DashboardHeader({ isSidebarOpen, onToggleSidebar }: { isSidebarOpen: boolean; onToggleSidebar: () => void }) {
  const router = useRouter();
  const { user, assignedClientId, isSuperAdmin } = useAuth();
  const { empresa, empresas, switchEmpresa, empresaId } = useEmpresa();
  const pageHeader = usePageHeader();
  const [isOnline, setIsOnline] = useState(true);
  const [userRole, setUserRole] = useState('');
  const [showEmpresaDrop, setShowEmpresaDrop] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsOnline(navigator.onLine);
    const on  = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  useEffect(() => {
    if (!user) { setUserRole(''); return; }
    user.getIdTokenResult()
      .then(res => { const r = (res?.claims?.role ?? res?.claims?.type ?? '') as string; setUserRole(r || ''); })
      .catch(() => setUserRole(''));
  }, [user]);

  const title = pageHeader.title ?? getTitleByPath(router.pathname) ?? 'Panel de Control';
  const operatorName = user?.displayName || user?.email?.split('@')[0] || 'Usuario';
  const roleLabel = userRole || 'Operador';

  const isEmulator = process.env.NEXT_PUBLIC_USE_EMULATOR === 'true';

  return (
    <div
      className="shadow-sm border-b flex flex-col sticky z-30"
      style={{ backgroundColor: 'var(--topbar-bg)', borderColor: 'var(--topbar-border)', color: 'var(--topbar-text)', top: 0 }}
    >
      {/* Banda de advertencia modo emulador */}
      {isEmulator && (
        <div className="w-full bg-amber-400 text-amber-900 text-[11px] font-bold text-center py-0.5 tracking-wide">
          ⚠ MODO EMULADOR LOCAL — los datos no son de producción
        </div>
      )}
      {/* Window Controls Overlay: rellena el área del título nativo cuando WCO está activo */}
      <div style={{ height: 'env(titlebar-area-height, 0px)', WebkitAppRegion: 'drag' } as React.CSSProperties} />
      <div className="p-4 flex items-center gap-4 flex-wrap">
      <button
        onClick={onToggleSidebar}
        className="p-2 rounded-lg hover:bg-black/5 transition-colors shrink-0"
        style={{ color: 'var(--topbar-text)' }}
      >
        <Menu size={22} />
      </button>
      <span className="font-black uppercase tracking-tight shrink-0 text-sm" style={{ color: 'var(--topbar-text)' }}>
        {title}
      </span>
      {assignedClientId && (
        <span className="text-[10px] font-bold text-amber-700 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-full">
          Vista restringida
        </span>
      )}
      {/* Selector de empresa — badge para todos, dropdown para superadmin */}
      {empresa && (
        <div className="relative">
          <button
            onClick={() => isSuperAdmin && setShowEmpresaDrop(d => !d)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-black border transition-colors ${
              isSuperAdmin ? 'cursor-pointer' : 'bg-slate-100 text-slate-600 border-slate-200 cursor-default'
            }`}
            style={isSuperAdmin ? {
              backgroundColor: 'var(--company-primary, #4f46e5)',
              color: '#ffffff',
              borderColor: 'var(--company-primary, #4338ca)',
            } : undefined}
            title={isSuperAdmin ? 'Cambiar empresa' : empresa.name}
          >
            <Building2 size={12} />
            <span className="hidden sm:inline max-w-[120px] truncate">{empresa.name || empresa.id}</span>
            {isSuperAdmin && <ChevronDown size={11} />}
          </button>
          {isSuperAdmin && showEmpresaDrop && (
            <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-xl min-w-[200px] max-h-64 overflow-y-auto">
              {empresas.length === 0 && (
                <p className="px-4 py-3 text-xs text-slate-400">Sin empresas registradas</p>
              )}
              {empresas.map(e => (
                <button
                  key={e.id}
                  onClick={() => { switchEmpresa(e.id); setShowEmpresaDrop(false); }}
                  className={`w-full text-left px-4 py-2.5 text-sm font-semibold transition-colors first:rounded-t-xl last:rounded-b-xl border-b border-slate-100 last:border-0 ${
                    e.id === empresaId ? 'bg-indigo-600 text-white' : 'text-slate-700 hover:bg-indigo-50 hover:text-indigo-700'
                  }`}
                >
                  {e.name || e.id}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="flex items-center gap-3 ml-auto min-w-0 flex-1 justify-end">
        {pageHeader.right != null && <div className="flex items-center gap-2">{pageHeader.right}</div>}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-medium hidden sm:inline" style={{ color: 'var(--topbar-text)', opacity: 0.7 }}>
            {roleLabel}: <b style={{ opacity: 1 }}>{operatorName}</b>
          </span>
          {isOnline ? (
            <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-1 rounded-full border border-emerald-200 dark:border-emerald-800">
              <Activity size={11} /> ONLINE
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-100 px-2 py-1 rounded-full border border-amber-300 animate-pulse" title="Sin conexión — los cambios se guardan localmente y se sincronizarán al volver la conexión.">
              <AlertCircle size={11} />
              <span>OFFLINE</span>
              <span className="hidden sm:inline font-medium opacity-80">· cambios pendientes de sync</span>
            </span>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

// ─── INNER LAYOUT (dentro del PageHeaderProvider) ────────────────────────────
function LayoutInner({ children }: { children: React.ReactNode }) {
  const [isPinned, setIsPinned] = useState(false);   // usuario fija el sidebar abierto
  const [isHovered, setIsHovered] = useState(false); // expansión temporal por hover
  const [topbarVisible, setTopbarVisible] = useState(false); // topbar overlay en modo compacto
  const router = useRouter();
  const { canReadModule } = useAuth();
  const { compactSidebar } = usePageHeader();
  const { empresa } = useEmpresa();

  // Sidebar visible si está pinned O si el mouse está encima — salvo modo compacto (Planificador)
  const sidebarOpen = !compactSidebar && (isPinned || isHovered);

  // Al navegar a otra ruta, colapsar el pin para volver a modo mini
  useEffect(() => {
    setIsPinned(false);
    setIsHovered(false);
  }, [router.pathname]);

  // Inyecta/revierte variables CSS de color de empresa + overrides Tailwind en páginas
  useEffect(() => {
    const root = document.documentElement;
    if (empresa?.primaryColor) {
      const theme = buildCompanyTheme(empresa.primaryColor);
      Object.entries(theme).forEach(([k, v]) => root.style.setProperty(k, v));
      root.setAttribute('data-brand', '1');
      let styleEl = document.getElementById(BRAND_STYLE_ID) as HTMLStyleElement | null;
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = BRAND_STYLE_ID;
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = `
        html[data-brand] .bg-indigo-600,
        html[data-brand] .bg-indigo-500 { background-color: var(--company-primary) !important; }
        html[data-brand] .bg-indigo-700 { background-color: var(--company-primary-dark) !important; }
        html[data-brand] .bg-indigo-800 { background-color: var(--company-primary-darker) !important; }
        html[data-brand] .hover\\:bg-indigo-700:hover { background-color: var(--company-primary-dark) !important; }
        html[data-brand] .hover\\:bg-indigo-600:hover { background-color: var(--company-primary) !important; }
        html[data-brand] .bg-indigo-50 { background-color: var(--company-primary-lightest) !important; }
        html[data-brand] .bg-indigo-100 { background-color: var(--company-primary-lighter) !important; }
        html[data-brand] .text-indigo-600,
        html[data-brand] .text-indigo-500 { color: var(--company-primary) !important; }
        html[data-brand] .text-indigo-700 { color: var(--company-primary-dark) !important; }
        html[data-brand] .text-indigo-800 { color: var(--company-primary-darker) !important; }
        html[data-brand] .text-indigo-400 { color: var(--company-primary-light) !important; }
        html[data-brand] .border-indigo-300,
        html[data-brand] .border-indigo-400,
        html[data-brand] .border-indigo-500 { border-color: var(--company-primary) !important; }
        html[data-brand] .border-indigo-200 { border-color: var(--company-primary-lighter) !important; }
        html[data-brand] .ring-indigo-500,
        html[data-brand] .ring-indigo-400,
        html[data-brand] .ring-indigo-300 { --tw-ring-color: var(--company-primary-ring) !important; }
        html[data-brand] .focus\\:ring-indigo-400:focus,
        html[data-brand] .focus\\:ring-indigo-500:focus { --tw-ring-color: var(--company-primary-ring) !important; }
        html[data-brand] .focus\\:border-indigo-500:focus,
        html[data-brand] .focus\\:border-indigo-400:focus { border-color: var(--company-primary) !important; }
        html[data-brand] .from-indigo-500,
        html[data-brand] .from-indigo-600 { --tw-gradient-from: var(--company-primary) !important; }
        html[data-brand] .to-indigo-600,
        html[data-brand] .to-indigo-700 { --tw-gradient-to: var(--company-primary-dark) !important; }
        html[data-brand] .divide-indigo-200 > * + * { border-color: var(--company-primary-lighter) !important; }
      `;
    } else {
      COMPANY_THEME_VARS.forEach(k => root.style.removeProperty(k));
      root.removeAttribute('data-brand');
      document.getElementById(BRAND_STYLE_ID)?.remove();
    }
  }, [empresa?.primaryColor]);

  const handleLogout = async () => {
    try { await signOut(auth); window.location.href = '/login'; } catch (e) { console.error(e); }
  };

  const isActive = (path: string) => router.pathname.startsWith(path);

  const linkBase = `flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all text-sm font-medium ${!sidebarOpen ? 'justify-center px-2' : ''}`;

  const getLinkStyle = (path: string, special = false): React.CSSProperties => {
    if (isActive(path)) return { backgroundColor: 'var(--sb-active-bg)', color: 'var(--sb-active-text)' };
    if (special) return { backgroundColor: 'var(--sb-special-bg)', color: 'var(--sb-special-text)', border: '1px solid var(--sb-special-border)' };
    return { color: 'var(--sb-text)' };
  };

  const getLinkHoverClass = (path: string) =>
    isActive(path) ? linkBase : `${linkBase} hover:opacity-90`;

  return (
    <>
      {/* ── SIDEBAR ─────────────────────────────────────────────────── */}
      <aside
        onMouseEnter={() => !compactSidebar && setIsHovered(true)}
        onMouseLeave={() => { setIsHovered(false); setIsPinned(false); }}
        className={`fixed top-0 left-0 z-40 h-screen transition-all duration-300 ease-in-out border-r flex flex-col overflow-hidden
          ${sidebarOpen ? 'w-64' : 'w-16 lg:w-16'} ${!sidebarOpen ? '-translate-x-full lg:translate-x-0' : 'translate-x-0'}`}
        style={{ backgroundColor: 'var(--sb-bg)', borderColor: 'var(--sb-border)', color: 'var(--sb-text)' }}
      >
        {/* WCO: empuja el logo a la misma altura que el topbar */}
        <div style={{ height: 'env(titlebar-area-height, 0px)', flexShrink: 0 }} />
        {/* Logo */}
        <div className={`flex items-center shrink-0 border-b overflow-hidden ${sidebarOpen ? 'p-5 justify-between' : 'p-4 justify-center'}`}
          style={{ borderColor: 'var(--sb-border)' }}>
          {sidebarOpen ? (
            <div className="flex flex-col min-w-0 animate-in fade-in duration-150">
              <span className="text-lg font-black tracking-tighter whitespace-nowrap" style={{ color: 'var(--sb-logo)' }}>COSP V 1.0</span>
              <span className="text-[11px] font-semibold whitespace-nowrap" style={{ color: 'var(--sb-logo-sub)' }}>Seguridad Privada</span>
              <span className="text-[10px] truncate max-w-[14rem] opacity-60" style={{ color: 'var(--sb-logo-sub)' }}>{empresa?.name || empresa?.id || 'Grupo Bacar'}</span>
            </div>
          ) : (
            <ShieldCheck size={20} style={{ color: 'var(--sb-logo)' }} />
          )}
          {sidebarOpen && (
            <button onClick={() => { setIsPinned(false); setIsHovered(false); }} className="lg:hidden opacity-60 hover:opacity-100 shrink-0"
              style={{ color: 'var(--sb-text)' }}><X size={18}/></button>
          )}
        </div>

        {/* Nav */}
        <nav className="px-2 space-y-0.5 mt-3 flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar pb-4">

          {sidebarOpen && (
            <div className="px-3 py-2 text-[9px] font-black uppercase tracking-widest animate-in fade-in duration-150"
              style={{ color: 'var(--sb-section)' }}>Operativa</div>
          )}

          {canReadModule('DASHBOARD') && (
            <Link href="/admin/dashboard" prefetch={false} title="Dashboard"
              className={getLinkHoverClass('/admin/dashboard')}
              style={getLinkStyle('/admin/dashboard')}>
              <LayoutDashboard size={18} className="shrink-0"/> {sidebarOpen && <span className="animate-in fade-in duration-150 whitespace-nowrap">Dashboard</span>}
            </Link>
          )}

          {(canReadModule('OPERATIONS') || canReadModule('DASHBOARD') || canReadModule('PLANNING')) && (
            <Link href="/admin/operaciones" prefetch={false} title="Centro Control"
              className={getLinkHoverClass('/admin/operaciones')}
              style={getLinkStyle('/admin/operaciones', true)}>
              <Radio size={18} className="shrink-0"/> {sidebarOpen && <span className="animate-in fade-in duration-150 whitespace-nowrap">Centro Control</span>}
            </Link>
          )}

          {canReadModule('PLANNING') && (
            <Link href="/admin/planificacion" prefetch={false} title="Planificador"
              className={getLinkHoverClass('/admin/planificacion')}
              style={getLinkStyle('/admin/planificacion')}>
              <Calendar size={18} className="shrink-0"/> {sidebarOpen && <span className="animate-in fade-in duration-150 whitespace-nowrap">Planificador</span>}
            </Link>
          )}

          {(canReadModule('CLIENTS') || canReadModule('SERVICES')) && (<>
            {sidebarOpen && (
              <div className="px-3 py-2 text-[9px] font-black uppercase tracking-widest mt-3 animate-in fade-in duration-150"
                style={{ color: 'var(--sb-section)' }}>Gestión</div>
            )}
            {!sidebarOpen && <div className="h-3" />}
            {canReadModule('CLIENTS') && (
              <Link href="/admin/crm" prefetch={false} title="CRM Clientes"
                className={getLinkHoverClass('/admin/crm')}
                style={getLinkStyle('/admin/crm')}>
                <Briefcase size={18} className="shrink-0"/> {sidebarOpen && <span className="animate-in fade-in duration-150 whitespace-nowrap">CRM Clientes</span>}
              </Link>
            )}
            {(canReadModule('SERVICES') || canReadModule('CLIENTS')) && (
              <Link href="/admin/servicios" prefetch={false} title="Servicios"
                className={getLinkHoverClass('/admin/servicios')}
                style={getLinkStyle('/admin/servicios')}>
                <ShieldCheck size={18} className="shrink-0"/> {sidebarOpen && <span className="animate-in fade-in duration-150 whitespace-nowrap">Servicios</span>}
              </Link>
            )}
          </>)}

          {canReadModule('REPORTS') && (
            <Link href="/admin/reportes" prefetch={false} title="Reportes"
              className={getLinkHoverClass('/admin/reportes')}
              style={getLinkStyle('/admin/reportes')}>
              <BarChart3 size={18} className="shrink-0"/> {sidebarOpen && <span className="animate-in fade-in duration-150 whitespace-nowrap">Reportes</span>}
            </Link>
          )}

          {canReadModule('ANALYSIS') && (
            <Link href="/admin/analisis" prefetch={false} title="Análisis Operativo"
              className={getLinkHoverClass('/admin/analisis')}
              style={getLinkStyle('/admin/analisis')}>
              <TrendingUp size={18} className="shrink-0"/> {sidebarOpen && <span className="animate-in fade-in duration-150 whitespace-nowrap">Análisis</span>}
            </Link>
          )}

          {canReadModule('RRHH') && (
            <Link href="/admin/rrhh" prefetch={false} title="RRHH"
              className={getLinkHoverClass('/admin/rrhh')}
              style={getLinkStyle('/admin/rrhh')}>
              <Users size={18} className="shrink-0"/> {sidebarOpen && <span className="animate-in fade-in duration-150 whitespace-nowrap">RRHH</span>}
            </Link>
          )}

          {canReadModule('CONFIG') && (<>
            {sidebarOpen && (
              <div className="px-3 py-2 text-[9px] font-black uppercase tracking-widest mt-3 animate-in fade-in duration-150"
                style={{ color: 'var(--sb-section)' }}>Sistema</div>
            )}
            {!sidebarOpen && <div className="h-3" />}
            <Link href="/admin/configuracion" prefetch={false} title="Configuración"
              className={getLinkHoverClass('/admin/configuracion')}
              style={getLinkStyle('/admin/configuracion')}>
              <Settings size={18} className="shrink-0"/> {sidebarOpen && <span className="animate-in fade-in duration-150 whitespace-nowrap">Configuración</span>}
            </Link>
            <Link href="/admin/guia" prefetch={false} title="Guía interactiva"
              className={getLinkHoverClass('/admin/guia')}
              style={getLinkStyle('/admin/guia')}>
              <BookOpen size={18} className="shrink-0"/> {sidebarOpen && <span className="animate-in fade-in duration-150 whitespace-nowrap">Guía interactiva</span>}
            </Link>
          </>)}
        </nav>

        {/* Logout */}
        <div className="p-2 border-t shrink-0" style={{ borderColor: 'var(--sb-border)' }}>
          <button onClick={handleLogout}
            className={`w-full flex items-center ${sidebarOpen ? 'gap-3 px-4' : 'justify-center'} py-2.5 rounded-xl transition-all font-medium text-sm hover:opacity-80`}
            style={{ color: 'var(--sb-logout)' }} title="Cerrar Sesión">
            <LogOut size={18} className="shrink-0"/> {sidebarOpen && <span className="animate-in fade-in duration-150 whitespace-nowrap">Salir</span>}
          </button>
        </div>
      </aside>

      {/* ── CONTENIDO ───────────────────────────────────────────────── */}
      {compactSidebar ? (
        /* Modo planificador con cliente: topbar oculto, se revela al hacer hover en la franja superior */
        <div className="flex-1 lg:ml-16 h-screen overflow-hidden relative">
          {/* Franja de trigger — siempre visible, captura el hover */}
          <div
            className="absolute top-0 left-0 right-0 h-2 z-50 cursor-n-resize"
            onMouseEnter={() => setTopbarVisible(true)}
          />
          {/* Topbar overlay — desliza desde arriba */}
          <div
            className={`absolute top-0 left-0 right-0 z-40 transition-transform duration-200 ease-out shadow-2xl ${topbarVisible ? 'translate-y-0' : '-translate-y-full'}`}
            onMouseLeave={() => setTopbarVisible(false)}
          >
            <DashboardHeader isSidebarOpen={isPinned} onToggleSidebar={() => setIsPinned(p => !p)} />
          </div>
          {/* Indicador visual en el borde superior */}
          <div className={`absolute top-0 left-1/2 -translate-x-1/2 z-50 transition-opacity duration-300 ${topbarVisible ? 'opacity-0' : 'opacity-60'}`}>
            <div className="w-12 h-1 rounded-b-full bg-slate-500/60 mt-0" />
          </div>
          <main className="h-full overflow-hidden min-h-0">
            {children}
          </main>
        </div>
      ) : (
        <div className="flex-1 transition-all duration-300 ease-in-out lg:ml-16">
          <DashboardHeader isSidebarOpen={isPinned} onToggleSidebar={() => setIsPinned(p => !p)} />
          <main className="p-4 lg:p-8">
            {children}
          </main>
        </div>
      )}
    </>
  );
}

// ─── LAYOUT (shell con tema + provider) ──────────────────────────────────────
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<AppTheme>('light');

  useEffect(() => {
    setTheme(getStoredTheme());
    const handler = (e: Event) => setTheme((e as CustomEvent<AppTheme>).detail);
    window.addEventListener('cosp:theme', handler);
    return () => window.removeEventListener('cosp:theme', handler);
  }, []);

  return (
    <div className="min-h-screen transition-colors duration-200 flex" style={{ backgroundColor: 'var(--app-bg)' }}>
      <Toaster position="top-right" richColors closeButton expand />
      <PageHeaderProvider>
        <LayoutInner>{children}</LayoutInner>
      </PageHeaderProvider>
    </div>
  );
}
