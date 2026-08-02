import { createOpenAI } from "@ai-sdk/openai"
import {
  type ChatGPTTokens,
  type CodexAuth,
  createCodexFetch,
  ensureFreshTokens,
  listCodexModels,
  resolveConfig,
} from "@opencoredev/loginwithchatgpt-core"
import { decryptOAuthToken, setTokenUtil } from "better-auth/oauth2"

import type { AppAuth } from "./auth.js"
import { CHATGPT_PROVIDER_ID } from "./auth/chatgpt-plugin.js"

export async function createChatGPTSubscription(auth: AppAuth, userId: string) {
  const context = await auth.$context
  const account = (
    await context.internalAdapter.findAccountByUserId(userId)
  ).find(({ providerId }) => providerId === CHATGPT_PROVIDER_ID)
  if (!account?.accessToken) {
    throw new Error("The user has not connected a ChatGPT account")
  }

  const config = resolveConfig()
  let tokens: ChatGPTTokens = {
    accessToken: await decryptOAuthToken(account.accessToken, context),
    refreshToken: account.refreshToken
      ? await decryptOAuthToken(account.refreshToken, context)
      : undefined,
    idToken: account.idToken ?? undefined,
    expiresAt: account.accessTokenExpiresAt?.getTime(),
  }

  // Refresh tokens rotate on use, so serialize refreshes for this user.
  let refreshQueue = Promise.resolve()
  const getAuth = (): Promise<CodexAuth> => {
    const result = refreshQueue.then(async () => {
      const previous = tokens
      const fresh = await ensureFreshTokens(config, tokens, {
        onRefresh: async (refreshed) => {
          const complete = {
            ...refreshed,
            idToken: refreshed.idToken ?? previous.idToken,
          }
          await context.internalAdapter.updateAccount(account.id, {
            accessToken: await setTokenUtil(complete.accessToken, context),
            refreshToken: await setTokenUtil(complete.refreshToken, context),
            idToken: complete.idToken,
            accessTokenExpiresAt: complete.expiresAt
              ? new Date(complete.expiresAt)
              : undefined,
          })
        },
      })
      tokens = { ...fresh, idToken: fresh.idToken ?? previous.idToken }
      if (!tokens.accountId) {
        throw new Error("The connected ChatGPT account has no account id")
      }
      return {
        accessToken: tokens.accessToken,
        accountId: tokens.accountId,
      }
    })
    refreshQueue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  const models = await listCodexModels({ config, getAuth })
  const modelId = selectChatGPTModel(
    models,
    process.env.CHATGPT_MODEL || undefined
  )
  const chatgpt = createOpenAI({
    name: "chatgpt",
    baseURL: config.codexBaseUrl,
    apiKey: "injected-by-chatgpt-transport",
    fetch: createCodexFetch({ config, getAuth }),
  })

  console.log(`Using ChatGPT subscription model ${modelId}`)
  return {
    model: chatgpt.responses(modelId),
    webSearch: chatgpt.tools.webSearch(),
  }
}

export function selectChatGPTModel(
  models: readonly string[],
  requested?: string
) {
  if (requested) {
    console.log(`Requested ChatGPT model: ${requested}`)
    if (models.includes(requested)) return requested
    throw new Error(
      `CHATGPT_MODEL=${requested} is unavailable; choose one of: ${models.join(", ")}`
    )
  }
  if (models[0]) return models[0]
  throw new Error("The connected ChatGPT account has no available Codex models")
}
