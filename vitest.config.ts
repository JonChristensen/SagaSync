import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/lib'),
      '@functions': resolve(__dirname, 'functions')
    }
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts'],
    reporters: 'default'
  }
});
