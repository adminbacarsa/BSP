export const initialLegajoForm = {
    firstName: '',
    lastName: '',
    dni: '',
    fileNumber: '',
    phone: '',
    email: '',
    category: '',
    status: 'activo',
    laborAgreement: '',
    preferredClientId: '',
    preferredObjectiveId: '',
    genero: '',
    sizes: { shirt: '', pants: '', shoes: '' },
    cuil: '',
    address: '',
    lat: null as string | null,
    lng: null as string | null,
    contractType: 'FullTime',
    periodType: 'Mensual',
    cycleStartDay: 26,
    maxHours: 200,
    restriccionesObjetivo: [] as any[],
    restriccionesCliente: [] as any[],
    conflictosEmpleados: [] as any[],
    experienciaObjetivos: {} as Record<string, unknown>,
    volante: [] as string[],
};

export function normalizeEmployeeStatus(status: unknown): string {
    const s = String(status || '').toLowerCase();
    if (s === 'active' || s === 'activo') return 'activo';
    if (s === 'inactive' || s === 'inactivo') return 'inactivo';
    return s || 'activo';
}

export function mapFirestoreToLegajoForm(id: string, data: Record<string, any>) {
    const clientId = data.preferredClientId || '';
    let preferredObjectiveId = data.preferredObjectiveId || '';
    return {
        ...initialLegajoForm,
        ...data,
        id,
        firstName: data.firstName || data.nombre || '',
        lastName: data.lastName || data.apellido || '',
        dni: data.dni || data.document || '',
        fileNumber: data.fileNumber || data.legajo || '',
        phone: data.phone || data.telefono || '',
        category: data.category || data.cargo || '',
        laborAgreement: data.laborAgreement || data.convenio || '',
        status: normalizeEmployeeStatus(data.status || data.estado),
        genero: data.genero || '',
        sizes: data.sizes || { shirt: '', pants: '', shoes: '' },
        restriccionesObjetivo: data.restriccionesObjetivo || [],
        restriccionesCliente: data.restriccionesCliente || [],
        conflictosEmpleados: data.conflictosEmpleados || [],
        experienciaObjetivos: data.experienciaObjetivos || {},
        volante: data.volante || [],
        preferredClientId: clientId,
        preferredObjectiveId,
        cycleStartDay: data.cycleStartDay ? Number(data.cycleStartDay) : 26,
    };
}

export function buildEmployeeSavePayload(form: Record<string, any>, empresaId: string) {
    return {
        firstName: form.firstName || '',
        lastName: form.lastName || '',
        name: `${form.lastName || ''}, ${form.firstName || ''}`.toUpperCase(),
        dni: form.dni || '',
        cuil: form.cuil || '',
        fileNumber: form.fileNumber || '',
        email: form.email || '',
        phone: form.phone || '',
        address: form.address || '',
        lat: form.lat || null,
        lng: form.lng || null,
        category: form.category || 'Vigilador',
        cct: form.cct || '',
        laborAgreement: form.laborAgreement || '',
        status: normalizeEmployeeStatus(form.status),
        role: 'employee',
        contractType: form.contractType || 'FullTime',
        periodType: form.periodType || 'Mensual',
        startDate: form.startDate || new Date().toISOString().split('T')[0],
        cycleStartDay: form.cycleStartDay ? parseInt(String(form.cycleStartDay), 10) : 26,
        maxHours: form.maxHours || 200,
        preferredClientId: form.preferredClientId || '',
        preferredObjectiveId: form.preferredObjectiveId || '',
        sizes: form.sizes || { shirt: '', pants: '', shoes: '' },
        restriccionesObjetivo: form.restriccionesObjetivo || [],
        restriccionesCliente: form.restriccionesCliente || [],
        conflictosEmpleados: form.conflictosEmpleados || [],
        volante: form.volante || [],
        genero: form.genero || '',
        empresaId,
    };
}
