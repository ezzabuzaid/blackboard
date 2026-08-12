# Ideal Customer Profile

## Company

- B2B SaaS
- 50–200 employees
- Series A or B
- Has meaningful operational data across databases and spreadsheets
- Has recurring questions that currently require technical help
- May have Looker or Metabase, but still cannot answer ad-hoc questions quickly

## Buyer

An operations, analytics, or data-platform owner responsible for making company
data useful and trustworthy. They may be a solo technical operator or part of a
small data team.

Their motivation is to stop being the bottleneck for every data request and
recover time for process, tooling, and strategy work.

## Internal users

- Operations teams
- Product and support teams
- Managers and executives
- Technical users working directly with company data

They want to ask a question and get an insight, not learn SQL or another BI
interface.

## Pain and trigger events

- A board asks for metrics that cannot be produced quickly.
- Another urgent data request interrupts strategic work.
- The data owner realizes more time is spent pulling data than analyzing it.
- A recurring report should be automated.

## Objections and responses

- **Can it handle messy data?** Teach domain knowledge and business rules.
- **What if it writes bad SQL?** Use read-only access, query safety, auditability,
  and approval for sensitive actions.
- **We do not have a data platform team.** The desktop app combines data-source
  setup, agents, chat, dashboards, reports, and automations in one workspace.
- **We already have Metabase or Looker.** Limerence complements established BI
  by handling conversational ad-hoc questions and scheduled agent work.

## Anti-ICP

Do not target:

- enterprises above roughly 500 employees;
- banks, insurance, healthcare, government, telecom, or airlines;
- companies without structured databases;
- pre-seed startups without established data;
- organizations with a very large data team that will build internally.
