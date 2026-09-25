/** Payload de `device_tokens/{token}` (puro — sin Firebase / React). */

export type DeviceTokenAudience = 'guard' | 'staff';

export function buildDeviceTokenDoc(params: {
  uid: string;
  employeeId: string | null;
  empresaId?: string | null;
  token: string;
  platform: 'web' | 'ios' | 'android';
  previewOf?: boolean;
  /** guard → role employee; staff → role staff (canal push separado). */
  audience?: DeviceTokenAudience;
}): Record<string, unknown> {
  const audience = params.audience ?? 'guard';
  const docData: Record<string, unknown> = {
    uid: params.uid,
    employeeId: params.employeeId,
    empresaId: params.empresaId != null && params.empresaId !== '' ? params.empresaId : null,
    token: params.token,
    platform: params.platform,
    role: audience === 'staff' ? 'staff' : 'employee',
    pushAudience: audience,
  };
  if (params.previewOf === true) {
    docData.previewOf = true;
  }
  return docData;
}
