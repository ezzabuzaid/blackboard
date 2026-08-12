import babel from "@rolldown/plugin-babel"
import tailwindcss from "@tailwindcss/vite"
import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import * as path from "path"
import dts from "vite-plugin-dts"
import { defineConfig } from "vitest/config"

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: "../../node_modules/.vite/packages/genui/input",
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    dts({
      entryRoot: "src",
      tsconfigPath: path.join(__dirname, "tsconfig.lib.json"),
    }),
  ],
  assetsInclude: ["**/*.css"],
  build: {
    outDir: "./dist",
    emptyOutDir: true,
    reportCompressedSize: true,
    sourcemap: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    lib: {
      entry: {
        index: "src/index.ts",
        browser: "src/browser.ts",
      },
      name: "genui-input",
      formats: ["es" as const],
    },
    rollupOptions: {
      external: (id) =>
        id.startsWith("node:") ||
        !(
          id.startsWith(".") ||
          path.isAbsolute(id) ||
          id.startsWith("\0") ||
          id.includes(":")
        ),
      output: {
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  test: {
    name: "genui-input",
    watch: false,
    globals: true,
    environment: "happy-dom",
    pool: "forks",
    execArgv: ["--no-experimental-webstorage"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    setupFiles: ["./src/test-setup.ts"],
    passWithNoTests: true,
    reporters: ["default", "junit"],
    outputFile: { junit: "./test-results.xml" },
  },
}))
