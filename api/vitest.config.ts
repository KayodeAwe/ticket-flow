import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vitest's default transform (esbuild/oxc) does not emit decorator metadata, and Nest's
  // dependency injection reads constructor parameter types from it. SWC does; it reads
  // `experimentalDecorators` and `emitDecoratorMetadata` from tsconfig.json.
  plugins: [swc.vite()],
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    globalSetup: ['test/support/global-setup.ts'],
    setupFiles: ['test/support/quiet-logs.ts'],
    // The first run downloads a MongoDB binary for the in-memory replica set.
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});
