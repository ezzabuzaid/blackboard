import { Button } from "@stdlib/shadcn"
import {
  Check,
  Copy,
  ExternalLink,
  LoaderCircle,
  MessageCircle,
} from "lucide-react"
import { useEffect, useState } from "react"
import {
  replace,
  type LoaderFunctionArgs,
  useLocation,
  useNavigate,
} from "react-router"

import { hasIdentity, redirectDestination } from "../../auth"
import { apiFetch } from "../ChatBot/api"

interface DeviceLogin {
  verificationUrl: string
  userCode: string
  interval: number
  expiresAt: number
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const response = await apiFetch("/api/auth/get-session", {
      signal: request.signal,
    })
    const session: unknown = response.ok ? await response.json() : null
    if (hasIdentity(session)) throw replace(redirectDestination(request.url))
  } catch (error) {
    if (error instanceof Response || request.signal.aborted) throw error
  }
  return null
}

export default function Login() {
  const location = useLocation()
  const navigate = useNavigate()
  const [device, setDevice] = useState<DeviceLogin | null>(null)
  const [starting, setStarting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!device) return

    const controller = new AbortController()
    let timer: number | undefined
    const schedule = () => {
      timer = window.setTimeout(poll, device.interval * 1_000)
    }
    const poll = async () => {
      if (Date.now() >= device.expiresAt) {
        setDevice(null)
        setError("That code expired. Start again to get a new one.")
        return
      }

      try {
        const response = await authPost(
          "/api/auth/chatgpt/device/poll",
          controller.signal
        )
        const result: unknown = await response.json()
        if (!response.ok || !isPollResult(result)) {
          throw new Error("ChatGPT approval could not be checked.")
        }
        if (result.status === "complete") {
          await navigate(redirectDestination(location.search), { replace: true })
          return
        }
        if (result.status === "expired") {
          setDevice(null)
          setError("That code expired. Start again to get a new one.")
          return
        }
        setError(null)
        schedule()
      } catch (cause) {
        if (controller.signal.aborted) return
        setError(
          cause instanceof Error
            ? cause.message
            : "ChatGPT approval could not be checked."
        )
        schedule()
      }
    }

    schedule()
    return () => {
      controller.abort()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [device, location.search, navigate])

  async function start() {
    setStarting(true)
    setError(null)
    try {
      const response = await authPost("/api/auth/chatgpt/device")
      const result: unknown = await response.json()
      if (!response.ok || !isDeviceLogin(result)) {
        throw new Error("ChatGPT sign-in could not be started.")
      }
      setDevice(result)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "ChatGPT sign-in could not be started."
      )
    } finally {
      setStarting(false)
    }
  }

  function cancel() {
    setDevice(null)
    setError(null)
    void authPost("/api/auth/chatgpt/device/cancel").catch(() => undefined)
  }

  async function copyCode() {
    if (!device) return
    try {
      await navigator.clipboard.writeText(device.userCode)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2_000)
    } catch {
      setError("The code could not be copied. Select and copy it manually.")
    }
  }

  return (
    <main className="relative isolate min-h-svh overflow-hidden bg-[#02120c] text-[#f5f3ed]">
      <img
        src="/images/baseera-login-insight-v2.webp"
        alt=""
        aria-hidden="true"
        className="absolute inset-0 size-full animate-in object-cover object-[72%_center] opacity-45 duration-1000 zoom-in-95 fade-in sm:opacity-70 lg:opacity-100"
        width="1717"
        height="916"
        fetchPriority="high"
        decoding="async"
      />
      <div className="absolute inset-0 bg-[#02120c]/30 sm:bg-[#02120c]/10" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,#02120c_0%,#02120c_28%,rgba(2,18,12,0.94)_42%,rgba(2,18,12,0.18)_76%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,18,12,0.18)_0%,transparent_45%,rgba(2,18,12,0.35)_100%)]" />

      <div className="relative z-10 mx-auto flex min-h-svh w-full max-w-[1440px] flex-col px-6 py-7 sm:px-10 sm:py-9 lg:px-14">
        <div className="flex items-center gap-2.5 text-sm font-medium tracking-[0.16em] uppercase">
          <MessageCircle aria-hidden="true" className="size-5 text-[#eef771]" />
          Baseera
        </div>

        <div className="flex flex-1 items-center py-14 sm:py-20">
          <section
            aria-labelledby="login-heading"
            className="w-full max-w-md animate-in duration-700 fade-in slide-in-from-bottom-3"
          >
            <div className="mb-6 h-px w-10 bg-[#eef771]" aria-hidden="true" />
            <h1
              id="login-heading"
              className="max-w-sm text-4xl leading-[1.02] font-medium tracking-[-0.04em] text-balance sm:text-5xl"
            >
              {device
                ? "Connect ChatGPT to continue"
                : "Sign in to start your group"}
            </h1>

            <div className="mt-9 max-w-sm">
              {device ? (
                <div className="space-y-4">
                  <Button
                    className="h-12 w-full bg-[#eef771] text-[#02120c] hover:bg-[#f5faa5] focus-visible:ring-[#eef771]/60"
                    size="lg"
                    asChild
                  >
                    <a
                      href={device.verificationUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open ChatGPT
                      <ExternalLink aria-hidden="true" />
                    </a>
                  </Button>

                  <div className="border-y border-white/15 py-4 text-center">
                    <p className="text-xs text-[#c7e6da]/70">
                      Enter this one-time code
                    </p>
                    <p className="mt-1 font-mono text-xl font-semibold tracking-widest text-[#f5f3ed]">
                      {device.userCode}
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-2 text-[#c7e6da] hover:bg-white/10 hover:text-white"
                      onClick={() => void copyCode()}
                    >
                      {copied ? (
                        <Check aria-hidden="true" />
                      ) : (
                        <Copy aria-hidden="true" />
                      )}
                      {copied ? "Copied" : "Copy code"}
                    </Button>
                  </div>

                  <p
                    className="flex items-center justify-center gap-2 text-sm text-[#c7e6da]/70"
                    aria-live="polite"
                  >
                    <LoaderCircle aria-hidden="true" className="animate-spin" />
                    Waiting for approval…
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full text-[#c7e6da] hover:bg-white/10 hover:text-white"
                    onClick={cancel}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <Button
                    type="button"
                    size="lg"
                    className="h-12 w-full bg-[#eef771] text-[#02120c] hover:bg-[#f5faa5] focus-visible:ring-[#eef771]/60"
                    disabled={starting}
                    onClick={() => void start()}
                  >
                    {starting ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="animate-spin"
                      />
                    ) : (
                      <MessageCircle aria-hidden="true" />
                    )}
                    {starting ? "Connecting…" : "Continue with ChatGPT"}
                  </Button>
                  <p className="text-center text-xs text-[#c7e6da]/65">
                    Uses your ChatGPT account and plan.
                  </p>
                </div>
              )}

              {error && (
                <p
                  className="mt-4 text-center text-sm text-red-200"
                  role="alert"
                >
                  {error}
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}

function isDeviceLogin(value: unknown): value is DeviceLogin {
  return (
    isRecord(value) &&
    typeof value.verificationUrl === "string" &&
    value.verificationUrl.startsWith("https://") &&
    typeof value.userCode === "string" &&
    value.userCode.length > 0 &&
    typeof value.interval === "number" &&
    value.interval > 0 &&
    typeof value.expiresAt === "number" &&
    value.expiresAt > Date.now()
  )
}

function isPollResult(
  value: unknown
): value is { status: "pending" | "complete" | "expired" } {
  return (
    isRecord(value) &&
    (value.status === "pending" ||
      value.status === "complete" ||
      value.status === "expired")
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function authPost(path: string, signal?: AbortSignal) {
  return apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal,
  })
}
