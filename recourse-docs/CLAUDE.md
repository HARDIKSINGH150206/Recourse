# CLAUDE.md: Recourse

Read this file first. It is the entry point for Claude Code. Everything else is linked from here.

## What this project is

**Recourse** is a trust layer for AI agent payments (pay-per-call with a money-back guarantee). Built for **Hacker House Goa (AI × Web3)**. Testnet only.

1. A user signs a **mandate** (what the agent may buy). An **escrow contract** enforces it and holds each payment for a short dispute window.
2. An independent **gateway** (not the agent) records every step in a **tamper-evident** log; the merchant SDK adds **signed receipts**.
3. On dispute, an **adjudicator** decides: **rules decide every checkable fact; AI decides meaning only**, citing log entries.
4. The verdict triggers an automatic **on-chain refund or release** and updates **reputation**.

Scope: **digital goods and API calls** (demo: a weather-data API). Physical goods are story and roadmap only.

## Read order

| Order | File | Use it for |
|---|---|---|
| 0 | `GUIDE.md` | **Read first.** Your lane, module ownership, parallel workflow, git and PR rules, ORM and migrations, agent rules |
| 1 | `PRD.md` | Scope, requirements (M/E/P/S/G/A/D/B ids), tiers, acceptance criteria |
| 2 | `docs/ARCHITECTURE.md` | Components, **folder structure**, dataflow, DB schemas, ports |
| 3 | `docs/03-crypto-and-merkle-spec.md` | Exact hashing, signing, Merkle, receipts, bundle format. **Do not improvise formats.** |
| 4 | `docs/04-api-spec.md` | Contract interface, HTTP APIs, SDK, package interfaces |
| 5 | `docs/08-adjudicator-and-benchmark.md` | Rules table, AI pipeline, verdict schema, benchmark |
| 6 | `docs/05-demo-golden-path.md` | The 3-minute demo, scenes, fallbacks |
| 7 | `docs/06-frontend-agent-plan.md` | Dashboard pages, verify page, scripted agent |
| 8 | `docs/07-build-plan.md` | Day-0 spikes, milestones, checklists, cut order |
| 9 | `docs/DECISIONS.md` | Why things are the way they are; log new decisions here |
| 10 | `docs/DEVELOPMENT.md` | Setup, exact commands, env vars, testing, git rules |
| 11 | `docs/09-security-and-threat-model.md` | Threats, contract invariants, key roles, privacy. Read before touching contracts, keys, gateway or prompts |
| 12 | `docs/10-testing-and-quality.md` | Required tests, CI gates, review checklist |
| 13 | `docs/01-problem-and-novelty.md` | Pitch context, competitors, honest limits |

(There is no `02`: dataflow lives in `ARCHITECTURE.md`.)

## Commands (full list in docs/DEVELOPMENT.md)

```bash
pnpm install
cp .env.example .env
pnpm chain:up          # local anvil
pnpm chain:deploy      # deploy escrow + mock USDC, writes deployments/<chainId>.json
pnpm dev               # gateway, api, demo-merchant, demo-agent, dashboard
pnpm test              # TypeScript tests (vitest)
pnpm test:contracts    # forge test
pnpm bench             # run benchmark
pnpm typecheck && pnpm lint
```

## Non-negotiable rules

1. **Scope lock.** Build only Must and Should items in `PRD.md` section 4. "Slides only" items are never built. Adding to Must requires removing something from Must and logging it in `docs/DECISIONS.md`.
2. **Rules first, AI second.** Anything checkable in code (price, merchant, expiry, schema, timestamps, receipt signatures, entity match) is decided by code. AI decides meaning only.
3. **Untrusted text never reaches the judge raw.** Merchant response bodies and the owner's dispute reason go only to the **extractor** model, which outputs structured facts. The judge sees mandate terms, rule results and extractor facts. Never concatenate untrusted text into a judge prompt.
4. **Citation-or-abstain.** Every verdict claim cites log entry `seq` numbers; code verifies the cites exist. Otherwise the verdict becomes `needs_human_review`.
5. **Formats are fixed by the spec.** keccak256 over RFC 8785 canonical JSON; EIP-712 for mandate, tree heads and receipts; OpenZeppelin `StandardMerkleTree`. See `docs/03`. If the spec must change, change the spec and `DECISIONS.md` in the same commit.
6. **Say "tamper-evident", never "tamper-proof"**, in code comments, UI copy and docs.
7. **Testnet only.** No real funds or keys. Secrets live only in `.env` (gitignored). Never commit keys.
8. **Validate at every boundary** with zod. Shared types and schemas live in `packages/shared`; never duplicate them.
9. **Determinism.** Model calls use temperature 0 and a fixed seed; prompts are versioned files in `packages/adjudicator/prompts/`; the verdict commitment includes the prompt hash and model versions.
10. **Contract discipline.** Custom errors, pull payments, `ReentrancyGuard`, `Pausable`, checks-effects-interactions. Every contract change needs forge unit tests plus fuzz or invariant tests, and an update to the interface in `docs/04`.
11. **Git.** Work on your own feature branch cut from `dev`; commit often and push it (standing permission); open PRs **into `dev`**; never merge or approve PRs, never push to or touch `dev` or `main`, never plain force-push. Work only inside the lane and modules you were assigned (`GUIDE.md` sections 2 and 7.4).
12. **Keep docs current.** If code diverges from a doc, fix the doc in the same change.
13. **Database changes** go through the Drizzle schema and generated migrations only (`GUIDE.md` section 6). Never edit a merged migration or a database file by hand.
14. **Tracking.** There are no GitHub issues; update your row in `docs/TASKS.md` at the end of every session.

## Conventions

- TypeScript `strict`, ES modules, Node current LTS, pnpm workspaces. Small pure functions; no circular package dependencies (rules in `docs/ARCHITECTURE.md`).
- Addresses checksummed in code; bytes32 as lowercase `0x` hex; timestamps are unix seconds (uint64).
- Money: token units as bigint in code, decimal strings in JSON (USDC has 6 decimals).
- Errors from APIs use `{ "error": { "code", "message", "details?" } }`.
- Logging with pino; never log private keys or raw evidence bodies at info level.
- Names: packages `@recourse/<name>`; branches `feat/<area>-<topic>`; commits in imperative mood.

## Definition of done for any task

- Code matches the relevant spec section (cite it in the PR or commit message).
- Tests added or updated and passing (`pnpm test`, `pnpm test:contracts` as relevant).
- `pnpm typecheck` and `pnpm lint` clean.
- Docs updated if behaviour or interfaces changed.
- Demo acceptance criteria AC1 to AC7 (PRD section 10) still pass.

## When unsure

Check `docs/DECISIONS.md` and the PRD open questions. If still unclear, choose the simplest option that keeps the demo path working and note the assumption in `DECISIONS.md` under "Open decisions".
