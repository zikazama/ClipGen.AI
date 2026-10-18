import path from 'path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  server: {
    port: 3000,
    host: '127.0.0.1', // dev server only listens locally
    proxy: {
      '/api': {
        target: 'https://clipgen-173461988236.us-central1.run.app',
        changeOrigin: true,
      },
    },
  },
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
