# Personal Wealth platform gaps

This file records capabilities the Personal Wealth template cannot provide reliably with the platform available today. These are platform boundaries, not postponed product versions.

## Available today

- A prebuilt Personal Wealth group with four native agents.
- One durable writable filesystem shared by every agent in the group.
- A canonical profile, ledger, recurring cash-flow record, sourced valuation files, confirmed snapshots, and reports under `/workspace/wealth`.
- Generic web research with agent instructions that keep private financial facts out of search queries.
- User-controlled conversation sharing. Groups are private by default; a user may deliberately create and later revoke a read-only public link.
- Clear chat, which deletes the transcript and group sandbox files while leaving the empty group available.

## Not supported by the current platform

### Structured market prices and exchange rates

Participants have generic web search, not a structured quote or foreign-exchange feed. The agents can record sourced and timestamped research, but they cannot guarantee live prices, market-close consistency, corporate-action adjustments, or one authoritative FX rate. Backlog item `#921` tracks this capability.

### Bank, brokerage, loan, and registry connections

There is no consented connection that imports balances, positions, transactions, mortgages, vehicle finance, or property records. Users must provide the facts they want recorded. Agents must never request sign-in credentials as a substitute.

### Secure statement and document ingestion

The chat composer does not currently provide a secure document-upload and extraction path for brokerage statements, bank statements, deeds, valuations, or loan documents. The filesystem can retain agent-created files, but that is not the same as a user upload flow with validation, malware handling, provenance, and deletion controls.

### Deterministic financial validation

The shared filesystem stores the wealth model, but the platform has no deterministic wealth-domain tool that validates decimal arithmetic, currency conversion, unique IDs, asset-liability links, snapshot consistency, or totals. Agent instructions reduce mistakes; they do not provide an accounting-grade correctness boundary.

### Reliable property, vehicle, and private-business valuation data

There is no regional appraisal, comparable-sale, vehicle-condition, lien, or private-company data provider. These assets must use user-provided values, public evidence, or clearly labeled ranges. The agents cannot replace a qualified appraisal.

### Jurisdiction-specific professional conclusions

The platform has no maintained country-specific authority for tax, inheritance, marital ownership, pensions, insurance suitability, securities regulation, or estate law. The agents can identify questions and organize facts, but must route conclusions to qualified professionals.

### Permanent group deletion (closed)

The product now provides one owner-scoped permanent-delete lifecycle for the group record, active and queued work, transcript, participant group context and mailboxes, sandbox and artifacts, and every current or historical share token. Published marketplace templates survive detached; unpublished linked drafts are removed. Account-scoped participant data, agent telemetry, and bounded operational request logs are intentionally retained and disclosed in the confirmation.

### Automatic workspace seeding at group creation

Group templates currently select a name and participant roster; they cannot seed group files during creation. The Net Worth Keeper therefore initializes `/workspace/wealth` on the first relevant turn by copying the read-only seed files bundled with its catalog definition.
