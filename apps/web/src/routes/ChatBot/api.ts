export const apiUrl = import.meta.env?.VITE_API_URL ?? "http://localhost:3001"

export function apiFetch(path: string, init?: RequestInit) {
  return fetch(`${apiUrl}${path}`, { ...init, credentials: "include" })
}
