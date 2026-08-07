import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
} from "@stdlib/shadcn"
import { Check, Copy, Share2 } from "lucide-react"
import { useState } from "react"

import { api } from "./api"

interface GroupShare {
  token: string
  createdAt: string
}

export function ShareGroupDialog({ groupId }: { groupId: string }) {
  const [open, setOpen] = useState(false)
  const [share, setShare] = useState<GroupShare | null>(null)
  const [pending, setPending] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const shareUrl = share
    ? `${globalThis.location.origin}/share/${share.token}`
    : null

  async function run(action: () => Promise<GroupShare | null>) {
    setPending(true)
    setError(null)
    try {
      setShare(await action())
    } catch {
      setError("Something went wrong. Try again.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setCopied(false)
        setError(null)
        if (next) {
          void run(async () => {
            const response: unknown = await api.request(
              "GET /groups/{groupId}/share",
              { groupId }
            )
            return readShare(
              isRecord(response) ? response.share : null
            )
          })
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label="Share group">
          <Share2 aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share group</DialogTitle>
          <DialogDescription>
            Anyone with the link can read this conversation. They cannot reply.
          </DialogDescription>
        </DialogHeader>

        {shareUrl ? (
          <div className="flex items-center gap-2">
            <Input readOnly value={shareUrl} aria-label="Share link" dir="ltr" />
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={async () => {
                await globalThis.navigator.clipboard.writeText(shareUrl)
                setCopied(true)
              }}
            >
              {copied ? (
                <Check aria-hidden="true" />
              ) : (
                <Copy aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              void run(async () =>
                readShare(
                  await api.request("POST /groups/{groupId}/share", { groupId })
                )
              )
            }
          >
            {pending ? "Creating…" : "Create share link"}
          </Button>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          {shareUrl && (
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() =>
                void run(async () => {
                  await api.request("DELETE /groups/{groupId}/share", {
                    groupId,
                  })
                  setCopied(false)
                  return null
                })
              }
            >
              Revoke link
            </Button>
          )}
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Done
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function readShare(value: unknown): GroupShare | null {
  return isRecord(value) &&
    typeof value.token === "string" &&
    typeof value.createdAt === "string"
    ? { token: value.token, createdAt: value.createdAt }
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
