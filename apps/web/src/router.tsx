import { createBrowserRouter } from "react-router"

import { ErrorBoundary, Root } from "./root"

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    ErrorBoundary,
    children: [
      {
        index: true,
        lazy: async () => {
          const route = await import("./routes/ChatBot")
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
