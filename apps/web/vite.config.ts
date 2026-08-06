import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Point at the shared package's *source*, not its CommonJS build. Vite
      // then tree-shakes it properly and picks up edits without a rebuild step.
      '@nbr/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      // Same-origin in dev, which keeps the SameSite=strict auth cookies
      // working exactly as they do in production behind Cloudflare.
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:4100',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Split the heavy, rarely-changing dependencies so an app-code deploy
        // doesn't invalidate the whole vendor bundle in users' caches.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query', '@tanstack/react-table'],
          charts: ['recharts'],
        },
      },
    },
  },
});
