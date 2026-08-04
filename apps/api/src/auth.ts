import { DatabaseSync } from "node:sqlite"

import { passkey } from "@better-auth/passkey"
import {
  betterAuth,
  type BetterAuthOptions,
  type BetterAuthPlugin,
} from "better-auth"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"

const passkeyRegistrationSession = {
  id: "passkey-registration-session",
  hooks: {
    after: [
      {
        matcher: ({ path }) => path === "/passkey/verify-registration",
        handler: createAuthMiddleware(async (context) => {
          const passkey = context.context.returned
          const userId =
            typeof passkey === "object" &&
            passkey !== null &&
            "userId" in passkey &&
            typeof passkey.userId === "string"
              ? passkey.userId
              : null
          if (!userId) return

          const user =
            await context.context.internalAdapter.findUserById(userId)
          if (!user) throw new Error("Passkey user was not created")

          const session =
            await context.context.internalAdapter.createSession(userId)
          await setSessionCookie(context, { session, user })
        }),
      },
    ],
  },
} satisfies BetterAuthPlugin

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
    plugins: [
      passkey({
        rpID: new URL(options.baseURL).hostname,
        rpName: "Baseera",
        origin: [
          ...new Set([
            new URL(options.baseURL).origin,
            ...options.trustedOrigins,
          ]),
        ],
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
        registration: {
          requireSession: false,
          resolveUser: ({ context }) => {
            const name = context?.trim()
            if (!name || name.length > 80) {
              throw new APIError("BAD_REQUEST", {
                message: "Enter a name between 1 and 80 characters.",
              })
            }
            return { id: crypto.randomUUID(), name, displayName: name }
          },
          afterVerification: async ({ ctx, user }) => {
            await ctx.context.internalAdapter.createUser({
              id: user.id,
              name: user.name,
              email: `passkey-${user.id}@users.invalid`,
              emailVerified: false,
            })
            return { userId: user.id, name: "Passkey" }
          },
        },
      }),
      passkeyRegistrationSession,
    ],
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
