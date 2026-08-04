import { randomUUID } from "node:crypto"

import {
  decodeJwt,
  exchangeDeviceAuthorization,
  parseUser,
  pollDeviceCode,
  requestDeviceCode,
  resolveConfig,
  type ChatGPTConfig,
} from "@opencoredev/loginwithchatgpt-core"
import type {
  BetterAuthOptions,
  BetterAuthPlugin,
  GenericEndpointContext,
} from "better-auth"
import { APIError, createAuthEndpoint } from "better-auth/api"
import { expireCookie, setSessionCookie } from "better-auth/cookies"
import { handleOAuthUserInfo } from "better-auth/oauth2"

const ATTEMPT_COOKIE = "chatgpt_device"
const ATTEMPT_PREFIX = "chatgpt-device:"
export const CHATGPT_PROVIDER_ID = "chatgpt"

interface ChatGPTDeviceAttempt {
  deviceAuthId: string
  userCode: string
}

export function chatGPTAuthPlugin(options: ChatGPTConfig = {}) {
  const config = resolveConfig(options)

  const device = createAuthEndpoint(
    "/chatgpt/device",
    { method: "POST" },
    async (context) => {
      await discardAttempt(context)

      const result = await requestDeviceCode(config)
      const attemptId = randomUUID()
      await context.context.internalAdapter.createVerificationValue({
        identifier: identifier(attemptId),
        value: JSON.stringify({
          deviceAuthId: result.deviceAuthId,
          userCode: result.userCode,
        } satisfies ChatGPTDeviceAttempt),
        expiresAt: new Date(result.expiresAt),
      })

      const cookie = attemptCookie(context, result.expiresAt)
      await context.setSignedCookie(
        cookie.name,
        attemptId,
        context.context.secret,
        cookie.attributes
      )

      return context.json({
        verificationUrl: result.verificationUrl,
        userCode: result.userCode,
        interval: result.interval,
        expiresAt: result.expiresAt,
      })
    }
  )

  const poll = createAuthEndpoint(
    "/chatgpt/device/poll",
    { method: "POST" },
    async (context) => {
      const attemptId = await readAttemptId(context)
      if (!attemptId) return context.json({ status: "expired" as const })

      const verification =
        await context.context.internalAdapter.findVerificationValue(
          identifier(attemptId)
        )
      const attempt = verification && parseDeviceAttempt(verification.value)
      if (!attempt || verification.expiresAt <= new Date()) {
        await discardAttempt(context)
        return context.json({ status: "expired" as const })
      }

      const result = await pollDeviceCode(config, attempt)
      if (result.status === "pending") {
        return context.json({ status: "pending" as const })
      }

      const consumed =
        await context.context.internalAdapter.consumeVerificationValue(
          identifier(attemptId)
        )
      if (!consumed) return context.json({ status: "expired" as const })

      const tokens = await exchangeDeviceAuthorization(config, result)
      const profile = openAIProfile(tokens.idToken)
      if (!profile) {
        throw new APIError("UNAUTHORIZED", {
          message: "OpenAI did not return a usable ChatGPT profile.",
        })
      }

      const authResult = await handleOAuthUserInfo(context, {
        userInfo: profile,
        account: {
          providerId: CHATGPT_PROVIDER_ID,
          accountId: profile.id,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          idToken: tokens.idToken,
          accessTokenExpiresAt: tokens.expiresAt
            ? new Date(tokens.expiresAt)
            : undefined,
          scope: config.scope,
        },
        isTrustedProvider: true,
      })
      if (authResult.error || !authResult.data) {
        throw new APIError("UNAUTHORIZED", { message: authResult.error })
      }

      await setSessionCookie(context, authResult.data)
      expireCookie(context, attemptCookie(context))
      return context.json({
        status: "complete" as const,
        user: authResult.data.user,
      })
    }
  )

  const cancel = createAuthEndpoint(
    "/chatgpt/device/cancel",
    { method: "POST" },
    async (context) => {
      await discardAttempt(context)
      return context.json({ cancelled: true })
    }
  )

  return {
    id: "chatgpt-auth",
    endpoints: { device, poll, cancel },
    rateLimit: [
      {
        window: 60,
        max: 5,
        pathMatcher: (path) => path === "/chatgpt/device",
      },
      {
        window: 60,
        max: 30,
        pathMatcher: (path) => path === "/chatgpt/device/poll",
      },
    ],
  } satisfies BetterAuthPlugin
}

export function parseDeviceAttempt(value: string): ChatGPTDeviceAttempt | null {
  try {
    const attempt: unknown = JSON.parse(value)
    return attempt &&
      typeof attempt === "object" &&
      "deviceAuthId" in attempt &&
      typeof attempt.deviceAuthId === "string" &&
      attempt.deviceAuthId.length > 0 &&
      "userCode" in attempt &&
      typeof attempt.userCode === "string" &&
      attempt.userCode.length > 0
      ? { deviceAuthId: attempt.deviceAuthId, userCode: attempt.userCode }
      : null
  } catch {
    return null
  }
}

function openAIProfile(idToken: string | undefined) {
  const user = parseUser(idToken)
  const claims = decodeJwt(idToken)
  if (!user?.email || !claims) return null

  const subject = claims.sub
  return {
    id: typeof subject === "string" && subject ? subject : user.accountId,
    email: user.email,
    emailVerified: claims.email_verified === true,
    name: user.name ?? user.email,
    image: typeof claims.picture === "string" ? claims.picture : null,
  }
}

function identifier(attemptId: string) {
  return `${ATTEMPT_PREFIX}${attemptId}`
}

function attemptCookie(
  context: GenericEndpointContext<BetterAuthOptions>,
  expiresAt?: number
) {
  return context.context.createAuthCookie(ATTEMPT_COOKIE, {
    maxAge: expiresAt
      ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 1_000))
      : 0,
  })
}

async function readAttemptId(
  context: GenericEndpointContext<BetterAuthOptions>
) {
  const cookie = attemptCookie(context)
  return context.getSignedCookie(
    cookie.name,
    context.context.secret
  ) as Promise<string | null>
}

async function discardAttempt(
  context: GenericEndpointContext<BetterAuthOptions>
) {
  const attemptId = await readAttemptId(context)
  if (attemptId) {
    await context.context.internalAdapter.deleteVerificationByIdentifier(
      identifier(attemptId)
    )
    expireCookie(context, attemptCookie(context))
  }
}
