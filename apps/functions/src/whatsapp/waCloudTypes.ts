/**
 * Mensaje normalizado: misma forma que el WA Bridge (Baileys) para Modo Rápido.
 */
export type WaCloudNormalizedMessage = {
  id: string;
  ts: number;
  time: string;
  phone: string;
  name: string;
  text: string;
  type: 'location' | 'image' | 'text' | 'protocol' | string;
  hasPhoto: boolean;
  hasLocation: boolean;
  photo: string | null;
  location: { lat: number; lng: number; accuracy?: number } | null;
  groupId: string | null;
  group: string | null;
  source: 'cloud' | 'simulate';
  phoneNumberId?: string;
  empresaId: string;
};

export function horaArFromMs(ms: number): string {
  return new Date(ms).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

export function normPhoneWa(value: unknown): string {
  return String(value || '')
    .replace(/\D/g, '')
    .replace(/^549/, '');
}
