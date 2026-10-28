import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  oxc: {
    // Ensure JSX automatic runtime is used so 'React' does not need to be
    // imported explicitly in source files.
    transform: {
      jsx: {
        runtime: 'automatic',
        importSource: 'react',
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'src/test/', 'src/main.jsx'],
    },
  },
});
