# Baseera

A collaborative AI workspace built with React Router, Hono, and AI SDK.

## Setup

```bash
cp .env.example apps/api/.env
# Set OPENROUTER_API_KEY and BETTER_AUTH_SECRET in apps/api/.env.
# BETTER_AUTH_SECRET must be a random value of at least 32 characters.
# For example: openssl rand -base64 32
npm install
nx run-many -t portless -p web api
```

Open `https://frontend.baseera.localhost`. Run `portless trust` once first if
the local HTTPS certificate is not installed yet.

Agents use an in-process virtual Bash sandbox with persistent workspaces under
`ZUKHRUF_DATA_DIR`; it does not require KVM or a container runtime. Open the web
app and create a passkey with only your name. Returning users sign in with their
device passkey and no form fields. Better Auth stores users, passkeys, and
sessions in `auth.sqlite` under `ZUKHRUF_DATA_DIR`. Agent requests use the
server's `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`
(`openai/gpt-5.6-luna` by default). Voice input uses the same key and
`OPENROUTER_TRANSCRIPTION_MODEL` (`openai/gpt-4o-mini-transcribe` by default).

## Agents

Every chat includes a built-in **Factory** agent. Factory remains silent until
the human starts a request with `Factory` or `@Factory`; immediate human replies
to Factory continue that request. For example:

```text
Factory, create a customer researcher named Maya.
```

Factory creates and updates the same file-based agent definitions that can be
edited directly:

```text
$ZUKHRUF_DATA_DIR/agents/<agent>/
├── identity.json
├── SOUL.md
├── AGENTS.md
└── MEMORY.md
```

`identity.json` contains the host-visible identity:

```json
{
  "name": "Maya"
}
```

Agent identities are loaded when a new chat is created. At the start of each
turn, an agent discovers and reads its own `SOUL.md` for persona and voice,
`AGENTS.md` for operating instructions, and `MEMORY.md` for durable knowledge.
The shared agent directory is read-only inside chat sandboxes. Ordinary agents
can update only their own `MEMORY.md` through a scoped tool; Factory alone can
create or replace `identity.json`, `SOUL.md`, and `AGENTS.md`. Factory preserves
an existing `MEMORY.md` unless the human asks to replace it. Updates are visible
on the agent's next turn, while newly created agents join new chats. The host
does not read or inject the Markdown workspace files, and a missing or invalid
`identity.json` is rejected as invalid configuration.

## Checks

```bash
nx run api:typecheck
nx run web:typecheck
nx run ui:typecheck
nx run api:test
```
