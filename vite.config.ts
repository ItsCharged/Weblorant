import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks(id) {
          const norm = id.replace(/\\/g, '/');
          if (norm.includes('/node_modules/three/')) {
            return 'vendor-three';
          }
          if (norm.includes('/node_modules/@dimforge/rapier3d-compat/')) {
            return 'vendor-rapier';
          }
          if (
            norm.includes('/node_modules/firebase/') ||
            norm.includes('/node_modules/@firebase/')
          ) {
            return 'vendor-firebase';
          }
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'node',
  },
});
