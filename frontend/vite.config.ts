import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { tsconfigPaths: true },
  server: {
    // El backend NestJS corre en :3000; el frontend llama a /api sin CORS.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
