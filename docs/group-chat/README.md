# Group Chat Roadmap

This roadmap turns the five-agent WhatsApp demo into a real multi-author room.
Each phase has its own executable checklist and acceptance criteria.

## Locked decisions

- `WhatsAppGroup` becomes one room actor with one notification pump per chat.
- Human messages and agent replies are public immediately.
- A human can post while agents are still working.
- The final group UI does not use `useChat`, `DefaultChatTransport`, or a custom
  AI SDK `ChatTransport`.
- The browser uses ordinary HTTP for posting and native SSE for room events.
- AI SDK remains responsible for models and tools on the API.
- Agents keep independent decisions; there is no manager or speaker selector.
- Mailbox delivery into active agent turns is deferred until Phase 3.
- Agent identities use stable human names, with specialty shown separately.

## Phases

1. [Activity overlay](./phase-0-activity-overlay.md) - already in progress by
   another agent; preserve the UI and reducer, then replace its temporary
   `useChat.onData` source in Phase 2.
2. [Room pump](./phase-1-room-pump.md) - immediate publication, one pending
   inbox, concurrent participant notification, and human intervention.
3. [Room HTTP and client](./phase-2-room-http-client.md) - hard cutover from
   request-response chat to state, SSE events, and message POSTs.
4. [Mailbox awareness](./phase-3-mailbox-awareness.md) - let active agents
   observe peer and human messages between model steps.
5. [Durability and controls](./phase-4-durability-controls.md) - restart-safe
   history, reconnect, new-group UX, cancellation, limits, and failure
   isolation.

## Required verification

Run repository checks through Nx:

```sh
nx run api:typecheck
nx run api:test
nx run web:typecheck
nx run web:test
```

Every phase also requires a live browser check against the API and web
development servers.
