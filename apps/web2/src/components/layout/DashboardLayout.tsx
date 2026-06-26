import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, writeBatch, doc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { Toaster } from 'sonner';
import { PageHeaderProvider, usePageHeader } from '@/context/PageHeaderContext';
import {
  Menu, X, LogOut, Briefcase, BarChart3, Users,
  Settings, Calendar, LayoutDashboard, Radio, ShieldCheck, Activity, AlertCircle, BookOpen, Building2, ChevronDown, TrendingUp, Shield
} from 'lucide-react';
import { getStoredTheme, type AppTheme } from '@/lib/themeManager';
import { applyCompanyTheme } from '@/lib/companyTheme';
import { solicitudRefuerzoService } from '@/services/solicitudRefuerzoService';

/** Título del header según el módulo (ruta) actual */
function getTitleByPath(pathname: string): string | null {
  if (pathname.startsWith('/admin/dashboard'))       return 'Dashboard';
  if (pathname.startsWith('/admin/operaciones'))     return 'Operaciones';
  if (pathname.startsWith('/admin/planificacion'))   return 'Planificador';
  if (pathname.startsWith('/admin/crm'))             return 'CRM';
  if (pathname.startsWith('/admin/servicios'))       return 'Servicios';
  if (pathname.startsWith('/admin/reportes'))        return 'Reportes';
  if (pathname.startsWith('/admin/rrhh'))            return 'RRHH';
  if (pathname.startsWith('/admin/guia'))            return 'Guía';
  if (pathname.startsWith('/admin/configuracion'))   return 'Config';
  if (pathname.startsWith('/admin/empleados'))       return 'Empleados';
  if (pathname.startsWith('/admin/cotizador'))       return 'Cotizador';
  if (pathname.startsWith('/admin/analisis'))        return 'Análisis';
  if (pathname.startsWith('/admin/kpis'))            return 'KPIs';
  return null;
}

// ─── BOTTOM NAV (mobile) ─────────────────────────────────────────────────────
const BOTTOM_NAV = [
  { href: '/admin/dashboard',   icon: LayoutDashboard, label: 'Inicio'   },
  { href: '/admin/operaciones', icon: Radio,           label: 'CC'       },
  { href: '/admin/rrhh',        icon: Users,           label: 'RRHH'     },
  { href: '/admin/reportes',    icon: BarChart3,        label: 'Reportes' },
];

function BottomNav() {
  const router = useRouter();
  const isActive = (href: string) => router.pathname.startsWith(href);
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex items-stretch border-t lg:hidden safe-area-bottom"
      style={{ backgroundColor: 'var(--topbar-bg)', borderColor: 'var(--sb-border)' }}
      aria-label="Navegación mobile"
    >
      {BOTTOM_NAV.map(({ href, icon: Icon, label }) => (
        <Link
          key={href}
          href={href}
          prefetch={false}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-opacity active:opacity-60 min-h-[52px]"
          style={{
            color: isActive(href) ? 'var(--company-primary, #6366f1)' : 'var(--sb-muted)',
          }}
        >
          <Icon size={20} strokeWidth={isActive(href) ? 2.5 : 1.8} />
          <span className="text-[9px] font-black uppercase tracking-wide">{label}</span>
          {isActive(href) && (
            <span className="absolute bottom-0 w-8 h-0.5 rounded-full" style={{ backgroundColor: 'var(--company-primary, #6366f1)' }} />
          )}
        </Link>
      ))}
    </nav>
  );
}

