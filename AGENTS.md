# Agent instructions

## Verification

- Run `nx run <projectName>:typecheck` for type checks.
- Run `nx run <projectName>:test` for tests; the target builds first and uses
  Node's test runner.

## Development logs

Start both development services from the repository root with this Bash or Zsh
command. The transcript is truncated on every start.

```sh
mkdir -p .data
set -o pipefail
npm run dev 2>&1 | tee .data/dev.log
```

Before starting another server, inspect `.data/dev.log` and check whether the
expected ports are already listening. The transcript contains startup, build,
API console output, and browser warnings or errors forwarded by Vite.

Structured agent events are separate product data under
`apps/api/.data/zukhruf/group-telemetry/*.jsonl`. These files may contain user
prompts and model output; inspect only what is needed and do not copy secrets
into reports.
