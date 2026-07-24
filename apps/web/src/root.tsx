import {
  Outlet,
  ScrollRestoration,
  isRouteErrorResponse,
  useNavigation,
  useRouteError,
} from "react-router"

import { TooltipProvider } from "@stdlib/shadcn"

export function Root() {
  const navigation = useNavigation()

  return (
    <TooltipProvider>
      <div aria-busy={navigation.state !== "idle"}>
        <Outlet />
      </div>
      <ScrollRestoration />
    </TooltipProvider>
  )
}

export function ErrorBoundary() {
  const error = useRouteError()
  let message = "Oops!"
  let details = "An unexpected error occurred."
  let stack: string | undefined

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error"
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message
    stack = error.stack
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center px-6">
      <p className="text-sm text-muted-foreground">{message}</p>
      <h1 className="mt-2 text-2xl font-medium">{details}</h1>
      {stack && (
        <pre className="mt-6 w-full overflow-x-auto rounded-lg bg-muted p-4 text-xs">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  )
}
