import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { viteStaticCopy } from "vite-plugin-static-copy";

// https://vitejs.dev/config/
export default defineConfig(({}) => ({
  server: {
    host: "::",
    port: 8080,
    watch: {
      usePolling: true,
    },
  },
  plugins: [
    react(),
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
    // Correctly configured static copy plugin
    viteStaticCopy({
      targets: [
        {
          // This is the updated, correct path you found
          src: "node_modules/@aztec/bb.js/dest/browser/barretenberg_wasm/barretenberg_wasm_main/factory/browser/main.worker.js",
          dest: ".",
        },
      ],
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    // These settings are still correct and necessary
    exclude: [
      "@noir-lang/noirc_abi",
      "@noir-lang/acvm_js",
      "@noir-lang/backend_barretenberg",
      "@noir-lang/noir_js",
      "@aztec/bb.js",
    ],
    include: ["@aztec/bb.js > pino"],
  },
  worker: {
    format: "es",
    plugins: () => [
      nodePolyfills({
        globals: { Buffer: true, global: true, process: true },
      }),
    ],
  },
  assetsInclude: ["**/*.wasm"],
}));