# DeepAgents Starter

A React Router data-mode SPA backed by a Hono API and the locally linked
experimental Zukhruf runtime. The frontend uses AI SDK React's `useChat`, while
Hono streams durable Zukhruf turns in the AI SDK UI-message format. Shared
components live in `packages/ui`, with the complete shadcn component registry
installed.

## Setup

```bash
cp .env.example .env
npm install
cd /Users/ezzabuzaid/Desktop/January/deepagents/packages/context
npm link
cd ../experimental
npm link
cd /Users/ezzabuzaid/Desktop/experiments/self-delegate
npm link @deepagents/context @deepagents/experimental --workspace api --save=false
npm run sandbox-image --workspace api
npm run dev
```

The sandbox image command loads Chromium, `agent-browser`, and its
version-matched skills into Microsandbox's local OCI cache. On the first
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
