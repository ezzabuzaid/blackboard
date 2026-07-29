# Phase 2: Room HTTP and Client

## Goal

Replace the single-assistant request-response lifecycle with a multi-author room
connection while keeping the existing conversation presentation components.

## API contract

- [ ] Change `GET /api/chat/:chatId/state` to return:
  - ordered public messages
  - participants and specialties
  - current activity state
  - the latest event cursor
- [ ] Add `GET /api/chat/:chatId/events`.
- [ ] Stream native SSE events with an SSE id matching the room sequence.
- [ ] Support an initial `after` cursor and `Last-Event-ID` reconnect.
- [ ] Replay events after the cursor before subscribing to new events.
- [ ] Add `POST /api/chat/:chatId/messages`.
- [ ] Validate message id and non-empty content at the HTTP trust boundary.
- [ ] Make repeated client message ids idempotent.
- [ ] Return the accepted public message immediately; do not wait for agents.
- [ ] Keep the SSE connection open while the room is idle.
- [ ] Remove the group path's AI SDK `UIMessageStream` response.
- [ ] Remove the root `POST /api/chat` route when no remaining caller uses it.

## Browser state

- [ ] Replace `useChat` with a room-specific `useGroupChat` hook.
- [ ] Hydrate ordered messages and the cursor from the route loader.
- [ ] Open one native `EventSource` per selected room.
- [ ] Reduce message and activity events into room state by sequence.
- [ ] Ignore duplicate events after reconnect.
- [ ] Close the old `EventSource` when the chat id changes or the component
      unmounts.
- [ ] Post every human message through `/messages`.
- [ ] Clear the draft after the message POST is accepted.
- [ ] Keep the composer enabled while agents are considering or replying.
- [ ] Disable only for an empty draft or the short message POST operation.
- [ ] Render human-authored room messages on the user side and agent messages
      on the group side.
- [ ] Show human names, derived initials, and specialties instead of raw role
      identifiers.
- [ ] Feed `GroupActivityOverlay` from the SSE activity reducer.

## Remove obsolete request-response code

- [ ] Remove `DefaultChatTransport` and `chatTransport`.
- [ ] Remove group usage of `ChatSession` and AI SDK `UseChatHelpers`.
- [ ] Remove `GroupUIMessage` and `data-groupMessage` transcript projection
      after the room message model replaces them.
- [ ] Remove resume logic that assumes one active assistant response.
- [ ] Preserve artifact URL rendering only if group participants still publish
      artifacts.

## Tests

- [ ] State hydration followed by SSE connection cannot lose an event emitted
      between the two requests.
- [ ] Reconnection after a cursor replays each missed event once.
- [ ] Posting while agents work renders the human message immediately.
- [ ] A fast agent reply renders before a slow agent finishes.
- [ ] The composer accepts another message while activity is live.
- [ ] Switching rooms disconnects the old stream and clears old activity.
- [ ] Visually verify desktop layout, scrolling, reconnect, and intervention.

## Acceptance criteria

- [ ] The group screen no longer imports `useChat` or `ChatTransport`.
- [ ] The page behaves as one room connection, not one response stream per
      human message.
- [ ] Human and agent messages share one ordered public transcript.
