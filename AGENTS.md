# Agent instructions

## Verification

- Run `nx run <projectName>:typecheck` for type checks.
- Run `nx run <projectName>:test` for tests; the target builds first and uses
  Node's test runner.

## Development logs

Start both development services from the repository root:

```sh
npm run dev
```

Before starting another server, check whether ports 3001 and 5173 are already
listening. Vite forwards browser warnings and errors to its live terminal; they
are not persisted after that process exits.

Structured API request events are local NDJSON files under
`apps/api/.evlog/logs/*.jsonl`. Evlog retains at most five 10 MB files. Treat
these files as sensitive even though built-in PII redaction is enabled.

Structured agent events are separate product data recursively under
`apps/api/.data/zukhruf/group-telemetry`. These files may contain user prompts
and model output; inspect only what is needed and do not copy secrets into
reports.
