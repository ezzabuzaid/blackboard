import { Client } from "@sdk-it/client"

export const apiUrl =
  import.meta.env?.VITE_API_URL ||
  (globalThis.location
    ? `${globalThis.location.origin}/api`
    : "http://localhost:3001/api")

const authenticatedFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, credentials: "include" })

export const api = new Client({
  baseUrl: apiUrl,
  fetch: authenticatedFetch,
})
