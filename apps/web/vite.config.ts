import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const underPortless = Boolean(process.env.PORTLESS_URL)

export default defineConfig({
  envDir: "../..",
  server: {
    forwardConsole: true,
    port: underPortless ? Number(process.env.PORT) || 5173 : 5173,
    host: underPortless ? "127.0.0.1" : "localhost",
    allowedHosts: [".localhost"],
    hmr: underPortless ? { clientPort: 443, protocol: "wss" } : undefined,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: false,
        ws: true,
      },
    },
  },
  resolve: { tsconfigPaths: true },
  plugins: [react(), tailwindcss()],
})
