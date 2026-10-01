import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { MOVIL_RUTAS } from '@/lib/movil/navItems';

const ACCESOS = [
  { key: 'OPERATIONS', label: 'Operación', href: MOVIL_RUTAS.operacion },
  { key: 'SUPERVISION', label: 'Supervisión', href: MOVIL_RUTAS.supervision },
  { key: 'PLANNING', label: 'Planificación', href: MOVIL_RUTAS.planificacion },
  { key: 'EVENTUALES', label: 'Eventuales', href: MOVIL_RUTAS.eventuales },
  { key: 'RRHH', label: 'RRHH', href: MOVIL_RUTAS.rrhh },
  { key: 'SERVICES', label: 'Servicios', href: MOVIL_RUTAS.servicios },
] as const;

/** Lista corta para el menú Más. SuperAdmin ve todo; el resto, según permiso de lectura. */
export function MovilAccesos({ onNavigate }: { onNavigate?: () => void }) {
  const { isSuperAdmin, canReadModule } = useAuth();
  const items = ACCESOS.filter((item) => {
    if (item.label === 'Eventuales') return isSuperAdmin || canReadModule('EVENTUALES') || canReadModule('RRHH');
    return isSuperAdmin || canReadModule(item.key);
  });
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <Link key={item.label} href={item.href} onClick={onNavigate} className="flex min-h-12 items-center rounded-2xl border border-slate-200 px-3 text-sm font-black text-slate-900">
          {item.label}
        </Link>
      ))}
    </div>
  );
}
