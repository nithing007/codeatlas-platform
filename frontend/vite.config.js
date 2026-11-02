import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  oxc: {
    // Vite 8 uses OXC for production builds. Configure JSX automatic runtime here
    // so that production transforms inject react/jsx-runtime automatically.
    transform: {
      jsx: {
        runtime: 'automatic',
        importSource: 'react',
      },
    },
  },
  // Vitest uses esbuild for its own transform pipeline (independent of the OXC
  // production build). This esbuild config makes JSX work in tests without
  // requiring 'import React from "react"' in every file.
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
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
