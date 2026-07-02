import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// viteSingleFile inlines the entire app (JS+CSS) into dist/index.html so the
// demo can be opened by double-clicking the file, no server required.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: { chunkSizeWarningLimit: 6000 },
  server: { port: 5173 },
});