// ─── TOPBAR ──────────────────────────────────────────────────────────────────
function DashboardHeader({ isSidebarOpen, onToggleSidebar, onLogout }: { isSidebarOpen: boolean; onToggleSidebar: () => void; onLogout: () => void }) {
  const router = useRouter();
  const { user, assignedClientId, isSuperAdmin, allEmpresas, userRole: authUserRole } = useAuth();
  const { empresa, empresas, switchEmpresa, empresaId } = useEmpresa();
  const pageHeader = usePageHeader();
  const [isOnline, setIsOnline] = useState(true);
  const [claimRole, setClaimRole] = useState('');
  const [showEmpresaDrop, setShowEmpresaDrop] = useState(false);
  const [empresaDropPos, setEmpresaDropPos] = useState<{ x: number; y: number } | null>(null);
  const empresaBtnRef = useRef<HTMLButtonElement>(null);
  const canSwitchEmpresa = isSuperAdmin || allEmpresas;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Verificación real: navigator.onLine solo detecta red, no internet
    const checkRealConnectivity = async () => {
      if (!navigator.onLine) { setIsOnline(false); return; }
      try {
        await fetch('https://www.google.com/favicon.ico', {
          method: 'HEAD', mode: 'no-cors', cache: 'no-store',
          signal: AbortSignal.timeout(4000),
        });
        setIsOnline(true);
      } catch {
        setIsOnline(false);
      }
    };

    checkRealConnectivity();
    const interval = setInterval(checkRealConnectivity, 30000);
    const on  = () => checkRealConnectivity();
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      clearInterval(interval);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    if (!user) { setClaimRole(''); return; }
    user.getIdTokenResult()
      .then(res => { const r = (res?.claims?.role ?? res?.claims?.type ?? '') as string; setClaimRole(r || ''); })
      .catch(() => setClaimRole(''));
  }, [user]);

  const repositionEmpresaDrop = useCallback(() => {
    const rect = empresaBtnRef.current?.getBoundingClientRect();
    if (rect) setEmpresaDropPos({ x: rect.left, y: rect.bottom + 4 });
  }, []);

  useEffect(() => {
    if (!showEmpresaDrop) return;
    repositionEmpresaDrop();
    window.addEventListener('scroll', repositionEmpresaDrop, true);
    window.addEventListener('resize', repositionEmpresaDrop);
    return () => {
      window.removeEventListener('scroll', repositionEmpresaDrop, true);
      window.removeEventListener('resize', repositionEmpresaDrop);
    };
  }, [showEmpresaDrop, repositionEmpresaDrop]);

  useEffect(() => {
    if (!showEmpresaDrop) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (empresaBtnRef.current?.contains(t)) return;
      setShowEmpresaDrop(false);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [showEmpresaDrop]);

  const title = pageHeader.title ?? getTitleByPath(router.pathname) ?? 'Panel';
  const operatorName = user?.displayName?.split(' ')[0] || user?.email?.split('@')[0] || 'Usuario';
  const roleLabel = isSuperAdmin ? 'SuperAdmin' : (authUserRole || claimRole || 'Operador');
  const isEmulator = process.env.NEXT_PUBLIC_USE_EMULATOR === 'true';

  return (
    <div
      className="shadow-sm border-b sticky z-50"
      style={{ backgroundColor: 'var(--topbar-bg)', borderColor: 'var(--topbar-border)', color: 'var(--topbar-text)', top: 0 }}
    >
      {isEmulator && (
        <div className="w-full bg-amber-400 text-amber-900 text-[10px] font-bold text-center py-0.5 tracking-wide">
          ⚠ MODO EMULADOR LOCAL — datos de prueba
        </div>
      )}
      <div style={{ height: 'env(titlebar-area-height, 0px)', WebkitAppRegion: 'drag' } as React.CSSProperties} />

      {/* Topbar row */}
      <div className="h-14 px-3 flex items-center gap-2 overflow-visible">
        {/* Hamburger — solo en desktop (mobile usa bottom nav) */}
        <button
          onClick={onToggleSidebar}
          aria-label={isSidebarOpen ? 'Cerrar menú' : 'Abrir menú'}
          aria-expanded={isSidebarOpen}
          aria-controls="sidebar-nav"
          className="hidden lg:flex p-2 rounded-lg hover:bg-white/10 transition-colors shrink-0"
          style={{ color: 'var(--topbar-text)' }}
        >
          <Menu size={20} aria-hidden="true" />
        </button>

        {/* Título del módulo */}
        <span className="font-black uppercase tracking-tight text-sm shrink-0" style={{ color: 'var(--topbar-text)' }}>
          {title}
        </span>

        {/* Badges compactos */}
        {isSuperAdmin && (
          <span className="hidden sm:inline text-[9px] font-black uppercase text-amber-900 bg-amber-200 border border-amber-400 px-1.5 py-0.5 rounded-full shrink-0">
            SA
          </span>
        )}

        {/* Selector de empresa */}
        {empresa && (
          <div className="relative shrink-0">
            <button
              ref={empresaBtnRef}
              onClick={(e) => {
                e.stopPropagation();
                if (!canSwitchEmpresa) return;
                if (showEmpresaDrop) {
                  setShowEmpresaDrop(false);
                } else {
                  repositionEmpresaDrop();
                  setShowEmpresaDrop(true);
                }
              }}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black border transition-colors max-w-[100px] sm:max-w-[140px]"
              style={canSwitchEmpresa ? {
                backgroundColor: 'var(--company-primary, #4f46e5)',
                color: '#ffffff',
                borderColor: 'var(--company-primary, #4338ca)',
              } : { backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt2)' }}
              title={empresa.name}
            >
              <Building2 size={11} className="shrink-0" />
              <span className="truncate">{empresa.name || empresa.id}</span>
              {canSwitchEmpresa && <ChevronDown size={10} className="shrink-0" />}
            </button>
            {canSwitchEmpresa && showEmpresaDrop && empresaDropPos && typeof document !== 'undefined' && createPortal(
              <>
                <div className="fixed inset-0 z-[9998]" aria-hidden onClick={() => setShowEmpresaDrop(false)} />
                <div
                  className="fixed z-[9999] border rounded-xl shadow-xl min-w-[180px] max-h-64 overflow-y-auto"
                  style={{ left: empresaDropPos.x, top: empresaDropPos.y, backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}
                  onClick={e => e.stopPropagation()}
                >
                  {empresas.filter(e => e.active !== false).map(e => (
                    <button
                      key={e.id}
                      onClick={() => { switchEmpresa(e.id); setShowEmpresaDrop(false); }}
                      className="w-full text-left px-4 py-2.5 text-sm font-semibold transition-colors first:rounded-t-xl last:rounded-b-xl border-b last:border-0"
                      style={{
                        backgroundColor: e.id === empresaId ? 'var(--company-primary, #6366f1)' : undefined,
                        color: e.id === empresaId ? '#fff' : 'var(--txt)',
                        borderColor: 'var(--border)',
                      }}
                    >
                      {e.name || e.id}
                    </button>
                  ))}
                </div>
              </>,
              document.body,
            )}
          </div>
        )}

        {/* Acciones derecha */}
        <div className="flex items-center gap-2 ml-auto min-w-0 shrink-0">
          {pageHeader.right != null && <div className="flex items-center gap-2">{pageHeader.right}</div>}

          {/* Nombre usuario — solo sm+ */}
          <span className="hidden sm:block text-xs font-medium truncate max-w-[120px]" style={{ color: 'var(--topbar-text)', opacity: 0.7 }}>
            <b style={{ opacity: 1 }}>{operatorName}</b>
          </span>

          {/* Estado online */}
          {isOnline ? (
            <span role="status" aria-label="Sistema en línea"
              className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-1 rounded-full border border-emerald-200 dark:border-emerald-800 shrink-0">
              <Activity size={10} aria-hidden="true" />
              <span className="hidden sm:inline">ONLINE</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 px-2 py-1 rounded-full border border-red-300 animate-pulse shrink-0"
              title="Sin conexión a internet — los datos no se actualizan">
              <AlertCircle size={10} />
              <span>SIN INTERNET</span>
            </span>
          )}

          {/* Logout — solo en mobile (el sidebar está oculto) */}
          <button
            onClick={onLogout}
            aria-label="Cerrar Sesión"
            title="Cerrar Sesión"
            className="lg:hidden p-2 rounded-lg transition-colors shrink-0 hover:bg-white/10 active:opacity-60"
            style={{ color: 'var(--topbar-text)', opacity: 0.75 }}
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── INNER LAYOUT ─────────────────────────────────────────────────────────────
function LayoutInner({ children }: { children: React.ReactNode }) {
  const [isPinned, setIsPinned]       = useState(false);
  const [isHovered, setIsHovered]     = useState(false);
  const [topbarVisible, setTopbarVisible] = useState(false);
  const router = useRouter();
  const { canReadModule } = useAuth();
  const { compactSidebar } = usePageHeader();
  const { empresa, empresaId } = useEmpresa();
  const [pendientesCount, setPendientesCount] = useState(0);
  const [rfzPlanifCount, setRfzPlanifCount] = useState(0);
  const [rfzPlanifIds, setRfzPlanifIds] = useState<string[]>([]);
  const canViewSupervision = canReadModule('SUPERVISION');
  const canViewPlanning = canReadModule('PLANNING');

  useEffect(() => {
    if (!empresaId || !canViewSupervision) return;
    // El badge de Supervisión cuenta SOLO refuerzos pendientes (lo que el supervisor
    // tiene para tratar). Las ausencias/vacaciones tienen su propio flujo y no se cuentan acá.
    const unsubR = solicitudRefuerzoService.subscribeByEmpresa(empresaId, items => {
      setPendientesCount(items.filter(s => s.estado === 'PENDIENTE').length);
    });
    return () => { unsubR(); };
  }, [empresaId, canViewSupervision]);

  useEffect(() => {
    if (!empresaId || !canViewPlanning) return;
    const q = query(
      collection(db, 'novedades'),
      where('empresaId', '==', empresaId),
      where('type', '==', 'REFUERZO_CLIENTE_PENDIENTE'),
      where('status', '==', 'pending'),
    );
    const unsub = onSnapshot(q, snap => {
      setRfzPlanifCount(snap.size);
      setRfzPlanifIds(snap.docs.map(d => d.id));
    }, () => {});
    return unsub;
  }, [empresaId, canViewPlanning]);

  const sidebarOpen = !compactSidebar && (isPinned || isHovered);

  useEffect(() => {
    setIsPinned(false);
    setIsHovered(false);
  }, [router.pathname]);

  // Cerrar sidebar en mobile al hacer resize a desktop
  useEffect(() => {
    const handler = () => { if (window.innerWidth >= 1024) setIsPinned(false); };
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useEffect(() => {
    applyCompanyTheme(empresa?.primaryColor || '#6366f1');
  }, [empresa?.primaryColor]);

  // Bloquear scroll del body cuando el sidebar mobile está abierto
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (isPinned && window.innerWidth < 1024) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isPinned]);

  const closeSidebar = useCallback(() => { setIsPinned(false); setIsHovered(false); }, []);

  const handleLogout = async () => {
    try { await signOut(auth); window.location.href = '/login'; } catch (e) { console.error(e); }
  };

  const isActive = (path: string) => router.pathname.startsWith(path);

  const linkBase = `flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-sm font-medium ${!sidebarOpen ? 'justify-center' : ''}`;

  const getLinkStyle = (path: string, special = false): React.CSSProperties => {
    if (isActive(path)) return { backgroundColor: 'var(--sb-active-bg)', color: 'var(--sb-active-text)' };
    if (special) return { backgroundColor: 'var(--sb-special-bg)', color: 'var(--sb-special-text)', border: '1px solid var(--sb-special-border)' };
    return { color: 'var(--sb-text)' };
  };

  const getLinkHoverClass = (path: string) =>
    isActive(path) ? linkBase : `${linkBase} hover:opacity-90`;

  return (
    <>
      {/* ── BACKDROP MOBILE ───────────────────────────────────────────── */}
      {isPinned && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}

      {/* ── SIDEBAR ───────────────────────────────────────────────────── */}
      <aside
        id="sidebar-nav"
        aria-label="Navegación principal"
        onMouseEnter={() => !compactSidebar && window.innerWidth >= 1024 && setIsHovered(true)}
        onMouseLeave={() => { setIsHovered(false); if (!isPinned) setIsPinned(false); }}
        className={`fixed top-0 left-0 z-40 h-screen transition-all duration-300 ease-in-out border-r flex flex-col overflow-hidden
          ${sidebarOpen ? 'w-64' : 'w-16'}
          ${!sidebarOpen ? '-translate-x-full lg:translate-x-0' : 'translate-x-0'}`}
        style={{ backgroundColor: 'var(--sb-bg)', borderColor: 'var(--sb-border)', color: 'var(--sb-text)' }}
      >
        <div style={{ height: 'env(titlebar-area-height, 0px)', flexShrink: 0 }} />

        {/* Logo / Header del sidebar */}
        <div
          className={`flex items-center shrink-0 border-b overflow-hidden ${sidebarOpen ? 'p-4 justify-between' : 'p-3 justify-center'}`}
          style={{ borderColor: 'var(--sb-border)' }}
        >
          {sidebarOpen ? (
            <div className="flex flex-col min-w-0 animate-in fade-in duration-150">
              <span className="text-base font-black tracking-tighter whitespace-nowrap" style={{ color: 'var(--sb-logo)' }}>COSP V 1.0</span>
              <span className="text-[10px] font-semibold whitespace-nowrap" style={{ color: 'var(--sb-logo-sub)' }}>Seguridad Privada</span>
            </div>
          ) : (
            <ShieldCheck size={18} style={{ color: 'var(--sb-logo)' }} />
          )}
          {sidebarOpen && (
            <button
              onClick={closeSidebar}
              className="p-1.5 rounded-lg opacity-60 hover:opacity-100 shrink-0 transition-opacity"
              style={{ color: 'var(--sb-text)' }}
              aria-label="Cerrar menú"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Navegación */}
        <nav className="px-2 space-y-0.5 mt-2 flex-1 overflow-y-auto overflow-x-hidden pb-4">
          {sidebarOpen && (
            <div className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest animate-in fade-in"
              style={{ color: 'var(--sb-section)' }}>Operativa</div>
          )}

          {canReadModule('DASHBOARD') && (
            <Link href="/admin/dashboard" prefetch={false} title="Dashboard"
              className={getLinkHoverClass('/admin/dashboard')}
              style={getLinkStyle('/admin/dashboard')}>
              <LayoutDashboard size={18} className="shrink-0" />
              {sidebarOpen && <span className="animate-in fade-in whitespace-nowrap">Dashboard</span>}
            </Link>
          )}

          {(canReadModule('OPERATIONS') || canReadModule('DASHBOARD') || canReadModule('PLANNING')) && (
            <Link href="/admin/operaciones" prefetch={false} title="Centro Control"
              className={getLinkHoverClass('/admin/operaciones')}
              style={getLinkStyle('/admin/operaciones', true)}>
              <Radio size={18} className="shrink-0" />
              {sidebarOpen && <span className="animate-in fade-in whitespace-nowrap">Centro Control</span>}
            </Link>
          )}

          {canReadModule('PLANNING') && (
            <Link href="/admin/planificacion" prefetch={false} title="Planificador"
              className={`${getLinkHoverClass('/admin/planificacion')} relative`}
              style={getLinkStyle('/admin/planificacion')}>
              <Calendar size={18} className="shrink-0" />
              {sidebarOpen && <span className="animate-in fade-in whitespace-nowrap flex-1">Planificador</span>}
              {rfzPlanifCount > 0 && (
                <button
                  type="button"
                  title="Marcar notificaciones RFZ como leídas"
                  onClick={async e => {
                    e.preventDefault(); e.stopPropagation();
                    if (!rfzPlanifIds.length) return;
                    const batch = writeBatch(db);
                    rfzPlanifIds.forEach(id => batch.update(doc(db, 'novedades', id), { status: 'read', viewed: true }));
                    await batch.commit();
                  }}
                  className={`${sidebarOpen ? '' : 'absolute -top-1 -right-1'} min-w-[18px] h-[18px] px-1 bg-red-500 hover:bg-red-700 text-white text-[9px] font-black rounded-full flex items-center justify-center transition-colors cursor-pointer`}
                >
                  {rfzPlanifCount > 99 ? '99+' : rfzPlanifCount}
                </button>
              )}
            </Link>
          )}

          {(canReadModule('CLIENTS') || canReadModule('SERVICES')) && (
            <>
              {sidebarOpen && (
                <div className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest mt-2 animate-in fade-in"
                  style={{ color: 'var(--sb-section)' }}>Gestión</div>
              )}
              {!sidebarOpen && <div className="h-2" />}
              {canReadModule('CLIENTS') && (
                <Link href="/admin/crm" prefetch={false} title="CRM Clientes"
                  className={getLinkHoverClass('/admin/crm')}
                  style={getLinkStyle('/admin/crm')}>
                  <Briefcase size={18} className="shrink-0" />
                  {sidebarOpen && <span className="animate-in fade-in whitespace-nowrap">CRM Clientes</span>}
                </Link>
              )}
              {(canReadModule('SERVICES') || canReadModule('CLIENTS')) && (
                <Link href="/admin/servicios" prefetch={false} title="Servicios"
                  className={getLinkHoverClass('/admin/servicios')}
                  style={getLinkStyle('/admin/servicios')}>
                  <ShieldCheck size={18} className="shrink-0" />
                  {sidebarOpen && <span className="animate-in fade-in whitespace-nowrap">Servicios</span>}
                </Link>
              )}
            </>
          )}

          {canReadModule('REPORTS') && (
            <Link href="/admin/reportes" prefetch={false} title="Reportes"
              className={getLinkHoverClass('/admin/reportes')}
              style={getLinkStyle('/admin/reportes')}>
              <BarChart3 size={18} className="shrink-0" />
              {sidebarOpen && <span className="animate-in fade-in whitespace-nowrap">Reportes</span>}
            </Link>
          )}

          {canReadModule('ANALYSIS') && (
            <>
            <Link href="/admin/analisis" prefetch={false} title="Análisis"
              className={getLinkHoverClass('/admin/analisis')}
              style={getLinkStyle('/admin/analisis')}>
              <TrendingUp size={18} className="shrink-0" />
              {sidebarOpen && <span className="animate-in fade-in whitespace-nowrap">Análisis</span>}
            </Link>
            <Link href="/admin/kpis" prefetch={false} title="KPIs Ejecutivo"
              className={getLinkHoverClass('/admin/kpis')}
              style={getLinkStyle('/admin/kpis')}>
              <BarChart3 size={18} className="shrink-0" />
              {sidebarOpen && <span className="animate-in fade-in whitespace-nowrap">KPIs</span>}
            </Link>
            </>
          )}

          {canReadModule('RRHH') && (
            <Link href="/admin/rrhh" prefetch={false} title="RRHH"
              className={getLinkHoverClass('/admin/rrhh')}
              style={getLinkStyle('/admin/rrhh')}>
              <Users size={18} className="shrink-0" />
              {sidebarOpen && <span className="animate-in fade-in whitespace-nowrap">RRHH</span>}
            </Link>
          )}

          {canReadModule('SUPERVISION') && (
            <Link href="/admin/supervision" prefetch={false} title="Supervisión"
              className={`${getLinkHoverClass('/admin/supervision')} relative`}
              style={getLinkStyle('/admin/supervision')}>
              <Shield size={18} className="shrink-0" />
              {sidebarOpen && <span className="animate-in fade-in whitespace-nowrap flex-1">Supervisión</span>}
              {pendientesCount > 0 && (
                <span className={`${sidebarOpen ? '' : 'absolute -top-1 -right-1'} min-w-[18px] h-[18px] px-1 bg-rose-500 text-white text-[9px] font-black rounded-full flex items-center justify-center`}>
                  {pendientesCount > 99 ? '99+' : pendientesCount}
                </span>
              )}
            </Link>
          )}

          {canReadModule('CONFIG') && (
            <>
              {sidebarOpen && (
                <div className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest mt-2 animate-in fade-in"
                  style={{ color: 'var(--sb-section)' }}>Sistema</div>
              )}
              {!sidebarOpen && <div className="h-2" />}
              <Link href="/admin/configuracion" prefetch={false} title="Configuración"
                className={getLinkHoverClass('/admin/configuracion')}
                style={getLinkStyle('/admin/configuracion')}>
                <Settings size={18} className="shrink-0" />
                {sidebarOpen && <span className="animate-in fade-in whitespace-nowrap">Configuración</span>}
              </Link>
              <Link href="/admin/guia" prefetch={false} title="Guía"
                className={getLinkHoverClass('/admin/guia')}
                style={getLinkStyle('/admin/guia')}>
                <BookOpen size={18} className="shrink-0" />
                {sidebarOpen && <span className="animate-in fade-in whitespace-nowrap">Guía interactiva</span>}
              </Link>
            </>
          )}
        </nav>

        {/* Logout */}
        <div className="p-2 border-t shrink-0" style={{ borderColor: 'var(--sb-border)' }}>
          <button
            onClick={handleLogout}
            className={`w-full flex items-center ${sidebarOpen ? 'gap-3 px-3' : 'justify-center'} py-2.5 rounded-xl transition-all font-medium text-sm hover:opacity-80`}
            style={{ color: 'var(--sb-logout)' }}
            title="Cerrar Sesión"
          >
            <LogOut size={18} className="shrink-0" />
            {sidebarOpen && <span className="animate-in fade-in whitespace-nowrap">Salir</span>}
          </button>
        </div>
      </aside>

      {/* ── CONTENIDO PRINCIPAL ───────────────────────────────────────── */}
      {compactSidebar ? (
        <div className="flex-1 lg:ml-16 h-screen overflow-hidden relative">
          <div className="absolute top-0 left-0 right-0 h-2 z-50 cursor-n-resize"
            onMouseEnter={() => setTopbarVisible(true)} />
          <div
            className={`absolute top-0 left-0 right-0 z-[100] transition-transform duration-200 ease-out shadow-2xl ${topbarVisible ? 'translate-y-0' : '-translate-y-full'}`}
            onMouseLeave={() => setTopbarVisible(false)}
          >
            <DashboardHeader isSidebarOpen={isPinned} onToggleSidebar={() => setIsPinned(p => !p)} onLogout={handleLogout} />
          </div>
          <div className={`absolute top-0 left-1/2 -translate-x-1/2 z-50 transition-opacity duration-300 ${topbarVisible ? 'opacity-0' : 'opacity-60'}`}>
            <div className="w-12 h-1 rounded-b-full bg-slate-500/60" />
          </div>
          <main className="h-full overflow-y-auto min-h-0">{children}</main>
        </div>
      ) : (
        <div className="flex-1 transition-all duration-300 ease-in-out lg:ml-16 min-w-0">
          <DashboardHeader isSidebarOpen={isPinned} onToggleSidebar={() => setIsPinned(p => !p)} onLogout={handleLogout} />
          {/* pb-20 en mobile para dejar espacio al bottom nav */}
          <main className="p-3 sm:p-5 lg:p-8 pb-24 lg:pb-8 overflow-x-hidden">
            {children}
          </main>
        </div>
      )}

      {/* ── BOTTOM NAVIGATION (mobile) ────────────────────────────────── */}
      <BottomNav />
    </>
  );
}

// ─── LAYOUT SHELL ─────────────────────────────────────────────────────────────
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<AppTheme>('light');

  useEffect(() => {
    setTheme(getStoredTheme());
    const handler = (e: Event) => setTheme((e as CustomEvent<AppTheme>).detail);
    window.addEventListener('cosp:theme', handler);
    return () => window.removeEventListener('cosp:theme', handler);
  }, []);

  return (
    <div className="min-h-screen transition-colors duration-200 flex overflow-x-hidden" style={{ backgroundColor: 'var(--app-bg)' }}>
      <Toaster position="top-center" richColors closeButton expand />
      <PageHeaderProvider>
        <LayoutInner>{children}</LayoutInner>
      </PageHeaderProvider>
    </div>
  );
}
