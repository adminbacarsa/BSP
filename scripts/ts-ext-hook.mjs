/** Permite importar .ts de ops-core/functions que usan imports relativos sin extensión. */
export async function resolve(specifier, context, nextResolve) {
  if (
    (specifier.startsWith('./') || specifier.startsWith('../'))
    && !/\.[a-z]+$/i.test(specifier)
  ) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      /* sigue al resolve normal */
    }
  }
  return nextResolve(specifier, context);
}
