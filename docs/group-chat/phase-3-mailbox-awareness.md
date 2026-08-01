# Phase 3: Mailbox Awareness

## Goal

Let agents that are already working observe new human and peer messages between
model steps, reducing stale or duplicate contributions without adding a
manager.

Status: Complete.

## Source-backed primitive

Zukhruf already provides `AgentRuntime.deliver()` and durable mailbox storage.
An active turn drains mailbox input before each model step. Delivery is not a
mid-token interruption.

The chat pump remains the only idle wake path. Queue-only delivery to an active
turn already reserves a serialized fallback wake when a message misses the
turn's final model boundary; adding a separate trigger-turn delivery would
schedule the same chat message twice.

## Tasks

- [x] Add a focused integration test around `AgentRuntime.deliver()`.
- [x] Prove an active participant receives a new chat message before its next
      model step.
- [x] Map every chat participant to its Zukhruf conversation identity.
- [x] Convert each new public chat message to one inter-agent communication per
      eligible active recipient.
- [x] Use queue-only delivery for an already active recipient.
- [x] Keep the normal chat pump as the idle-recipient wake path.
- [x] Prevent the normal chat pump and mailbox fallback from delivering the same
      message twice.
- [x] Preserve author and other-recipient metadata.
- [x] Keep ordinary private assistant text out of the public chat.
- [x] Let the agent reconsider after observing a peer reply, while keeping
      `reply_to_group` as the only public publication mechanism.

## Duplicate-reply verification

- [x] Reproduce backlog item #429 with deterministic mock agents.
- [x] Show that an agent with another model step sees an early peer reply before
      deciding whether to publish later.
- [x] Verify that agent can pass instead of repeating the contribution.
- [x] Run the live five-agent npm-package compatibility prompt used during
      visual testing.
- [x] Close #429 only after the public transcript is materially less
      repetitive.

`reply_to_group` now checks the public transcript sequence before publishing.
The first current reply publishes immediately; a stale concurrent attempt
receives the newer messages and must reconsider before it can publish.

## Acceptance criteria

- [x] Active agents receive chat updates between model steps.
- [x] Idle agents wake for new chat messages through the chat pump.
- [x] Every public message reaches each eligible participant exactly once,
      through either the active mailbox path or the idle chat-pump path.
- [x] No AI manager, speaker selector, or centralized semantic filter is added.
