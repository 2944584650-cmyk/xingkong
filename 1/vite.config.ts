import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: '/xingkong/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    strictPort: true, // 强制使用固定端口，如果被占用则报错而不是静默递增端口
    open: true,
  },
  publicDir: 'assets', // If the original app uses ./assets, we might want to map it, or just leave it.
  build: {
    outDir: 'dist',
  }
});
