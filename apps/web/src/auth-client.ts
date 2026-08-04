import { passkeyClient } from "@better-auth/passkey/client"
import { createAuthClient } from "better-auth/react"

import { apiUrl } from "./routes/ChatBot/api"

export const authClient = createAuthClient({
  baseURL: `${apiUrl}/auth`,
  plugins: [passkeyClient()],
})
