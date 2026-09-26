import { readFile } from 'node:fs/promises';
import ts from 'typescript';
export async function resolve(specifier, context, next) {
  if (specifier === 'next/link') return next(new URL('./next-link.mjs', import.meta.url).href, context);
  if (specifier.startsWith('@/')) specifier = new URL('../src/' + specifier.slice(2), import.meta.url).href;
  try { return await next(specifier, context); }
  catch (error) {
    if (specifier.startsWith('.') || specifier.startsWith('file:')) {
      for (const suffix of ['.ts', '.tsx', '/index.ts']) {
        try { return await next(specifier + suffix, context); } catch {}
      }
    }
    throw error;
  }
}
export async function load(url, context, next) {
  if (/\.tsx?$/.test(url)) {
    const text = await readFile(new URL(url), 'utf8');
    return { format: 'module', shortCircuit: true, source: ts.transpileModule(text, { compilerOptions: {
      module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    }}).outputText };
  }
  return next(url, context);
}
