import { httpsCallable } from 'firebase/functions';
import { functions as cloudFunctions } from '@/lib/firebase';
import { normalizeReopenMotivo } from '@/lib/servicios/newSlaDraft';

/** Única puerta del front a `cerrarContratoSla` (escritorio y celular). */
export async function cerrarContratoSla(slaId: string): Promise<void> {
  await httpsCallable(cloudFunctions, 'cerrarContratoSla')({ slaId });
}

/** Única puerta del front a `reabrirContratoSla`: valida el motivo igual que el servidor. */
export async function reabrirContratoSla(slaId: string, motivoRaw: unknown): Promise<string> {
  const motivo = normalizeReopenMotivo(motivoRaw);
  await httpsCallable(cloudFunctions, 'reabrirContratoSla')({ slaId, motivo });
  return motivo;
}
