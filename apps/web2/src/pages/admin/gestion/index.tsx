import React from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Construction } from 'lucide-react';

export default function GestionPage() {
  return (
    <DashboardLayout>
      <div className="flex flex-col items-center justify-center h-[60vh] text-text-muted">
        <Construction size={64} className="mb-4 opacity-50" />
        <h2 className="text-2xl font-black uppercase">Gestión Operativa</h2>
        <p>Módulo en desarrollo.</p>
      </div>
    </DashboardLayout>
  );
}