type PendingCall = { label: string; run: () => Promise<unknown> };

export function createCallableGate(isOnline: () => boolean) {
  const pending: PendingCall[] = [];
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((fn) => fn());

  return {
    pending(): string[] {
      return pending.map((item) => item.label);
    },
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async run<T>(label: string, run: () => Promise<T>): Promise<T> {
      if (!isOnline()) {
        pending.push({ label, run });
        notify();
        throw new Error(`${label} requiere conexión. Quedó para reintentar al volver la señal.`);
      }
      return run();
    },
    async retry(): Promise<number> {
      if (!isOnline() || pending.length === 0) return 0;
      const batch = pending.splice(0, pending.length);
      notify();
      let sent = 0;
      for (const item of batch) {
        try {
          await item.run();
          sent += 1;
        } catch {
          pending.push(item);
        }
      }
      notify();
      return sent;
    },
  };
}

function browserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export const movilCallableGate = createCallableGate(browserOnline);

export function runCallableOnline<T>(label: string, run: () => Promise<T>): Promise<T> {
  return movilCallableGate.run(label, run);
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void movilCallableGate.retry();
  });
}
