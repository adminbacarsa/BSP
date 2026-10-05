export async function resolve(specifier, context, nextResolve) {
  if (
    specifier.startsWith('.')
    && !/\.(ts|js|mjs|cjs|json|node)$/.test(specifier)
  ) {
    return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
}