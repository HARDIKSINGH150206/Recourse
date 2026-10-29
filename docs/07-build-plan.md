# 07: Build plan

Sequencing, spikes, milestones, per-workstream checklists, cut order and the parallel validation sprint. Scope is locked by `PRD.md` section 4 (Must, Should, slides-only). Event length and checkpoints are not yet known (open decision O-5), so milestones are given as **fractions of the available build time**; convert once the schedule is confirmed.

## 1. Workstreams and owners

| Id | Workstream | Packages and apps | Owner |
|---|---|---|---|
| A | Contracts and chain | `contracts/`, `packages/chain` | P1 |
| B | Evidence: gateway, merchant SDK, shared crypto, API server | `apps/gateway`, `packages/merchant-sdk`, `packages/shared`, `apps/api` | P1 |
| C | Adjudication: rules, LLM, mandate compiler, benchmark | `packages/rules-engine`, `llm`, `adjudicator`, `mandate`, `bench/` | P2 |
| D | Experience: dashboard, demo agent, demo merchant, scaffold and CI, pitch, research | `apps/dashboard`, `apps/demo-agent`, `apps/demo-merchant` | P3 |

Lanes P1, P2, P3 and the working rules are in `GUIDE.md`. `packages/shared` is on the critical path for everyone: build it first (schemas, hashing, EIP-712 types, merkle, bundle verification) and freeze it early.

## 2. Day-0 spikes (before anything else; each has a pass/fail)

