import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  root: '.',
  base: './',
  resolve: {
    alias: {
      '@': resolve(__dirname, './src/renderer/src'),
      '@kb-vault/shared-types': resolve(__dirname, '../../packages/shared-types/src')
    }
  },
  build: {
    outDir: 'dist/renderer'
  }
});
