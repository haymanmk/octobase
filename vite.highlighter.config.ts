import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * NOTE: This configuration is specifically for building the highlighter widget
 * as a standalone bundle that can be injected into the Electron webview.
 * The node.js environment variables are defined as global constant replacements
 * to avoid bundling the entire 'process' polyfill, which is unnecessary and
 * increases bundle size.
 */
export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': JSON.stringify({})
  },
  build: {
    outDir: 'dist/highlighter',
    lib: {
      entry: path.resolve(__dirname, 'src/components/highlighter/highlighter.tsx'),
      name: 'Highlighter',
      formats: ['iife'], // Immediately Invoked Function Expression
      fileName: 'highlighter',
    },
    rollupOptions: {
      // Don't externalize anything - bundle everything
      external: [],
      output: {
        // Single file output
        inlineDynamicImports: true,
        format: 'iife',
        name: 'Highlighter',
      },
    },
    minify: true, // Optional: minify the output
  },
});