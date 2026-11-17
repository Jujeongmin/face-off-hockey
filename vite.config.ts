import { defineConfig } from 'vite';

// base './' so the build works under the Verse8 sub-path / iframe
export default defineConfig({
  base: './',
  server: { port: 5320, strictPort: true },
  preview: { port: 5321, strictPort: true },
  build: { outDir: 'dist', target: 'es2022', reportCompressedSize: false, chunkSizeWarningLimit: 5000 },
});
