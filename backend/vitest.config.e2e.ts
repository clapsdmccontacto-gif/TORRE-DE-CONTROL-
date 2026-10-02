import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    // Sin llamadas reales a TomTom: el modo demostración queda con rutas estimadas.
    env: { TOMTOM_API_KEY: '' },
  },
});
