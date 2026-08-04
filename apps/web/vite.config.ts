import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  envDir: "../..",
  server: {
    forwardConsole: true,
    proxy: { "/api": "http://localhost:3001" },
  },
  resolve: { tsconfigPaths: true },
  plugins: [react(), tailwindcss()],
})
