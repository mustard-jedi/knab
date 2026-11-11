import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: { '/api': `http://127.0.0.1:${process.env.PORT || 3000}` },
  },
});
