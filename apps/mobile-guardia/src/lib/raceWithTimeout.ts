/** Resuelve null si `work` no termina en `ms` (la aceptación sigue sin GPS). */
export function raceWithTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: T | null) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        finish(value);
      },
      () => {
        clearTimeout(timer);
        finish(null);
      },
    );
  });
}