| Spike | Question | Pass | If it fails |
|---|---|---|---|
| **S1 Escrow payment path** | Can an agent key call `createEscrow` on Base Sepolia (testnet USDC pulled from the owner's allowance) and can a merchant verify `Held` via a view call? Can the official x402 facilitator carry the scheme? (optional) | A script performs approve, registerMandate, createEscrow, release on Base Sepolia end to end | Use local anvil for everything and say "testnet deployment pending"; keep the contract code unchanged |
| **S2 Faucets and tokens** | Testnet ETH for four keys and testnet USDC for the owner available in time? | Balances confirmed | `MockUSDC` on anvil |
| **S3 Model test** | Which Ollama models return reliable structured JSON on the extractor and judge prompts, at acceptable speed on the target machine? | 20 hand-made cases parse and judge sensibly; per-call latency measured | Use smaller or fewer models; judges = 1; precompute benchmark |
| **S4 Scaffold** | Monorepo builds, CI runs, forge and vitest green on an empty test | `pnpm install && pnpm typecheck && pnpm test && pnpm test:contracts` pass | Fix before writing features |
| **S5 Cross-language digests** | Does the viem-computed mandate digest equal the Solidity `_hashTypedDataV4` result? | Test vector passes in both | Fix domain or struct encoding before anything depends on it |

Record spike results in `docs/DECISIONS.md` (open decisions O-2, O-7).

## 3. Milestones (fractions of build time)

| Milestone | By | Deliverable | Done when |
|---|---|---|---|
| **M0** Foundations | 10% | Repo scaffold, CI, `packages/shared` (schemas, hash, eip712, merkle, bundle, vectors), spikes S1 to S5 | S1 to S5 pass or fallbacks decided; shared tests green |
| **M1** Money path | 25% | `RecourseEscrow` with unit, fuzz and invariant tests; `packages/chain`; deploy and seed scripts | Contract tests green; script runs approve, register, create, release on target chain |
| **M2** Evidence path | 45% | Merchant SDK, demo merchant (modes), gateway proxy, log, batches, tree heads, anchoring, evidence bundle, `/log/batches` | A request via the gateway yields entries, a signed and anchored tree head and a bundle that `verifyBundle` accepts; one-byte edit fails |
| **M3** Judgement path | 65% | Rules engine, extractor and judge pipeline, citations, API with dispute watcher, `resolve` | Scenes 2 to 5 of the demo work end to end on the target chain: rules refund, AI refund with cited claim, injection refund, regret release |
| **M4** Experience | 80% | Dashboard (Mandate, Run, Verdict, Verify with tamper test), demo agent, reputation counters | Full golden path runs from the UI |
| **M5** Proof | 92% | Benchmark generator, runner, ablation, report, Bench page; Should-tier items as time allows (dual-LLM, quorum, verdict commitment) | Real numbers produced for A1, A2, B, C |
| **M6** Freeze and rehearse | 100% (last 5% reserved) | Bug fixes only; fallbacks tested; recording saved; pitch and slides | Golden path passes three times in a row; pre-flight checklist (docs/05 section 6) complete |

**Critical path:** M0 (shared) -> M1 (contract) -> M2 (gateway) -> M3 (adjudicator) -> M4 (UI) -> M6. Dashboard and demo agent scaffolding can start once M1 is partly done; benchmark generator can start once M2 produces bundles.

## 4. Checklists by workstream

### A. Contracts and chain
- [ ] Foundry project, OpenZeppelin deps, remappings, solhint config
- [ ] `IRecourseEscrow` as in `docs/04` section 1.1
- [ ] `RecourseEscrow`: registerMandate, createEscrow, release, dispute, resolve, anchorRoot, admin, views
- [ ] Unit tests for every revert and happy path; fuzz (budget, cap); invariants (balance, monotonic states)
- [ ] `MockUSDC`, `Deploy.s.sol`, `Seed.s.sol`, `scripts/sync-deployment.ts`
- [ ] `packages/chain`: ABI export, typed client, event watchers
- [ ] Cross-check: mandate digest vector matches viem (spike S5)

### B. Evidence
- [ ] `packages/shared`: `hash.ts`, `eip712.ts`, `merkle.ts`, `commit.ts`, `bundle.ts`, `schemas.ts`, vectors
- [ ] `packages/merchant-sdk`: 402 requirements, on-chain verification, receipt signing, replay protection
- [ ] `apps/demo-merchant`: honest and failure modes (docs/04 section 4)
- [ ] `apps/gateway`: proxy, entries, field commitments, blobs, batching, tree heads, anchoring, evidence and batch endpoints, flush
- [ ] Gateway tests: tamper one stored byte, `verifyBundle` fails; gap in seq detected

### C. Adjudication
- [ ] `packages/rules-engine`: R0 to R8 with unit tests per rule and the alias table
- [ ] `packages/llm`: Ollama client with structured output and retry
- [ ] `packages/adjudicator`: extractor, judge, citation check, quorum, commitment; prompts v1 versioned
- [ ] `packages/mandate`: compile, validate, template summary, typed data
- [ ] `apps/api`: mandates, dispute watcher, evidence client, arbiter service, reputation reads, bench endpoints
- [ ] `bench/`: generator for 200 cases (docs/08 section 5), runner for A1, A2, B, C, metrics, report

### D. Experience
- [ ] Dashboard scaffold, wagmi, API client
- [ ] Mandate, Run, Timeline, Verdict, Verify (editable), Bench, Reputation pages
- [ ] Demo agent service and CLI; six scenarios
- [ ] `pnpm demo` (headless golden path) and `pnpm demo:reset`
- [ ] Pitch deck, story slide (shoes), screen recording

## 5. Cut order if behind schedule

Cut from the top; never cut the items in the "protect" list.

1. 3-judge quorum (keep a single judge)
2. Field-level selective disclosure UI (keep the disclosure endpoint and tests only if cheap)
3. Benchmark size 200 -> 100 (keep all categories, 5 per category minimum)
4. Reputation page (keep on-chain counters; show in the dashboard header)
5. Dual-LLM extraction (keep a single extractor and the judge-only-sees-facts rule; do not feed raw text to the judge)
6. Merchant manifest, gateway-signature requirement, LLM planner mode for the agent

**Protect (never cut):** contract enforcement (AC1), automatic refund on-chain (AC7), rules-decided refund (AC2), at least one AI-decided refund with a cited entry (AC3), the injection scene or at minimum the "untrusted text only reaches the extractor" design (AC4), buyer regret release (AC5), the browser tamper test (AC6).

## 6. Risk triggers

| Trigger | Action |
|---|---|
| S1 not passing by the M0 checkpoint | Move to local anvil as the demo chain; log in DECISIONS |
| Model output unreliable (S3) | Smaller models, fewer judges, stricter schemas; keep the rules-only path as the safety net |
| M2 slips beyond 55% | Drop anchoring automation (manual flush plus anchor on dispute only) |
| M3 slips beyond 75% | Freeze Should tier; ship single judge; benchmark A1, A2, B only |
| Any new feature request | Apply the scope lock: it must replace something in Must |

## 7. Parallel validation sprint (14 days; moves the startup score more than the demo)

| Target | Goal |
|---|---|
| Outreach to agent builders, API sellers, wallet and agent-platform teams | 20 messages, 8 calls |
| Written quotes for the deck | 3 |
| Merchant pilots using the receipt SDK | 2 |
| Letters of intent | 1 |

Interview questions:
1. Has an agent ever bought the wrong thing for you? What happened?
2. How do you handle refunds or disputes today?
3. Who pays when it goes wrong?
4. Would you pay for protected spend, and how much?
5. What would stop you from using it?

Log every conversation (who, role, date, quote, objection) in a shared doc, not in this repo if it contains personal data.

## 8. Event-day schedule template (fill in once O-5 is known)

| Time | Activity |
|---|---|
| T0 | Repo ready, spikes done, roles assigned |
| T0 + 25% | M1 done |
| T0 + 45% | M2 done |
| T0 + 65% | M3 done |
| T0 + 80% | M4 done |
| T0 + 92% | M5 done |
| Last 5% | Freeze, rehearse three times, record backup video |

## 9. Definition of done for the build

- [ ] Acceptance criteria AC1 to AC7 pass three times consecutively on the target chain
- [ ] Benchmark results exist for A1, A2, B and C with counts and rates (docs/08 section 5.3)
- [ ] README has quickstart; `docs/DEVELOPMENT.md` commands verified on a clean machine
- [ ] Fallback stack (local anvil) tested end to end
- [ ] Pitch includes honest limits (docs/01 section 7) and the rehearsed answers (docs/05 section 8)
