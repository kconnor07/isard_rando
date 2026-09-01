import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// IMPORTANT : aucun `define` de clé API ici — tous les secrets restent côté serveur.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3080',
      '/public-assets': 'http://localhost:3080',
      '/a': 'http://localhost:3080',
      '/r': 'http://localhost:3080',
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
