# Baseera

A collaborative AI workspace built with React Router, Hono, and AI SDK.

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

Agents use an in-process virtual Bash sandbox with persistent workspaces under
`ZUKHRUF_DATA_DIR`; it does not require KVM or a container runtime. On the first
`npm run dev`, open the URL printed by the API and enter its device code to
connect your ChatGPT subscription. Credentials are saved with owner-only
permissions under `ZUKHRUF_DATA_DIR`; set `CHATGPT_MODEL` only to override the
first model available to that account.

## Checks

```bash
nx run api:typecheck
nx run web:typecheck
nx run ui:typecheck
nx run api:test
```
