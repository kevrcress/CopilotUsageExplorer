export default {
  plugins: {
    tailwindcss: { config: new URL("./tailwind.config.mjs", import.meta.url).pathname },
    autoprefixer: {},
  },
};
