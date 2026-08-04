import { DatabaseSync } from "node:sqlite"

import { betterAuth, type BetterAuthOptions } from "better-auth"

import { chatGPTAuthPlugin } from "./auth/chatgpt-plugin.js"

export async function createAuthentication(options: {
  databasePath: string
  baseURL: string
  secret: string
  trustedOrigins: string[]
}) {
  const database = new DatabaseSync(options.databasePath)
  const authOptions = {
    appName: "Baseera",
    database,
    baseURL: options.baseURL,
    secret: options.secret,
    trustedOrigins: options.trustedOrigins,
    account: {
      encryptOAuthTokens: true,
      accountLinking: {
        trustedProviders: ["chatgpt"],
        requireLocalEmailVerified: false,
      },
    },
    plugins: [chatGPTAuthPlugin()],
  } satisfies BetterAuthOptions
  const auth = betterAuth(authOptions)

  await (await auth.$context).runMigrations()

  return {
    auth,
    async [Symbol.asyncDispose]() {
      database.close()
    },
  }
}

export type AppAuth = Awaited<ReturnType<typeof createAuthentication>>["auth"]
