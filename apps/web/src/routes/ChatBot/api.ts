import { Client } from "@sdk-it/client"

export const apiUrl = import.meta.env?.VITE_API_URL ?? "http://localhost:3001"

const authenticatedFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, credentials: "include" })

export const api = new Client({
  baseUrl: apiUrl || globalThis.location.origin,
  fetch: authenticatedFetch,
})
