import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  optimizeDeps: {
    include: ['src'],
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        searchbar: path.resolve(__dirname, 'src/components/searchbar/searchbar.html'),
      },
    },
  },
  plugins: [tsconfigPaths(), react({ include: /\.(js|jsx|ts|tsx)$/ })],
});
