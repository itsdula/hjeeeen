import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served by the HJEN server under /console — assets must resolve from that base.
export default defineConfig({
  base: '/console/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // No manualChunks: hand-splitting react away from react-dependent libs made
    // the vendor chunk evaluate before React existed ("reading 'PureComponent'"
    // → black screen). One bundle = guaranteed init order; size is fine for an
    // internal console.
    chunkSizeWarningLimit: 1500,
  },
});
