import { fileURLToPath } from "node:url";

export default {
  plugins: {
    tailwindcss: { config: fileURLToPath(new URL("./tailwind.config.mjs", import.meta.url)) },
    autoprefixer: {},
  },
};
