import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
// import { reactRouter } from '@react-router/dev/vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
  },
  plugins: [tsconfigPaths(), react({ include: /\.(js|jsx|ts|tsx)$/ })],
});
