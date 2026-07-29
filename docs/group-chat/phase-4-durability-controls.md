# Phase 4: Durability and Controls

## Goal

Move the validated room experience beyond the in-memory demo without changing
its public conversation semantics.

## Chat lifecycle

- [ ] Add a visible "New group" action.
- [ ] Create a fresh chat id without requiring manual URL editing.
- [ ] Keep the selected room in the URL for reload and sharing on the same
      installation.
- [ ] Preserve the participant roster for each room.

## Persistence and reconnect

- [ ] Replace the in-memory room transcript with durable storage.
- [ ] Persist event sequence, public messages, participants, and current room
      activity.
- [ ] Reconstruct a room after an API restart.
- [ ] Resume SSE delivery from `Last-Event-ID`.
- [ ] Define what happens to participant work interrupted by process restart.
- [ ] Verify a completed conversation survives API and browser restart.

## Operational controls

- [ ] Add a room stop action that cancels active participant turns.
- [ ] Add an explicit notification/message ceiling.
- [ ] Surface which participant failed without discarding successful replies.
- [ ] Isolate one participant failure from the remaining group.
- [ ] Reserve the human author identity so no participant can impersonate it.
- [ ] Reject duplicate and invalid participant names.
- [ ] Bound transcript and request sizes at HTTP and storage boundaries.

## Regression coverage

- [ ] Concurrent participant delivery.
- [ ] Voluntary silence.
- [ ] Immediate public replies.
- [ ] Human intervention while agents work.
- [ ] Rebroadcasting.
- [ ] Transcript hydration.
- [ ] SSE disconnect and replay.
- [ ] Browser refresh during active work.
- [ ] API restart.
- [ ] Cancellation.
- [ ] Message ceiling.
- [ ] Partial participant failure.

## Acceptance criteria

- [ ] Restarting the API does not erase a room.
- [ ] A reconnecting browser receives no gaps or duplicates.
- [ ] The user can stop runaway work.
- [ ] One failed participant does not erase other public replies.
