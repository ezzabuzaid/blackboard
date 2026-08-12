import { Buffer } from "node:buffer"

export type TranscriptionAudio = {
  bytes: Uint8Array
  format: "aac" | "flac" | "m4a" | "mp3" | "ogg" | "wav" | "webm"
}

export function createOpenRouterTranscriber({
  apiKey,
  model,
  appUrl,
  fetch: request = globalThis.fetch,
}: {
  apiKey: string
  model: string
  appUrl?: string
  fetch?: typeof fetch
}) {
  return async ({ bytes, format }: TranscriptionAudio): Promise<string> => {
    const response = await request(
      "https://openrouter.ai/api/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(appUrl ? { "HTTP-Referer": appUrl } : {}),
          "X-OpenRouter-Title": "Baseera",
        },
        body: JSON.stringify({
          model,
          input_audio: {
            data: Buffer.from(bytes).toString("base64"),
            format,
          },
        }),
      }
    )

    const body: unknown = await response.json().catch(() => null)
    if (
      !response.ok ||
      typeof body !== "object" ||
      body === null ||
      !("text" in body) ||
      typeof body.text !== "string"
    ) {
      throw new Error(`OpenRouter transcription failed (${response.status})`)
    }

    return body.text
  }
}
