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
import {
  Archive,
  ChevronDown,
  CircleMinus,
  Pin,
  PinOff,
  Store,
} from "lucide-react"
import { useState } from "react"
import { useRevalidator } from "react-router"

import { api } from "./api"
import {
  loadMarketplaceEditor,
  MarketplaceTemplateDialog,
  type MarketplaceEditor,
} from "./MarketplaceTemplateDialog"

export function GroupRowMenu({
  groupId,
  name,
  agentIds,
  pinned,
  active,
}: {
  groupId: string
  name: string
  agentIds: readonly string[]
  pinned: boolean
  active: boolean
}) {
  const { revalidate } = useRevalidator()
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [marketplaceOpen, setMarketplaceOpen] = useState(false)
  const [marketplaceEditor, setMarketplaceEditor] =
    useState<MarketplaceEditor | null>(null)
  const [marketplaceLoading, setMarketplaceLoading] = useState(false)
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function loadMarketplace() {
    setMarketplaceLoading(true)
    setMarketplaceError(null)
    try {
      setMarketplaceEditor(await loadMarketplaceEditor(groupId))
    } catch {
      setMarketplaceError("Could not load this marketplace template.")
    } finally {
      setMarketplaceLoading(false)
    }
  }

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
      <DropdownMenu
        onOpenChange={(open) => {
          if (open && agentIds.length > 0) void loadMarketplace()
        }}
      >
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
            disabled={pending || agentIds.length === 0}
            title={
              agentIds.length === 0
                ? "Add at least one agent before publishing"
                : undefined
            }
            onSelect={() => setMarketplaceOpen(true)}
          >
            <Store aria-hidden="true" />
            {marketplaceLoading
              ? "Loading template…"
              : marketplaceEditor?.template?.published
                ? "Manage marketplace template"
                : "Publish as template"}
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

      {agentIds.length > 0 && (
        <MarketplaceTemplateDialog
          open={marketplaceOpen}
          editor={marketplaceEditor}
          loading={marketplaceLoading}
          error={marketplaceError}
          onOpenChange={setMarketplaceOpen}
          onEditorChange={setMarketplaceEditor}
          onRetry={() => void loadMarketplace()}
        />
      )}
    </>
  )
}
