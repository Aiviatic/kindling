import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The browser UI lives in ui/ and builds to dist/ui. The Local Server (Epic 3) serves the
// built assets; the Welcome screen is later emitted as a self-contained page (FR-12).
export default defineConfig({
  root: 'ui',
  plugins: [react()],
  build: {
    outDir: '../dist/ui',
    emptyOutDir: true,
  },
});
