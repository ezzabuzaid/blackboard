# Phase 0: Group Activity Overlay

Status: Complete

## Goal

Explain what the chat is doing without exposing private reasoning or hiding
latency behind one generic "Thinking" marker.

## Tasks

- [x] Reuse `InfoOverlay` for `GroupActivityOverlay`.
- [x] Show every participant and their current public state:
  - `Notified`
  - `Considering`
  - `Replied`
  - `Passed this update`
  - `Caught up`
  - `Failed`
- [x] Show the current notification number and message count.
- [x] Show cumulative public reply counts per participant.
- [x] Show a settled state when the chat inbox becomes empty.
- [x] Keep private assistant text, chain of thought, tool calls, queue IDs,
      model names, and duplicate message content out of the overlay.
- [x] Keep the activity reducer independent from its temporary event source.
- [x] Keep the temporary `useChat.onData` wiring isolated so Phase 2 can replace
      it with chat SSE activity events.
- [x] Derive avatars from stable participant names; do not add avatar metadata
      unless derived initials and colors prove insufficient.

## Acceptance criteria

- [x] The overlay changes while participant turns are still running.
- [x] A participant that publishes a reply is distinguishable from one that
      passes.
- [x] The final state says that everyone is caught up.
- [x] Refreshing or switching chats does not retain activity from the previous
      chat.
- [x] The overlay remains useful after `useChat` is removed.

## Not part of this phase

- Mid-turn mailbox delivery.
- Public transcript persistence.
- Cancellation or round limits.
