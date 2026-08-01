# Phase 1: Single Chat Pump

## Goal

Make `WhatsAppGroup` an event-driven chat where every public message appears
immediately and one pump owns all participant notification work.

Status: Complete

## Participant identities

Use stable human names as the Zukhruf declaration identity and keep the role in
`specialty`:

| Name | Specialty             |
| ---- | --------------------- |
| Maya | Research              |
| Omar | Engineering           |
| Lina | Product               |
| Rami | Critic                |
| Noor | Creative alternatives |

## Tests first

- [x] Block one mock participant and prove a faster participant's public reply
      is emitted before the blocked participant finishes.
- [x] Post a second human message while a participant batch is running and
      prove the human message is emitted immediately.
- [x] Prove that intervention is delivered exactly once in the next
      notification batch.
- [x] Prove that agent replies posted during a batch are delivered exactly once
      in the next batch.
- [x] Prove only one pump drains the pending inbox when posts overlap.
- [x] Prove the chat settles only after both the inbox and active participant
      batch are empty.

## Chat model

- [x] Replace the per-call `send()` loop with one chat-owned pending inbox.
- [x] Add one `post()` path used by both humans and `reply_to_group`.
- [x] Give every public message:
  - a stable id
  - a monotonically increasing sequence
  - an author
  - content
- [x] Append a message to the transcript before scheduling agent work.
- [x] Notify chat subscribers immediately after appending the message.
- [x] Add the same message to the pending notification inbox.
- [x] Start the pump only when it is not already running.
- [x] Drain one immutable notification batch at a time.
- [x] Run eligible participant turns concurrently for that batch.
- [x] Exclude a participant's own message while still delivering messages from
      every other author.
- [x] Let messages posted during the active batch accumulate for the next
      batch.
- [x] Emit activity events from the same pump state transitions.
- [x] Emit `settled` only after no pending messages remain.
- [x] Remove `ReplyInbox` once `post()` owns publication and scheduling.

## Current-phase intervention contract

- [x] Accept human posts while participant turns are active.
- [x] Do not cancel or restart active participant turns.
- [x] Deliver an intervention to active participants in their next batch.
- [x] Keep mailbox-based between-step injection out of this phase.

## Acceptance criteria

- [x] Public reply latency is determined by the replying participant, not the
      slowest participant in the batch.
- [x] Human messages never wait for the chat to settle before becoming public.
- [x] No overlapping caller can drain another caller's replies.
- [x] The original concurrent, voluntary, no-manager behavior remains intact.
