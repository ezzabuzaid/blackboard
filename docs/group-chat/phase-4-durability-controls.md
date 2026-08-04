# Phase 4: Durability and Controls

## Goal

Move the validated chat experience beyond the in-memory demo without changing
its public conversation semantics.

## Chat lifecycle

- [x] Add a visible "New group" action.
- [x] Create a fresh chat id without requiring manual URL editing.
- [x] Keep the selected chat in the URL for reload and sharing on the same
      installation.
- [x] Preserve the participant roster for each chat.

## Persistence and reconnect

- [x] Replace the in-memory chat transcript with durable storage.
- [x] Persist event sequence, public messages, participants, and current chat
      activity.
- [x] Reconstruct a chat after an API restart.
- [x] Resume delivery by replaying the durable Zukhruf session stream.
- [x] Define what happens to participant work interrupted by process restart.
- [x] Verify a completed conversation survives API and browser restart.

## Operational controls

- [x] Add a chat stop action that cancels active participant turns.
- [x] Add an explicit notification/message ceiling.
- [x] Surface which participant failed without discarding successful replies.
- [x] Isolate one participant failure from the remaining group.
- [x] Reserve the human author identity so no participant can impersonate it.
- [x] Reject duplicate and invalid participant names.
- [x] Bound transcript and request sizes at HTTP and storage boundaries.

## Regression coverage

- [x] Concurrent participant delivery.
- [x] Voluntary silence.
- [x] Immediate public replies.
- [x] Human intervention while agents work.
- [x] Rebroadcasting.
- [x] Transcript hydration.
- [x] SSE disconnect and replay.
- [x] Browser refresh during active work.
- [x] API restart.
- [x] Cancellation.
- [x] Message ceiling.
- [x] Partial participant failure.

## Acceptance criteria

- [x] Restarting the API does not erase a chat.
- [x] A reconnecting browser receives no gaps or duplicates.
- [x] The user can stop runaway work.
- [x] One failed participant does not erase other public replies.
