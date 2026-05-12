'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  Users, 
  FileText, 
  Settings, 
  Clock, 
  Shield,
  Briefcase
} from 'lucide-react';

const menuItems = [
  {
    title: 'Dashboard',
    icon: LayoutDashboard,
    href: '/dashboard',
    variant: 'default'
  },
  {
    title: 'Centro Control',
    icon: Shield,
    href: '/dashboard/operaciones',
    variant: 'ghost'
  },
  {
    title: 'Planificador',
    icon: Clock,
    href: '/dashboard/planificador',
    variant: 'ghost'
  },
  {
    title: 'CRM Clientes',
    icon: Briefcase,
    href: '/dashboard/crm',
    variant: 'ghost'
  },
  {
    title: 'RRHH',
    icon: Users,
    href: '/dashboard/rrhh',
    variant: 'ghost'
  },
  {
    title: 'Reportes',
    icon: FileText,
    href: '/dashboard/reportes',
    variant: 'ghost'
  },
  {
    title: 'Configuración',
    icon: Settings,
    href: '/dashboard/configuracion',
    variant: 'ghost'
  }
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    // MODIFICADO: Agregada clase 'print:hidden' para ocultar al imprimir
    <aside className="w-64 bg-gray-900 text-white min-h-screen p-4 flex flex-col print:hidden">
      <div className="mb-8 px-2">
        <h1 className="text-2xl font-bold text-blue-400">COSP V 1.0</h1>
        <p className="text-[11px] text-gray-400 truncate max-w-[14rem]">Grupo Bacar</p>
      </div>

      <nav className="space-y-2 flex-1">
        {menuItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                isActive 
                  ? 'bg-blue-600 text-white' 
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <item.icon className="w-5 h-5" />
              <span>{item.title}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto pt-4 border-t border-gray-800">
        <div className="px-4 py-2">
          <p className="text-sm font-medium">Usuario Admin</p>
          <p className="text-xs text-gray-500">admin@cronoapp.com</p>
        </div>
      </div>
    </aside>
  );
}
