import { replace, type LoaderFunctionArgs } from "react-router"

import { api } from "./routes/ChatBot/api"

export async function requireIdentity({ request }: LoaderFunctionArgs) {
  const session: unknown = await api.request(
    "GET /auth/get-session",
    {},
    { signal: request.signal }
  )
  if (!hasIdentity(session)) {
    const url = new URL(request.url)
    const redirect = `${url.pathname}${url.search}`
    throw replace(`/login?${new URLSearchParams({ redirect })}`)
  }

  return session
}

export function hasIdentity(value: unknown) {
  return (
    typeof value === "object" &&
    value !== null &&
    "user" in value &&
    typeof value.user === "object" &&
    value.user !== null &&
    "id" in value.user &&
    typeof value.user.id === "string"
  )
}

export function redirectDestination(value: string) {
  const url = new URL(value, "http://baseera.local")
  const target = url.searchParams.get("redirect")
  return target?.startsWith("/") && !target.startsWith("//") ? target : "/"
}
