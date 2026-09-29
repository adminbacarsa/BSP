import { appAlert } from './appAlert';
import { raceWithTimeout } from './raceWithTimeout';

export type OriginCoords = { lat: number; lng: number; accuracy?: number };

export const ORIGIN_COORDS_TIMEOUT_MS = 8000;

const EXPLAIN =
  'Para estimar tu llegada usamos el GPS al aceptar. Si lo negás o no responde, seguimos igual y el sistema usa tu domicilio.';

function explainPermission(): Promise<boolean> {
  return new Promise((resolve) => {
    appAlert('Ubicación al aceptar', EXPLAIN, [
      { text: 'Seguir sin GPS', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Permitir ubicación', onPress: () => resolve(true) },
    ]);
  });
}

/**
 * Pide permiso con explicación y lee el GPS. Niega o timeout de 8 s → null
 * (el servidor usa el domicilio).
 */
export async function captureAcceptOriginCoords(
  timeoutMs = ORIGIN_COORDS_TIMEOUT_MS,
): Promise<OriginCoords | null> {
  return raceWithTimeout(readOriginCoords(), timeoutMs);
}

async function readOriginCoords(): Promise<OriginCoords> {
  const Location = await import('expo-location');
  const current = await Location.getForegroundPermissionsAsync();
  if (current.status !== 'granted') {
    const allow = await explainPermission();
    if (!allow) throw new Error('denied');
    const asked = await Location.requestForegroundPermissionsAsync();
    if (asked.status !== 'granted') throw new Error('denied');
  }
  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  const accuracy = pos.coords.accuracy;
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    ...(typeof accuracy === 'number' && Number.isFinite(accuracy) ? { accuracy } : {}),
  };
}
