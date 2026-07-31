import { randomUUID } from "node:crypto"
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import { createOpenAI } from "@ai-sdk/openai"
import {
  type ChatGPTTokens,
  type CodexAuth,
  createCodexFetch,
  ensureFreshTokens,
  listCodexModels,
  requestDeviceCode,
  resolveConfig,
  waitForDeviceTokens,
} from "@opencoredev/loginwithchatgpt-core"

export async function createChatGPTSubscription(dataDirectory: string) {
  const tokenPath = resolve(dataDirectory, "chatgpt.json")
  const config = resolveConfig()
  let tokens = await readTokens(tokenPath)

  if (!tokens) {
    const device = await requestDeviceCode(config)
    console.log(
      `ChatGPT sign-in required.\nOpen ${device.verificationUrl}\nEnter code: ${device.userCode}`
    )
    tokens = await waitForDeviceTokens(config, device)
    await writeTokens(tokenPath, tokens)
  }

  // Refresh tokens rotate on use, so serialize refreshes within this process.
  let refreshQueue = Promise.resolve()
  const getAuth = (): Promise<CodexAuth> => {
    const result = refreshQueue.then(async () => {
      tokens = await ensureFreshTokens(config, tokens, {
        onRefresh: (fresh) => writeTokens(tokenPath, fresh),
      })
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
  const modelId = process.env.CHATGPT_MODEL!
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

export function parseChatGPTTokens(value: string): ChatGPTTokens {
  const tokens: unknown = JSON.parse(value)
  if (!tokens || typeof tokens !== "object") {
    throw new Error("Invalid saved ChatGPT credentials")
  }
  const record = tokens as Record<string, unknown>
  if (typeof record.accessToken !== "string" || !record.accessToken) {
    throw new Error("Invalid saved ChatGPT credentials")
  }

  for (const field of ["refreshToken", "idToken", "accountId"] as const) {
    if (field in record && typeof record[field] !== "string") {
      throw new Error("Invalid saved ChatGPT credentials")
    }
  }
  if (
    "expiresAt" in record &&
    (typeof record.expiresAt !== "number" || !Number.isFinite(record.expiresAt))
  ) {
    throw new Error("Invalid saved ChatGPT credentials")
  }

  return record as unknown as ChatGPTTokens
}

async function readTokens(path: string) {
  try {
    return parseChatGPTTokens(await readFile(path, "utf8"))
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined
    }
    throw error
  }
}

async function writeTokens(path: string, tokens: ChatGPTTokens) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, JSON.stringify(tokens), { mode: 0o600 })
    await rename(temporaryPath, path)
    await chmod(path, 0o600)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}
