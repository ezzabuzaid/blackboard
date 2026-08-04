import { createBrowserRouter } from "react-router"

import { ErrorBoundary, Root } from "./root"

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    ErrorBoundary,
    HydrateFallback: BootFallback,
    children: [
      {
        index: true,
        lazy: async () => {
          const route = await import("./routes/ChatBot")
          return { Component: route.default, loader: route.loader }
        },
      },
      {
        path: "login",
        lazy: async () => {
          const route = await import("./routes/Login")
          return { Component: route.default, loader: route.loader }
        },
      },
      {
        path: "groups/new",
        lazy: async () => {
          const route = await import("./routes/GroupTemplates")
          return { Component: route.default, loader: route.loader }
        },
      },
      {
        path: "*",
        loader: () => {
          throw new Response("Not Found", { status: 404 })
        },
      },
    ],
  },
])

function BootFallback() {
  return (
    <main className="grid min-h-svh place-items-center bg-background text-sm text-muted-foreground">
      Loading group…
    </main>
  )
}
