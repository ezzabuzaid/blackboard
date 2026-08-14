# Delete group: recovered contract and implementation constraints

This note records the repository evidence that should govern permanent group
deletion before implementation begins. It separates requirements that were
written down previously from risks inferred from the current implementation.

## Repository evidence reviewed

The pass covered tracked Markdown, application source, tests, all local Git
history and refs, and Git notes. The repository has one local branch (`main`),
no Git notes, and no issue/backlog file that assigns permanent group deletion
an ID. Generated build caches and runtime product data were deliberately not
treated as design evidence.

The history that established the current behavior is:

- `f783b0d56dd8e509a0a02c5063ddeb922bd23305` (`feat(groups): add group
  sharing`) introduced sharing, archive, clear, the clear confirmation, and the
  runtime teardown ordering comment.
- `0547f6b2aa3dc5cc17b3a45b7a261a29595f1994` (`feat(groups): publish
  existing groups to marketplace`) linked marketplace templates back to source
  groups.
- `fab354c18d47fd4b43a59fd56dae0010e7364709` (`feat(groups): add personal
  wealth workspace`) added the only explicit permanent-delete requirement.

## Accepted implementation plan

The product keeps Archive, Clear chat, and Delete group as three distinct
actions. `DELETE /groups/{groupId}` is synchronous and owner-scoped, returns
`200 { deleted: true }`, and uses the existing indistinguishable 404 response
for missing, already-deleted, and foreign groups.

One retry-safe lifecycle coordinator will:

1. Register an in-process deletion guard and join duplicate delete requests.
2. Block new chat, stream, share, and mutation access for the group.
3. Dispose the active runtime and stop active or queued work.
4. Delete durable queues, transcript/activity streams, participant context
   trees, and mailboxes.
5. Delete the group sandbox, including private files and artifacts.
6. Hard-delete all active and historical share-token rows.
7. Detach a published marketplace template or delete its unpublished draft.
8. Hard-delete the group row last.
9. Release the in-process guard.

Every cleanup step is idempotent. On failure, the API returns an error, retains
the group row, releases the guard, and lets the owner retry. The accepted design
does not add a persistent deletion state or recovery worker.

Deletion explicitly preserves account-scoped participant definitions, the
shared `/workspace/business`, `/workspace/backlog`, and `/workspace/product`
mounts, agent telemetry, and bounded operational Evlog files. Confirmation copy
must disclose that these surfaces remain.

A published marketplace template survives as an independent artifact with
`source_group_id = NULL`; an unpublished linked draft is deleted. Owners can
edit a detached template from its marketplace card or permanently withdraw it.
Withdrawal hard-deletes the detached template rather than creating a private
draft or a separate "My Templates" system.

The existing group row menu keeps Clear chat and adds Delete group immediately
below it. Its separate confirmation names the group and uses one destructive
button, not typed-name confirmation. After success, deleting the active group
navigates through `/` so the loader selects the newest remaining group or
`/groups/new`; deleting an inactive group keeps the current chat and revalidates
the list. Failures stay visible and retryable in the dialog.

## Requirements already written down

These are requirements, not new recommendations:

