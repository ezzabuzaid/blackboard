# Phase 3: Mailbox Awareness

## Goal

Let agents that are already working observe new human and peer messages between
model steps, reducing stale or duplicate contributions without adding a
manager.

Status: Mailbox delivery complete. Backlog item #429 remains open for
simultaneous first-step replies.

## Source-backed primitive

Zukhruf already provides `AgentRuntime.deliver()` and durable mailbox storage.
An active turn drains mailbox input before each model step. Delivery is not a
mid-token interruption.

The room pump remains the only idle wake path. Queue-only delivery to an active
turn already reserves a serialized fallback wake when a message misses the
turn's final model boundary; adding a separate trigger-turn delivery would
schedule the same room message twice.

## Tasks

- [x] Add a focused integration test around `AgentRuntime.deliver()`.
- [x] Prove an active participant receives a new room message before its next
      model step.
- [x] Map every room participant to its Zukhruf conversation identity.
- [x] Convert each new public room message to one inter-agent communication per
      eligible active recipient.
- [x] Use queue-only delivery for an already active recipient.
- [x] Keep the normal room pump as the idle-recipient wake path.
- [x] Prevent the normal room pump and mailbox fallback from delivering the same
      message twice.
- [x] Preserve author and other-recipient metadata.
- [x] Keep ordinary private assistant text out of the public room.
- [x] Let the agent reconsider after observing a peer reply, while keeping
      `reply_to_group` as the only public publication mechanism.

## Duplicate-reply verification

- [x] Reproduce backlog item #429 with deterministic mock agents.
- [x] Show that an agent with another model step sees an early peer reply before
      deciding whether to publish later.
- [x] Verify that agent can pass instead of repeating the contribution.
- [x] Run the live five-agent npm-package compatibility prompt used during
      visual testing.
- [ ] Close #429 only after the public transcript is materially less
      repetitive.

The live check on 2026-07-29 settled without a reply cascade, but all five
participants still selected `reply_to_group` during their concurrent first
model step. Mailbox updates became visible only after those tool calls were
already chosen, so Phase 3 correctly leaves #429 open.

## Acceptance criteria

- [x] Active agents receive room updates between model steps.
- [x] Idle agents wake for new room messages through the room pump.
- [x] Every public message reaches each eligible participant exactly once,
      through either the active mailbox path or the idle room-pump path.
- [x] No AI manager, speaker selector, or centralized semantic filter is added.
