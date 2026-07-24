import { DefaultChatTransport } from "ai"

export const apiUrl =
  import.meta.env?.VITE_API_URL ?? "http://localhost:3001"

export const chatTransport = new DefaultChatTransport({
  api: `${apiUrl}/api/chat`,
})
