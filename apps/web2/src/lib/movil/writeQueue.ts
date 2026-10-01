export type WriteQueueResult = 'sent' | 'queued';

type Job = { id: string; label: string; run: () => Promise<void> };

export function createWriteQueue(isOnline: () => boolean) {
  const jobs: Job[] = [];
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((fn) => fn());

  return {
    pending(): string[] {
      return jobs.map((job) => job.label);
    },
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async enqueue(label: string, run: () => Promise<void>): Promise<WriteQueueResult> {
      if (!isOnline()) {
        jobs.push({ id: `${Date.now()}-${jobs.length}`, label, run });
        notify();
        return 'queued';
      }
      await run();
      return 'sent';
    },
    async flush(): Promise<number> {
      if (!isOnline() || jobs.length === 0) return 0;
      const batch = jobs.splice(0, jobs.length);
      notify();
      let sent = 0;
      for (const job of batch) {
        try {
          await job.run();
          sent += 1;
        } catch {
          jobs.push(job);
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

export const movilWriteQueue = createWriteQueue(browserOnline);

export function enqueueFirestoreWrite(label: string, run: () => Promise<void>): Promise<WriteQueueResult> {
  return movilWriteQueue.enqueue(label, run);
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void movilWriteQueue.flush();
  });
}
