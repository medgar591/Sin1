/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';

/** Writes the built (content-hashed) asset list and a build id into dist/sw.js, so the worker can precache them. */
function swPrecache(): Plugin {
  return {
    name: 'sin1-sw-precache',
    apply: 'build',
    writeBundle(options, bundle) {
      const file = resolve(options.dir ?? 'dist', 'sw.js');
      if (!existsSync(file)) return;
      const assets = Object.keys(bundle).filter((f) => f.startsWith('assets/')).sort();
      const build = createHash('sha1').update(assets.join('\n')).digest('hex').slice(0, 8);
      const src = readFileSync(file, 'utf8')
        .replace("/*__BUILD__*/ 'dev'", JSON.stringify(build))
        .replace('/*__PRECACHE_ASSETS__*/ []', JSON.stringify(assets.map((f) => `./${f}`)));
      writeFileSync(file, src);
    },
  };
}

// Relative base so the build works from any GitHub Pages sub-path.
export default defineConfig({
  base: './',
  plugins: [preact(), swPrecache()],
  test: {
    include: ['src/**/*.test.ts'],
    // Generating a company runs five years of it; suites that make several need more than the 5 s default on a slow box.
    testTimeout: 20_000,
  },
});
