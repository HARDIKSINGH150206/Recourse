# Recourse

**Pay-per-call with a money-back guarantee for AI agents.**

Recourse is a trust layer for AI-agent payments, built for Hacker House Goa (AI x Web3). A signed mandate sets what an agent may buy. An escrow contract enforces it and holds each payment for a dispute window. An independent gateway records every step in a tamper-evident log. An adjudicator (rules first, AI only for meaning, with cited evidence) rules on disputes, and the verdict triggers an automatic on-chain refund or release and a reputation update.

> Status: testnet prototype, not built yet. Not audited. Not legal or financial advice. Tamper-evident, not tamper-proof.

## How it works

```
Owner signs mandate (EIP-712) -> Escrow contract enforces cap, budget, allowlist, expiry
Agent -> Gateway (records) -> Merchant (402 flow, signed receipt)
Dispute -> Rules engine -> Extractor -> Judge(s) -> Citation check -> resolve() on-chain
```

See `docs/ARCHITECTURE.md` for diagrams.

## Quickstart

Prerequisites: Node LTS, pnpm, Foundry, Ollama.

```bash
pnpm install
cp .env.example .env
pnpm chain:up        # local anvil
pnpm chain:deploy
pnpm seed
pnpm dev             # gateway, api, demo-merchant, demo-agent, dashboard
pnpm demo            # runs the golden path headlessly and prints pass/fail
```

Full setup, Base Sepolia instructions and troubleshooting: `docs/DEVELOPMENT.md`.

## Repository layout

| Path | Contents |
|---|---|
| `contracts/` | Solidity (Foundry): `RecourseEscrow`, mocks, scripts |
| `apps/` | `gateway`, `api`, `demo-merchant`, `demo-agent`, `dashboard` |
| `packages/` | `shared`, `chain`, `merchant-sdk`, `rules-engine`, `llm`, `mandate`, `adjudicator` |
| `bench/` | Benchmark generator, runner, results |
| `docs/` | Specs and plans (below) |

## Documentation map

| Doc | Purpose |
|---|---|
| `GUIDE.md` | Team workflow, module ownership, git/PR rules, ORM and migrations; give to every AI agent |
| `CLAUDE.md` | Entry point and rules for Claude Code |
| `docs/TASKS.md` | Task board per lane (we do not use GitHub issues) |
| `PRD.md` | Scope, requirements, acceptance criteria |
| `docs/01-problem-and-novelty.md` | Problem, competitors, novelty, honest limits |
| `docs/ARCHITECTURE.md` | System design, folder structure, schemas |
| `docs/03-crypto-and-merkle-spec.md` | Exact hashing, signing, log, Merkle, bundles |
| `docs/04-api-spec.md` | Contract and HTTP interfaces (authoritative) |
| `docs/05-demo-golden-path.md` | The 3-minute demo script and fallbacks |
| `docs/06-frontend-agent-plan.md` | Dashboard and demo agent |
| `docs/07-build-plan.md` | Milestones, spikes, cut order |
| `docs/08-adjudicator-and-benchmark.md` | Rules, prompts, verdicts, benchmark |
| `docs/09-security-and-threat-model.md` | Threats, invariants, keys, privacy |
| `docs/10-testing-and-quality.md` | Tests, CI gates, review checklist |
| `docs/DECISIONS.md` | Decision log and open questions |
| `docs/DEVELOPMENT.md` | Setup, commands, env, git rules |

**Precedence when documents disagree:** `docs/03` and `docs/04` for formats and interfaces; `PRD.md` for scope; `docs/DECISIONS.md` for the latest decisions.

## Honest limits

- The log proves captured data was not altered after anchoring; it does not prove the agent was right or that nothing bypassed the gateway.
- The arbiter is a single key in the MVP; each verdict carries an on-chain commitment.
- There is no refund after release and no arbiter timeout in the MVP.
- Testnet only.

## Team

Team Return0 / The Big O. Roles: see `docs/07-build-plan.md` section 1 (to be assigned).
