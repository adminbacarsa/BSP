import * as admin from 'firebase-admin';

export type PayrollHoursMode = 'planned' | 'real';

/** Modo publicado desde Liquidaciones. Si no hay setting, se usa planificadas. */
export async function resolveEmpresaHoursMode(empresaId: string): Promise<PayrollHoursMode> {
    const id = String(empresaId || '').trim();
    if (!id) return 'planned';
    const snap = await admin.firestore().collection('payroll_settings').doc(id).get();
    return snap.data()?.hoursMode === 'real' ? 'real' : 'planned';
}
