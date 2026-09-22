import { useEffect, useState } from 'react';

/** Reloj que avanza para que el hero pase de turno actual → próximo al terminar. */
export function useClockNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
