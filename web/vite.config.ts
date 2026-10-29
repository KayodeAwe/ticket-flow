import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development the browser talks to Vite and Vite forwards /api to the Nest API, so the
    // app makes same-origin requests in development exactly as it does behind nginx.
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
  },
});
