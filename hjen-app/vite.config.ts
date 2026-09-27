import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  base: './',
  build: {
    rollupOptions: {
      output: {
        // Split the stable framework deps into their own long-cached chunk so an
        // app-code change doesn't invalidate them. The lazy() workspaces in
        // App.tsx are already emitted as separate per-tool chunks by Rollup's
        // dynamic-import splitting — this just isolates the vendor core.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler|zustand)[\\/]/.test(id)) return 'vendor-react';
          }
        },
      },
    },
  },
});
