export const SYSTEM_MODULES = [
    { key: 'DASHBOARD', label: '📊 Dashboard Principal' },
    { key: 'OPERATIONS', label: '🎯 Operaciones' },
    { key: 'PLANNING', label: '📅 Planificación y Turnos' },
    { key: 'PLANNING_AI', label: '🤖 IA — Optimización de Planificación' },
    { key: 'RRHH', label: '👥 RRHH y Legajos' },
    { key: 'CLIENTS', label: '🏢 Clientes y Objetivos' },
    { key: 'SERVICES', label: '📋 Servicios y SLA' },
    { key: 'REPORTS', label: '📈 Reportes y Liquidación' },
    { key: 'ANALYSIS', label: '🔬 Análisis Operativo' },
    { key: 'SUPERVISION', label: '🛡️ Supervisión' },
    { key: 'ASSISTANT', label: '🤖 Asistente IA (globo)' },
    { key: 'CONFIG', label: '⚙️ Configuración Global' }
];

export const PERMISSION_ACTIONS: { key: string; label: string; onlyModules?: string[] }[] = [
    { key: 'read',   label: 'Ver' },
    { key: 'create', label: 'Crear' },
    { key: 'update', label: 'Editar' },
    { key: 'delete', label: 'Borrar' },
    { key: 'publish', label: 'Publicar', onlyModules: ['PLANNING'] },
    { key: 'correct', label: 'Corregir', onlyModules: ['PLANNING'] },
    { key: 'auto_lab', label: 'Auto Lab', onlyModules: ['PLANNING'] },
    { key: 'adjust', label: 'Ajustar', onlyModules: ['RRHH'] },
];