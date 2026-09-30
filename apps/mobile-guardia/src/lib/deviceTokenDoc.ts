/** Payload de `device_tokens/{token}` (puro — sin Firebase / React). */

export function buildDeviceTokenDoc(params: {
  uid: string;
  employeeId: string | null;
  empresaId?: string | null;
  token: string;
  platform: 'web' | 'ios' | 'android';
  previewOf?: boolean;
  /** `Constants.nativeAppVersion`: el servidor elige el canal de alertas con esto. */
  nativeVersion?: string | null;
}): Record<string, unknown> {
  const docData: Record<string, unknown> = {
    uid: params.uid,
    employeeId: params.employeeId,
    empresaId: params.empresaId != null && params.empresaId !== '' ? params.empresaId : null,
    token: params.token,
    platform: params.platform,
    role: 'employee',
  };
  if (params.previewOf === true) {
    docData.previewOf = true;
  }
  const nativeVersion = String(params.nativeVersion ?? '').trim();
  if (nativeVersion) {
    docData.nativeVersion = nativeVersion;
  }
  return docData;
}
