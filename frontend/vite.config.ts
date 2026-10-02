import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Rutas relativas: el build funciona en cualquier subcarpeta (GitHub Pages) o como archivo.
  base: './',
  resolve: { tsconfigPaths: true },
  server: {
    // Las reglas de dominio se importan desde ../backend/src (alias @core).
    fs: { allow: ['..'] },
    // En modo API (`npm run dev:api`) el backend NestJS corre en :3000.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
