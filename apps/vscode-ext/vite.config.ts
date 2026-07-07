import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/** Webview bundle build. base './' + fixed output names (webview.js /
 *  webview.css) so extension.ts can reference assets via asWebviewUri without
 *  parsing Vite's manifest (details doc §5). */
export default defineConfig({
  root: path.resolve(__dirname, 'webview'),
  base: './',
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, 'dist/webview'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'webview.js',
        chunkFileNames: 'chunk-[name].js',
        assetFileNames: 'webview.[ext]',
      },
    },
  },
});
