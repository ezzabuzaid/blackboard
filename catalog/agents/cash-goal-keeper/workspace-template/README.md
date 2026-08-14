# The 1M Committee workspace

This directory is the group's source of truth. Chat messages may be incomplete or old; read these files before answering.

## Ownership

- Cash Goal Keeper: `goal.json`, `position.json`, `plan.json`, `commitments.json`, `checkpoints/*`, and appends to `decisions.md`
- Every other agent: argue, attack, and propose. None of them write here.

Only the Cash Goal Keeper records a decision, and it records the objections alongside it. Never edit or remove an entry in `decisions.md`.

## `goal.json`

The target amount with its currency, the deadline, the starting cash balance with the date it was measured, the required monthly rate derived from those, and the review cadence. `counts` is `cash-only` and does not change: the target is measured in cash, never in total wealth.

The file is incomplete until it carries an amount, a currency, a deadline, and a dated starting balance. Nothing else in this workspace is meaningful while it is incomplete.

## `position.json`

Two separate lists that are never summed together.

`cash` holds money spendable this week without selling anything — current accounts, savings, and settled balances. Only these move the gap.

`nonCash` holds property, private equity, vehicles, businesses, retirement accounts, receivables, and anything else owned. It is tracked so the picture is honest and never counted toward the target. A holding moves from `nonCash` to `cash` only after the human confirms a completed sale or withdrawal, recording the net amount received and the date it landed.

`liabilities` records debts with their balance, rate, and required payment. Debt is never netted against cash to flatter the gap.

All amounts are decimal strings with explicit currencies. Preserve original currencies. A converted value always carries the exchange rate and date used. Unknown information is `null`, never guessed.

## `plan.json`

Each track records a stable ID, what it is, the type of cash it produces, the expected contribution and over what period, the assumptions it depends on, the conditions that would kill it, and its status.

A track is written only after the group has attacked it and the human has chosen what survives.

## `commitments.json`

Each item records a stable ID, what the human committed to, the due date, how it will be verified, its status, and when it was created and closed. A commitment without a date and a verification method does not belong here.

## `decisions.md`

Append-only. Each entry records the date, what was decided, every objection with the name of the agent who raised it, and the condition that would reverse the decision. The dissent is part of the record, not a footnote.

## `checkpoints/<date>.json`

A checkpoint records confirmed cash at that date, the remaining gap, the restated required monthly rate, and which commitments were kept, missed, or dropped. Checkpoints are historical records, not working files.

## Privacy

Never store credentials, authentication codes, wallet seed phrases, government identifiers, complete account numbers, or exact home addresses. Never send private financial data to web search. Sharing is always an explicit user action.
