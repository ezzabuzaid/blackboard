# Baseera

A collaborative AI workspace built with React Router, Hono, and AI SDK.

## Setup

```bash
cp .env.example .env
# Set BETTER_AUTH_SECRET in .env to a random value of at least 32 characters.
# For example: openssl rand -base64 32
npm install
npm run dev
```

Agents use an in-process virtual Bash sandbox with persistent workspaces under
`ZUKHRUF_DATA_DIR`; it does not require KVM or a container runtime. Open the web
app and choose **Continue with ChatGPT** to connect your subscription. Better
Auth stores the user session and encrypted OAuth tokens in `auth.sqlite` under
`ZUKHRUF_DATA_DIR`. Set `CHATGPT_MODEL` only to override the first model
available to that account.

## Checks

```bash
nx run api:typecheck
nx run web:typecheck
nx run ui:typecheck
nx run api:test
```
