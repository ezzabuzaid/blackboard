# Phase 2: Room HTTP and Client

Status: Complete

## Goal

Replace the single-assistant request-response lifecycle with a multi-author room
connection while keeping the existing conversation presentation components.

## API contract

- [x] Change `GET /api/chat/:chatId/state` to return:
  - ordered public messages
  - participants and specialties
  - current activity state
  - the latest event cursor
- [x] Add `GET /api/chat/:chatId/events`.
- [x] Stream native SSE events with an SSE id matching the room sequence.
- [x] Support an initial `after` cursor and `Last-Event-ID` reconnect.
- [x] Replay events after the cursor before subscribing to new events.
- [x] Add `POST /api/chat/:chatId/messages`.
- [x] Validate message id and non-empty content at the HTTP trust boundary.
- [x] Make repeated client message ids idempotent.
- [x] Return the accepted public message immediately; do not wait for agents.
- [x] Keep the SSE connection open while the room is idle.
- [x] Remove the group path's AI SDK `UIMessageStream` response.
- [x] Remove the root `POST /api/chat` route when no remaining caller uses it.

## Browser state

- [x] Replace `useChat` with a room-specific `useGroupChat` hook.
- [x] Hydrate ordered messages and the cursor from the route loader.
- [x] Open one native `EventSource` per selected room.
- [x] Reduce message and activity events into room state by sequence.
- [x] Ignore duplicate events after reconnect.
- [x] Close the old `EventSource` when the chat id changes or the component
      unmounts.
- [x] Post every human message through `/messages`.
- [x] Clear the draft after the message POST is accepted.
- [x] Keep the composer enabled while agents are considering or replying.
- [x] Disable only for an empty draft or the short message POST operation.
- [x] Render human-authored room messages on the user side and agent messages
      on the group side.
- [x] Show human names, derived initials, and specialties instead of raw role
      identifiers.
- [x] Feed `GroupActivityOverlay` from the SSE activity reducer.

## Remove obsolete request-response code

- [x] Remove `DefaultChatTransport` and `chatTransport`.
- [x] Remove group usage of `ChatSession` and AI SDK `UseChatHelpers`.
- [x] Remove `GroupUIMessage` and `data-groupMessage` transcript projection
      after the room message model replaces them.
- [x] Remove resume logic that assumes one active assistant response.
- [x] Preserve artifact URL rendering only if group participants still publish
      artifacts.

## Tests

- [x] State hydration followed by SSE connection cannot lose an event emitted
      between the two requests.
- [x] Reconnection after a cursor replays each missed event once.
- [x] Posting while agents work renders the human message immediately.
- [x] A fast agent reply renders before a slow agent finishes.
- [x] The composer accepts another message while activity is live.
- [x] Switching rooms disconnects the old stream and clears old activity.
- [x] Visually verify desktop layout, scrolling, reconnect, and intervention.

## Acceptance criteria

- [x] The group screen no longer imports `useChat` or `ChatTransport`.
- [x] The page behaves as one room connection, not one response stream per
      human message.
- [x] Human and agent messages share one ordered public transcript.
