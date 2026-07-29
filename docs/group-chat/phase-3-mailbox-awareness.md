# Phase 3: Mailbox Awareness

## Goal

Let agents that are already working observe new human and peer messages between
model steps, reducing stale or duplicate contributions without adding a
manager.

## Source-backed primitive

Zukhruf already provides `AgentRuntime.deliver()` and durable mailbox storage.
An active turn drains mailbox input before each model step. Delivery is not a
mid-token interruption.

## Tasks

- [ ] Add a focused integration test around `AgentRuntime.deliver()`.
- [ ] Prove an active participant receives a new room message before its next
      model step.
- [ ] Map every room participant to its Zukhruf conversation identity.
- [ ] Convert each new public room message to one inter-agent communication per
      eligible recipient.
- [ ] Use queue-only delivery for an already active recipient.
- [ ] Use trigger-turn delivery for an idle recipient that must wake.
- [ ] Prevent the normal room pump and mailbox wake from delivering the same
      message twice.
- [ ] Preserve author and other-recipient metadata.
- [ ] Keep ordinary private assistant text out of the public room.
- [ ] Let the agent reconsider after observing a peer reply, while keeping
      `reply_to_group` as the only public publication mechanism.

## Duplicate-reply verification

- [ ] Reproduce backlog item #429 with deterministic mock agents.
- [ ] Show that a late agent sees an early peer reply before publishing.
- [ ] Verify the late agent can pass instead of repeating the contribution.
- [ ] Run the live five-agent prompt used during visual testing.
- [ ] Close #429 only after the public transcript is materially less
      repetitive.

## Acceptance criteria

- [ ] Active agents receive room updates between model steps.
- [ ] Idle agents wake for new room messages.
- [ ] Every public message reaches each eligible participant exactly once.
- [ ] No AI manager, speaker selector, or centralized semantic filter is added.
