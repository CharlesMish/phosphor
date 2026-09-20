/** Node test support for Vite's extensionless imports, aliases and React components. */
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

export async function resolve(specifier, context, nextResolve) {
  const path = specifier.startsWith('@/')
    ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier;
  try {
    return await nextResolve(path, context);
  } catch (error) {
    const relative = path.startsWith('./') || path.startsWith('../') || path.startsWith('file:');
    if (!relative || /\.[a-z0-9]+$/i.test(path)) throw error;
    for (const extension of ['.ts', '.tsx']) {
      try { return await nextResolve(`${path}${extension}`, context); } catch { /* next */ }
    }
    throw error;
  }
}
export async function load(url, context, nextLoad) {
  if (!url.endsWith('.tsx')) return nextLoad(url, context);
  const source = (await readFile(new URL(url), 'utf8')).replaceAll('import.meta.env.DEV', 'false');
  return { format: 'module', shortCircuit: true, source: ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText };
}
