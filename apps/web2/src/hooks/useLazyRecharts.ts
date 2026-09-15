import { useEffect, useState } from 'react';

type RechartsModule = typeof import('recharts');

export function useLazyRecharts(): RechartsModule | null {
  const [mod, setMod] = useState<RechartsModule | null>(null);
  useEffect(() => {
    let cancelled = false;
    import('recharts').then((m) => {
      if (!cancelled) setMod(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return mod;
}
