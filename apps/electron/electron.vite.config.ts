import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    // @cue/core is workspace TS source — bundle it instead of externalizing.
    plugins: [externalizeDepsPlugin({ exclude: ['@cue/core'] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
  },
});