1. Permanent delete is distinct from archive. Archive only timestamps the
   group so the normal list hides it, while the record remains retrievable and
   can be restored. See
   [GroupStore.list/setArchived](../../apps/api/src/group/group-store.ts#L143-L195),
   [the route contract](../../apps/api/src/routes/groups.route.ts#L256-L298),
   and the existing assertions that an archived group still exists
   [in the store test](../../apps/api/src/group/group-store.test.ts#L87-L99).
2. Permanent delete is distinct from clear. Clear permanently removes the
   conversation data while intentionally leaving the group itself available;
   the UI says exactly that in
   [the current confirmation](../../apps/web/src/routes/ChatBot/GroupRowMenu.tsx#L159-L185).
3. The explicit permanent-delete boundary must remove the **group record,
   transcript, agent memory/context, mailboxes, sandbox, artifacts, and share
   tokens together**. Clearing alone is insufficient, and an existing public
   share currently has to be revoked separately. This is the repository's
   clearest statement of intent:
   [Personal Wealth platform gaps](../personal-wealth-platform-gaps.md#L40-L42).
4. The operation must be owner-scoped. Every neighboring group mutation first
   resolves the group by `(userId, groupId)` and returns the same `404 Group not
   found` response for a missing or foreign group; the clear route and its test
   demonstrate the contract
   ([route](../../apps/api/src/routes/groups.route.ts#L300-L320),
   [test](../../apps/api/src/app.test.ts#L1147-L1173)). Authentication is also
   mandatory for `/groups/*`
   ([middleware](../../apps/api/src/routes/groups.route.ts#L10-L23)).
5. The user-facing action is destructive and needs explicit confirmation. The
   existing clear flow already uses an alert dialog and names the irreversible
   data loss
   ([GroupRowMenu](../../apps/web/src/routes/ChatBot/GroupRowMenu.tsx#L147-L188)).

Before this implementation there was no `DELETE /groups/:groupId` route,
dependency method, group-store deletion method, share-token deletion method, or
permanent-delete test. The closest implementation to reuse was the existing
clear lifecycle, not archive.

## What the current clear lifecycle already owns

`clearGroupChat` currently composes three operations: clear the runtime, remove
the group sandbox recursively, then reset only the group's sidebar message
summary. It does **not** delete the group record or touch shares
([production wiring](../../apps/api/src/index.ts#L143-L165)).

`WhatsAppChatRuntime.clear()` already handles most conversation-owned state:

- evicts and disposes the live in-process group session;
- removes the group's durable queue directory in the current checkout;
- deletes the Zukhruf stream and transcript chunks;
- deletes participant context trees; and
- drains participant mailboxes.

See [the complete clear method](../../apps/api/src/group/chat-runtime.ts#L161-L196).
The durable transcript behavior is covered across a second runtime instance in
[the existing regression test](../../apps/api/src/app.test.ts#L3334-L3371).

The sandbox root is scoped by the hashed user and hashed chat ID
([sandboxRoot](../../apps/api/src/sandbox.ts#L39-L60)); generated artifacts live
under that same root
([artifactRoot](../../apps/api/src/sandbox.ts#L59-L73)). Therefore recursive
sandbox deletion also deletes artifacts; a separate artifact traversal is not
needed.

## Current-code risks and warnings

These are constraints discovered from the live implementation. They were not
all settled by the earlier written requirement.

### 1. Active runtime disposal has a mandatory order

The runtime explicitly warns that the live group must be disposed **before**
its stream is deleted: disposal emits a final stopped event that otherwise
violates the stream foreign key
([ordering comment and implementation](../../apps/api/src/group/chat-runtime.ts#L166-L180)).
Disposal also interrupts an active pump and cancels active participant turns
([WhatsAppGroup.stop/dispose](../../apps/api/src/group/whatsapp.ts#L607-L665)).

Permanent delete should therefore reuse `runtime.clear(conversation)` as the
conversation teardown primitive. It must not duplicate its deletes in a new
route or delete the stream/group row first.

### 2. The group record should be deleted last

The direct Zukhruf session guard treats a missing group owner as reachable:
`owner === null || owner === userId`
([ownedSessionsOnly](../../apps/api/src/app.ts#L80-L103)). If the group row is
removed while its stream still exists, another authenticated user can pass that
guard for the orphaned session. Deleting all runtime/session data before the
group record avoids opening that window.

Keeping the row until cleanup succeeds also makes failure safer: a partially
cleared group remains owner-scoped and the cleanup can be retried. The lifecycle
spans multiple SQLite databases plus filesystem directories, so it cannot be a
single SQLite transaction; each cleanup step should be idempotent and the group
row is the final commit point.

### 3. New work can race deletion

`runtime.clear()` removes the cached chat entry before awaiting disposal
([chat cache teardown](../../apps/api/src/group/chat-runtime.ts#L170-L175)), while
`#chat()` is allowed to create a new session whenever the map has no entry
([session creation](../../apps/api/src/group/chat-runtime.ts#L225-L235)). As long
as the group row still exists, a concurrent post/state request may recreate the
session during deletion. Permanent delete therefore needs one shared
deleting/serialization boundary that rejects or waits out new work for that
group; sequencing existing calls without such a gate is racy.

### 4. Revoking a share is not removing its tokens

The written requirement says to remove share tokens. The current `revoke()`
only stamps `revoked_at`; all current and previously revoked token rows remain
in `shares.sqlite`
([share schema and revoke](../../apps/api/src/group/share-store.ts#L19-L37),
[revoke implementation](../../apps/api/src/group/share-store.ts#L69-L77)).
Calling `revoke()` during permanent delete would make public resolution fail,
but it would not satisfy data deletion. The share store needs one owner-scoped
hard-delete operation for **all** rows belonging to the group, including old
revoked/replaced tokens. Public share reads already fail closed when either the
token or group is gone
([share route](../../apps/api/src/routes/shares.route.ts#L14-L39)).

### 5. Marketplace-template behavior is settled

A saved marketplace template stores `source_group_id`, and the store enforces
one template per publisher/source group
([schema/index](../../apps/api/src/group/marketplace-group-template-store.ts#L37-L78)).
Published templates are otherwise self-contained snapshots and remain listable
without loading the source group
([published query](../../apps/api/src/group/marketplace-group-template-store.ts#L137-L157)).
The group-specific editor, however, looks templates up through the live group
([editor route](../../apps/api/src/routes/group-templates.route.ts#L66-L113)).

The accepted product policy preserves published templates by nulling their
source group reference and deletes unpublished linked drafts. Detached
published templates remain editable by their owner from the marketplace;
withdrawing one hard-deletes it. A dangling `source_group_id` and private
detached drafts are both intentionally excluded.

### 6. Telemetry is retained

Agent telemetry files may contain prompts and model output, but each file is
scoped to a hashed **user plus participant**, not a group
([trace path](../../apps/api/src/group/participants/participant-directory.ts#L183-L209)).
Group turns are distinguished only inside the JSONL records by a function ID
such as `${groupId}:${participantName}`
([runtime tagging](../../apps/api/src/group/chat-runtime.ts#L301-L312)); trace
reading filters the shared file by that marker
([readAgentTraces](../../apps/api/src/traces/agent-traces.ts#L33-L75)).

The accepted policy retains telemetry unchanged. Delete group must not rewrite
or delete these shared trace files, and the user-facing confirmation must say
that telemetry remains. Bounded operational Evlog request files are retained
under the same explicit exclusion.

### 7. User-level participant data must survive

Group sandboxes mount participant definitions at `/workspace/participants`
([group sandbox mount](../../apps/api/src/group/sandbox.ts#L12-L25)). Custom
participant files are stored under a user-level SQLite filesystem
([ParticipantDirectory.filesystem](../../apps/api/src/group/participants/participant-directory.ts#L58-L87)).
Deleting the group-owned sandbox root is correct; deleting that shared backing
store would cause cross-group data loss. "Agent memory" in the current clear
boundary means the group's Zukhruf participant context trees, not all of the
user's participant definitions/files.

### 8. The active-chat UI must navigate away

Clear currently reloads the page because the open SSE client holds a cursor
past the deleted stream
([clear UI comment](../../apps/web/src/routes/ChatBot/GroupRowMenu.tsx#L173-L181)).
Reloading after permanent deletion would reload a now-invalid `chatId`. The
loader already selects the first remaining group, or redirects to `/groups/new`
when none remain, whenever the URL has no `chatId`
([loader fallback](../../apps/web/src/routes/ChatBot/loader.ts#L22-L34)). Thus
deleting the active group should navigate to the chat root without that query
parameter; deleting an inactive group only needs list revalidation.

## Recovered implementation contract

The smallest implementation consistent with all evidence is one authenticated,
owner-scoped `DELETE /groups/:groupId` lifecycle, backed by a single application
dependency rather than route-level orchestration:

1. Verify ownership without revealing whether a foreign group exists.
2. Acquire a per-group deletion gate so no new session/message can race cleanup.
3. Dispose the active group and clear its queue, stream/transcript, participant
   contexts, and mailboxes by reusing `runtime.clear()`.
4. Remove the group sandbox root; this removes artifacts too.
5. Hard-delete every share-token row for the owner/group.
6. Detach a published marketplace template or delete its unpublished draft;
   leave telemetry and bounded operational logs unchanged.
7. Delete the owner-scoped group row last and release the gate.
8. Return success only after all required cleanup completes. Repeating cleanup
   after an interrupted attempt must be safe.
9. In the web client, confirm the full irreversible scope, then navigate away
   if the deleted group was active or revalidate if it was not.

## Implementation status

Implemented on 2026-08-14. The API now coordinates guarded, owner-scoped
deletion through `DELETE /groups/{groupId}` and reuses `runtime.clear()` before
removing the sandbox, shares, marketplace link, and group row. Published
templates detach and can be managed or permanently withdrawn from the public
marketplace. The group row menu exposes the separate destructive action and
navigates away from an active deleted group.

Focused deletion, store, marketplace lifecycle, and route tests pass. The full
web build, typecheck, and test target pass. The full API test target still has
one unrelated pre-existing participant-default assertion mismatch: the staged
default is `deepseek/deepseek-v4-pro-0813`, while the staged test expects
`openai/gpt-5.6-luna`.

## Verification contract

- Group-store deletion succeeds only for the owner and removes archived/pinned
  groups as well as normal groups.
- Route tests cover unauthenticated, foreign/missing, and successful deletion
  without leaking existence.
- An active group is stopped/disposed before stream deletion, and no participant
  reply or scheduled wake can recreate data after delete.
- After a fresh runtime instance, the transcript/session, participant context,
  mailboxes, durable queue, sandbox, and artifacts are absent.
- Every current and historical share token for the group is physically absent
  and no public URL resolves; another group's tokens remain intact.
- Failure before the final group-row delete is retryable and never exposes an
  orphaned Zukhruf session through the `owner === null` path.
- Published templates detach, unpublished drafts disappear, and detached
  templates remain editable and permanently withdrawable.
- Telemetry, bounded operational logs, account-scoped participant definitions,
  and shared business/backlog/product mounts remain unchanged.
- The active-group UI leaves the deleted route; inactive deletion keeps the
  current chat open and removes only the deleted sidebar row.
