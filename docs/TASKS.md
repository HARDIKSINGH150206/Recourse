# TASKS

Task board per lane. We do not use GitHub issues (D-023). Rules: `GUIDE.md` section 5.
Status values: `TODO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`, `BLOCKED(<ID or person>)`, `CUT`.
Only the lane owner edits their table. To request work from another lane, add a row in their table prefixed `REQUEST(P<you>):`.

Last updated: 2026-10-29 (foundation commit on dev)

## M0 checkpoint (foundations, 10% of build time)
- [ ] Interfaces and `packages/shared` frozen
- [ ] Spikes S1 to S5 decided and recorded in `docs/DECISIONS.md`

## P1: Backend and Blockchain
| ID | Task | Req / spec | Status | Branch | Notes / handoff |
|---|---|---|---|---|---|
| P1-01 | Spike S1 escrow path on Base Sepolia | docs/07 s2 | TODO | | |
| P1-02 | Spike S5 mandate digest matches in Solidity and viem | docs/03 s2, s13 | TODO | | |
| P1-03 | shared: hash, eip712, merkle, commit, bundle, vectors | docs/03 | DONE | dev | Foundation commit. Schemas for verdict/rules/facts are first drafts for P2 to refine |
| P1-04 | RecourseEscrow: registerMandate, createEscrow | E1, docs/04 s1 | IN_REVIEW | dev | Written but NOT compiled yet (no Foundry on build machine). Run `pnpm contracts:install && pnpm test:contracts` |
| P1-05 | RecourseEscrow: release, dispute, resolve, anchorRoot, pause | E2 to E5 | IN_REVIEW | dev | Same as P1-04; refund does not restore `spent` (decide, log in DECISIONS) |
| P1-06 | Contract unit, fuzz and invariant tests | docs/09 s4, docs/10 | IN_REVIEW | dev | Unit, fuzz, invariant tests written, never executed |
| P1-07 | packages/chain with fake chain | docs/04 s5 | TODO | | |
| P1-08 | Gateway DB schema (Drizzle) and migrations | GUIDE s6 | TODO | | |
| P1-09 | Gateway proxy, entries, batching, tree heads, anchoring | G1 to G3 | TODO | | |
| P1-10 | Merchant SDK (402, receipts) | S1, P1 to P3 | TODO | | |
| P1-11 | API server: mandates, disputes, dispute watcher, arbiter service | docs/04 s3 | TODO | | |

## P2: AI
| ID | Task | Req / spec | Status | Branch | Notes / handoff |
|---|---|---|---|---|---|
| P2-01 | Spike S3 model test (Ollama, 20 cases) | docs/07 s2 | TODO | | |
| P2-02 | packages/llm with stub | docs/04 s5 | TODO | | |
| P2-03 | Rules engine R0 to R8 with tests | A1, docs/08 s3 | TODO | | |
| P2-04 | Extractor and judge, prompts v1 | A2, A3, docs/08 s4 | TODO | | |
| P2-05 | Citation check, quorum, verdict commitment inputs | A4 to A6 | TODO | | |
| P2-06 | Mandate compiler and plain-English summary | M1, M2 | TODO | | |
| P2-07 | Benchmark generator, runner, report | B1, B2, docs/08 s5 | TODO | | |

## P3: Frontend and Research
| ID | Task | Req / spec | Status | Branch | Notes / handoff |
|---|---|---|---|---|---|
| P3-01 | Spike S4 scaffold, CI, CODEOWNERS, PR template | docs/07 s2, docs/10 s3 | IN_REVIEW | dev | Scaffold, CI workflow, shared package done; CODEOWNERS handles still placeholders |
| P3-02 | Demo merchant with failure modes | docs/04 s4 | TODO | | |
| P3-03 | Dashboard shell, wallet, API client, MSW mocks | docs/06 | TODO | | |
| P3-04 | Mandate and Run pages | M1, M2, D1 | TODO | | |
| P3-05 | Verdict, Bench and Reputation pages | D1, D3 | TODO | | |
| P3-06 | Verify page with tamper test | G4, D2 | TODO | | |
| P3-07 | Demo agent and `pnpm demo` script | docs/05, docs/06 | TODO | | |
| P3-08 | Validation sprint log and interview notes (outside repo if personal data) | docs/07 s7 | TODO | | |
| P3-09 | Pitch deck and rehearsal answers | docs/05 s8 | TODO | | |
