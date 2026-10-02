import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    // Datos en memoria (nunca la base de quien corre los tests); la clave de acceso se
    // prueba aparte en cloud.e2e-spec.ts.
    env: { DATABASE_URL: '', ACCESS_CONTROL: 'off' },
  },
});
