import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { Settings, Users, Shield, Database, Building2, HardDrive, Bot, Activity, Scale } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import UsersTab from '@/components/admin/config/UsersTab';
import RolesTab from '@/components/admin/config/RolesTab';
import GeneralTab from '@/components/admin/config/GeneralTab';
import EmpresasTab from '@/components/admin/config/EmpresasTab';
import BackupTab from '@/components/admin/config/BackupTab';
import AssistantLogTab from '@/components/admin/config/AssistantLogTab';
import PlatformHealthTab from '@/components/admin/config/PlatformHealthTab';
import PlanningRulesTab from '@/components/admin/config/PlanningRulesTab';
import { useAuth } from '@/context/AuthContext';
import { PageShell, PageHeader, TabBar } from '@/components/ui';

export default function ConfigPage() {
    const [activeTab, setActiveTab] = useState<'GENERAL' | 'PLANNING' | 'USERS' | 'ROLES' | 'EMPRESAS' | 'BACKUP' | 'ASSISTANT' | 'HEALTH'>('GENERAL');
    const router = useRouter();
    const { loading, canReadModule } = useAuth();

    useEffect(() => {
        if (loading) return;
        if (!canReadModule('CONFIG')) {
            router.replace('/admin/dashboard');
        }
    }, [loading, canReadModule, router]);

    if (loading) {
        return (
            <DashboardLayout>
                <div className="p-12 text-center text-slate-500 font-bold">Cargando permisos…</div>
            </DashboardLayout>
        );
    }

    if (!canReadModule('CONFIG')) {
        return (
            <DashboardLayout>
                <div className="p-12 text-center text-slate-500 font-bold">Redirigiendo…</div>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout>
            <Head><title>Configuración | COSP V1.0</title></Head>
            <PageShell>
                <div className="max-w-7xl mx-auto space-y-6">
                    <PageHeader
                        title="Configuración"
                        subtitle="Parámetros, usuarios de plataforma y seguridad"
                        icon={Settings}
                    />
                    <TabBar
                        tabs={[
                            { id: 'GENERAL',   label: 'Sistema',          icon: Database },
                            { id: 'PLANNING',  label: 'Planificación',    icon: Scale },
                            { id: 'USERS',     label: 'Usuarios Admin',   icon: Users },
                            { id: 'ROLES',     label: 'Roles y Permisos', icon: Shield },
                            { id: 'EMPRESAS',  label: 'Empresas',         icon: Building2 },
                            { id: 'BACKUP',    label: 'Backups',          icon: HardDrive },
                            { id: 'ASSISTANT', label: 'AI Asistente',     icon: Bot },
                            { id: 'HEALTH',    label: 'Salud',            icon: Activity },
                        ]}
                        active={activeTab}
                        onChange={id => setActiveTab(id as typeof activeTab)}
                    />
                    <div>
                        {activeTab === 'GENERAL'   && <GeneralTab />}
                        {activeTab === 'PLANNING' && <PlanningRulesTab />}
                        {activeTab === 'USERS'     && <UsersTab />}
                        {activeTab === 'ROLES'     && <RolesTab />}
                        {activeTab === 'EMPRESAS'  && <EmpresasTab />}
                        {activeTab === 'BACKUP'    && <BackupTab />}
                        {activeTab === 'ASSISTANT' && <AssistantLogTab />}
                        {activeTab === 'HEALTH'    && <PlatformHealthTab />}
                    </div>
                </div>
            </PageShell>
        </DashboardLayout>
    );
}