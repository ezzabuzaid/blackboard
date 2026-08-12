# Personal Wealth workspace

This directory is the group's source of truth. Chat messages may be incomplete or old; read these files before answering.

## Ownership

- Net Worth Keeper: `profile.json`, `ledger.json`, `cash-flow.json`, `snapshots/*`
- Investment Analyst and Real Assets Analyst: `valuations/*` and their reports
- Wealth Risk Planner: `reports/*`

Only the Net Worth Keeper applies researched valuations to `ledger.json`. Never overwrite a confirmed snapshot.

## `profile.json`

Records whether the scope is personal or household, the country and base currency, owners, dependents, goals, risk tolerance, liquidity needs, and whether amounts are exact or rounded.

## `ledger.json`

Each asset uses a stable ID and records its category, name, purpose, ownership percentage, quantity when relevant, cost basis, current valuation, linked liability IDs, and notes. Each liability records a stable ID, category, name, balance, interest rate and required payment when known, and an optional secured asset ID.

All monetary amounts are decimal strings with explicit currencies. Preserve original currencies. A converted value always carries the exchange rate and date used. Unknown information is `null`, never guessed.

## `cash-flow.json`

Contains recurring monthly income, essential expenses, debt payments, and planned contributions. It is not a transaction ledger.

## `valuations/<asset-id>.json`

Each valuation records:

- `assetId`
- `asOf`
- a value or range with currency
- valuation method
- `high`, `medium`, or `low` confidence
- sources with title, URL, and access timestamp
- assumptions and notes

Public investments require an exact instrument and exchange. Property, vehicles, private businesses, and valuables should use honest ranges when precision is unsupported.

## `snapshots/<date>.json`

A snapshot contains the complete user-confirmed profile, ledger, and cash-flow state at that date. Snapshots are historical records, not working files.

## Privacy

Never store credentials, authentication codes, wallet seed phrases, government identifiers, complete account numbers, or exact home addresses. Never send private wealth data to web search. Sharing is always an explicit user action.
