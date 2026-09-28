import { useEffect, useState } from 'react';
import { isStaleBuild, subscribeStaleBuild } from '@/lib/appVersion';

/**
 * `true` cuando ya se publicó una versión nueva del panel y esta pestaña quedó vieja.
 * Los monitores la usan para frenar sus escrituras automáticas hasta la recarga.
 */
export function useStaleBuild(): boolean {
  const [stale, setStale] = useState(isStaleBuild());
  useEffect(() => subscribeStaleBuild(() => setStale(true)), []);
  return stale;
}
