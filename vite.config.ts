import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/xingkong/' : '/',
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
  // 删除 publicDir: 'assets'
  // 因为这会导致本地开发时，Vite 将 assets 目录映射到根目录，导致代码中引用的 assets/xxx.png 变成 404
  build: {
    outDir: 'dist',
  }
});
