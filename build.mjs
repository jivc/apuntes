import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const test = process.argv.includes('--test'); // expone window.__apuntes para las pruebas automáticas
const builds = [
  { entryPoints: ['src/app.js'], bundle: true, outfile: 'dist/app.js', format: 'iife', target: 'chrome120', define: { __APUNTES_TEST__: String(test) } },
  { entryPoints: ['src/styles.css'], bundle: true, outfile: 'dist/styles.css', loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' } },
  { entryPoints: ['src/katex.css'], bundle: true, outfile: 'dist/katex.css', loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' } },
].map((o) => ({ ...o, minify: !watch, sourcemap: watch, logLevel: 'info' }));

if (watch) {
  for (const o of builds) await (await esbuild.context(o)).watch();
} else {
  await Promise.all(builds.map((o) => esbuild.build(o)));
}
