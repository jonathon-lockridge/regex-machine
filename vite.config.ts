/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// `base` defaults to '/' for local dev, build, preview and screenshots.
// The GitHub Pages workflow overrides it with `vite build --base=/<repo>/`
// so the deployed SPA resolves its assets under the project subpath.
export default defineConfig({
  base: '/',
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
