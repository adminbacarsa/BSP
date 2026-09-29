import { FieldValue, type Firestore } from 'firebase-admin/firestore';

export type ConvocatoriaEvento = {
  type: 'CREADA' | 'PUSH' | 'RESPUESTA' | 'RESULTADO';
  at?: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
  origin?: 'AUTO' | 'CC' | 'DEMO';
  createdBy?: string;
  tokenSuffix?: string;
  result?: 'sent' | 'failed' | 'no_token';
  errorCode?: string;
  response?: 'ACCEPTED' | 'REJECTED' | 'TIMEOUT';
  channel?: string;
  deviceId?: string;
  platform?: string;
  appVersion?: string;
  outcome?: 'aplicada' | 'revalidacion_rechazada' | 'cancelada';
  reason?: string;
};

export function canalOrigenConvocatoria(createdBy: unknown): 'AUTO' | 'CC' | 'DEMO' {
  const by = String(createdBy || '').trim();
  if (by === 'AUTO') return 'AUTO';
  if (by === 'MODO_DEMO') return 'DEMO';
  return 'CC';
}

export async function logConvocatoriaEvento(
  db: Firestore,
  convocatoriaId: string,
  event: ConvocatoriaEvento,
): Promise<void> {
  const id = String(convocatoriaId || '').trim();
  if (!id) return;
  const { at, ...rest } = event;
  const clean: Record<string, unknown> = { at: at || FieldValue.serverTimestamp() };
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) clean[key] = value;
  }
  await db.collection('convocatorias_cobertura').doc(id).collection('eventos').add(clean);
}
