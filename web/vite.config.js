import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En desarrollo (npm run dev), Vite reenvía /api al backend.
// Por defecto apunta al stack de Docker local (http://localhost:8080). Cámbialo con VITE_API_URL.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': process.env.VITE_API_URL || 'http://localhost:8080',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
