import { Button, Input, Label } from "@stdlib/shadcn"
import { KeyRound, LoaderCircle, MessageCircle } from "lucide-react"
import { type FormEvent, useState } from "react"
import {
  Link,
  replace,
  type LoaderFunctionArgs,
  useLocation,
  useNavigate,
} from "react-router"

import { hasIdentity, redirectDestination } from "../../auth"
import { authClient } from "../../auth-client"
import { api } from "../ChatBot/api"

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const session: unknown = await api.request(
      "GET /auth/get-session",
      {},
      { signal: request.signal }
    )
    if (hasIdentity(session)) throw replace(redirectDestination(request.url))
  } catch (error) {
    if (error instanceof Response || request.signal.aborted) throw error
  }
  return null
}

export default function Login() {
  const location = useLocation()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setSubmitting(true)
    setError(null)
    try {
      if (!globalThis.PublicKeyCredential) {
        throw new Error("This browser does not support passkeys.")
      }

      const result = creating
        ? await authClient.passkey.addPasskey({
            context: String(
              new FormData(event.currentTarget).get("name") ?? ""
            ).trim(),
          })
        : await authClient.signIn.passkey()
      if (result.error) {
        throw new Error(
          result.error.message ?? "Passkey authentication failed."
        )
      }

      await navigate(redirectDestination(location.search), { replace: true })
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Passkey authentication could not be completed."
      )
    } finally {
      setSubmitting(false)
    }
  }

  function switchMode() {
    setCreating((current) => !current)
    setError(null)
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
        <nav
          aria-label="Public navigation"
          className="flex items-center gap-2.5 text-sm font-medium tracking-[0.16em] uppercase"
        >
          <MessageCircle aria-hidden="true" className="size-5 text-[#eef771]" />
          Baseera
          <Link
            to="/groups/new"
            className="ms-4 text-xs text-[#c7e6da]/75 normal-case transition-colors hover:text-[#eef771] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#eef771]"
          >
            Catalog
          </Link>
        </nav>

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
              {creating ? "Create your passkey" : "Welcome back"}
            </h1>

            <p className="mt-4 max-w-sm text-base leading-7 text-[#c7e6da]/75">
              {creating
                ? "Enter your name, then use your device to secure your account."
                : "Use your device passkey to continue to Baseera."}
            </p>

            <form className="mt-9 max-w-sm space-y-4" onSubmit={submit}>
              {creating && (
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-[#d9eee6]">
                    Name
                  </Label>
                  <Input
                    id="name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    maxLength={80}
                    required
                    autoFocus
                    disabled={submitting}
                    className="h-12 border-white/20 bg-white/10 text-base text-white placeholder:text-[#c7e6da]/45"
                  />
                </div>
              )}

              <Button
                type="submit"
                size="lg"
                className="h-12 w-full bg-[#eef771] text-[#02120c] hover:bg-[#f5faa5] focus-visible:ring-[#eef771]/60"
                disabled={submitting}
              >
                {submitting && (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                )}
                {!submitting && <KeyRound aria-hidden="true" />}
                {submitting
                  ? creating
                    ? "Creating passkey…"
                    : "Signing in…"
                  : creating
                    ? "Create passkey"
                    : "Sign in with passkey"}
              </Button>

              <p className="text-center text-sm text-[#c7e6da]/75">
                {creating ? "Already have a passkey?" : "New to Baseera?"}{" "}
                <button
                  type="button"
                  className="font-medium text-[#eef771] underline-offset-4 hover:underline"
                  disabled={submitting}
                  onClick={switchMode}
                >
                  {creating ? "Sign in" : "Create a passkey"}
                </button>
              </p>

              {error && (
                <p className="text-center text-sm text-red-200" role="alert">
                  {error}
                </p>
              )}
            </form>
          </section>
        </div>
      </div>
    </main>
  )
}
