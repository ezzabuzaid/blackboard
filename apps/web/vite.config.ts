import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  envDir: "../..",
  server: { forwardConsole: true },
  resolve: { tsconfigPaths: true },
  plugins: [react(), tailwindcss()],
})
