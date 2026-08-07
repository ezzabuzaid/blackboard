import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@stdlib/shadcn"
import { Archive, ChevronDown, CircleMinus, Pin, PinOff } from "lucide-react"
import { useState } from "react"
import { useRevalidator } from "react-router"

import { api } from "./api"

export function GroupRowMenu({
  groupId,
  name,
  pinned,
  active,
}: {
  groupId: string
  name: string
  pinned: boolean
  active: boolean
}) {
  const { revalidate } = useRevalidator()
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [pending, setPending] = useState(false)

  async function run(action: () => Promise<unknown>) {
    setPending(true)
    try {
      await action()
      await revalidate()
    } catch {
      // The list keeps its current state; the next revalidation reconciles it.
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Actions for ${name}`}
            className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100 max-sm:opacity-60"
          >
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem
            disabled={pending}
            onSelect={() =>
              void run(() =>
                api.request(
                  pinned
                    ? "DELETE /groups/{groupId}/pin"
                    : "POST /groups/{groupId}/pin",
                  { groupId }
                )
              )
            }
          >
            {pinned ? (
              <PinOff aria-hidden="true" />
            ) : (
              <Pin aria-hidden="true" />
            )}
            {pinned ? "Unpin chat" : "Pin chat"}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={pending}
            onSelect={() =>
              void run(() =>
                api.request("POST /groups/{groupId}/archive", { groupId })
              )
            }
          >
            <Archive aria-hidden="true" />
            Archive chat
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={pending}
            onSelect={() => setConfirmingClear(true)}
          >
            <CircleMinus aria-hidden="true" />
            Clear chat
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmingClear} onOpenChange={setConfirmingClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              All messages, agent memory, and files in {name} will be
              permanently deleted. The group itself stays.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                void run(async () => {
                  await api.request("POST /groups/{groupId}/clear", { groupId })
                  setConfirmingClear(false)
                  // The open chat holds an SSE cursor past the deleted
                  // messages; only a reload gives it a fresh stream.
                  if (active) globalThis.location.reload()
                })
              }}
            >
              {pending ? "Clearing…" : "Clear chat"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
