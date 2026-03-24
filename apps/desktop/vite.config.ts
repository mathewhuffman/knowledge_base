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
      '@kb-vault/shared-types': resolve(__dirname, '../../packages/shared-types/src'),
      '@kb-vault/diff-engine': resolve(__dirname, '../../packages/diff-engine/src')
    }
  },
  build: {
    outDir: 'dist/renderer'
  }
});
