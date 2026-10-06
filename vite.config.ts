import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/web',
  build: { outDir: '../../dist/web', emptyOutDir: true },
});
