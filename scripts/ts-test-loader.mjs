/** Resolve the extensionless relative imports used by the Vite application for Node tests. */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const relative = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExtension = /\.[a-z0-9]+$/i.test(specifier);
    if (!relative || hasExtension) throw error;
    return nextResolve(`${specifier}.ts`, context);
  }
}
