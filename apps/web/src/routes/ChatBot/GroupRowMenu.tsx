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
  Trash2,
} from "lucide-react"
import { useState } from "react"
import { useNavigate, useRevalidator } from "react-router"

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
  const navigate = useNavigate()
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
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
          <DropdownMenuItem
            variant="destructive"
            disabled={pending}
            onSelect={() => {
              setDeleteError(null)
              setConfirmingDelete(true)
            }}
          >
            <Trash2 aria-hidden="true" />
            Delete group
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

      <AlertDialog
        open={confirmingDelete}
        onOpenChange={(open) => {
          if (!open && pending) return
          setConfirmingDelete(open)
        }}
      >
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-left">
                <p>This cannot be undone.</p>
                <dl className="mt-5 space-y-4">
                  <div>
                    <dt className="text-sm font-medium text-foreground">
                      Deleted
                    </dt>
                    <dd className="mt-1 text-pretty leading-6">
                      Conversation, agent memory, group files and artifacts,
                      every share link, and any unpublished marketplace draft.
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-foreground">
                      Kept
                    </dt>
                    <dd className="mt-1 text-pretty leading-6">
                      Published marketplace template, account-level participant
                      data, agent telemetry, and API request logs.
                    </dd>
                  </div>
                </dl>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                setPending(true)
                setDeleteError(null)
                void api
                  .request("DELETE /groups/{groupId}", { groupId })
                  .then(async () => {
                    setConfirmingDelete(false)
                    if (active) await navigate("/")
                    else await revalidate()
                  })
                  .catch(() => {
                    setDeleteError("Could not delete this group. Try again.")
                  })
                  .finally(() => setPending(false))
              }}
            >
              {pending ? "Deleting…" : "Delete group"}
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
