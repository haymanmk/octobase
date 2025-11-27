import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        searchbar: path.resolve(__dirname, 'src/components/searchbar/searchbar.html'),
        // Add injectable widget entry
        highlighter: path.resolve(__dirname, 'src/components/highlighter/highlighter.tsx'),
      },
      output: {
        // Generate separate bundles for injection
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'highlighter') {
            return 'inject/[name].js';
          }
          return 'assets/[name]-[hash].js';
        },
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.includes('highlighter')) {
            return 'inject/[name][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
        // IMPORTANT: Inline all dependencies for inject bundle
        manualChunks: (id) => {
          if (id.includes('highlighter')) {
            return 'inject';
          }
        },
        inlineDynamicImports: true,
      },
    },
    // Increase chunk size limit for the bundled file
    chunkSizeWarningLimit: 2000,
  },
  plugins: [tsconfigPaths(), react({ include: /\.(js|jsx|ts|tsx)$/ })],
});
