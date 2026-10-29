# TASKS

Task board per lane. We do not use GitHub issues (D-023). Rules: `GUIDE.md` section 5.
Status values: `TODO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`, `BLOCKED(<ID or person>)`, `CUT`.
Only the lane owner edits their table. To request work from another lane, add a row in their table prefixed `REQUEST(P<you>):`.

Last updated: 2026-10-29 (HS: foundation, hardening, lane split)

## Who does what (from 2026-10-29)

| Person | GitHub | Lanes | Start with |
|---|---|---|---|
| Hardik Singh | `HARDIKSINGH150206` | P1 Backend and Blockchain, P3 Frontend and Research | P1-08 gateway DB, P1-09 gateway proxy and log, P1-10 merchant SDK, then P1-11 API; P3 follows once the gateway serves evidence |
| Ayush Pundhir | `ayush983215` | P2 AI (all of it) | P2-02 `packages/llm` with a stub, P2-03 rules engine R0 to R8, then P2-04 extractor and judge, P2-06 mandate compiler, P2-07 benchmark |

Rules for two people:
- Each person opens PRs into `dev` and the other reviews. Nobody merges their own PR unreviewed once the first services land.
- Ayush needs no chain or services to start: build against `packages/shared` (schemas, `verifyBundle`, `packages/shared/test/vectors.json`) and the fake `FakeEscrow` in `packages/chain`.
- Handoff contracts between you: the evidence bundle (`docs/03` s8) from Hardik to Ayush, and `adjudicate()` / `compileMandate()` (`docs/04` s7) from Ayush to Hardik's API. Change them only via the interface-change process in `GUIDE.md` s4.2.
- Draft AI schemas in `packages/shared/src/schemas/{verdict,rules,facts}.ts` are Ayush's to refine (D-024).
- Tanmay (`TANTHETA7`) is a collaborator with no assigned work for now.
- Hardik carries two lanes, so if time runs short use the cut order in `docs/07` and push P3 polish (pitch, extra dashboard pages) last.

## M0 checkpoint (foundations, 10% of build time)
- [ ] Interfaces and `packages/shared` frozen
- [ ] Spikes S1 to S5 decided and recorded in `docs/DECISIONS.md`

## P1: Backend and Blockchain
| ID | Task | Req / spec | Status | Branch | Notes / handoff |
|---|---|---|---|---|---|
| P1-01 | Spike S1 escrow path on Base Sepolia | docs/07 s2 | TODO | | |
| P1-02 | Spike S5 mandate digest matches in Solidity and viem | docs/03 s2, s13 | DONE | dev | Verified live on anvil: viem digest == contract mandateId (packages/chain live test) |
| P1-03 | shared: hash, eip712, merkle, commit, bundle, vectors | docs/03 | DONE | dev | Foundation commit. Schemas for verdict/rules/facts are first drafts for P2 to refine |
| P1-04 | RecourseEscrow: registerMandate, createEscrow | E1, docs/04 s1 | IN_REVIEW | dev | Compiles; 37 forge tests pass (unit, fuzz, invariant); live-tested from viem |
| P1-05 | RecourseEscrow: release, dispute, resolve, anchorRoot, pause | E2 to E5 | IN_REVIEW | dev | Passing. Open decision: refund does not restore `spent` (log in DECISIONS) |
| P1-06 | Contract unit, fuzz and invariant tests | docs/09 s4, docs/10 | IN_REVIEW | dev | 31 unit, 5 fuzz, 3 invariants passing |
| P1-07 | packages/chain with fake chain | docs/04 s5 | IN_REVIEW | dev | ABI, client, FakeEscrow done; real client verified against anvil (`pnpm --filter @recourse/chain test:live`) |
| P1-08 | Gateway DB schema (Drizzle) and migrations | GUIDE s6 | IN_REVIEW | p1/feat-gateway-store-proxy | Drizzle schema + 2 migrations (init, append-only triggers). `entries` has no `batch_index` (derived from batch ranges) so the table is truly append-only |
| P1-09 | Gateway proxy, entries, batching, tree heads, anchoring | G1 to G3 | IN_REVIEW | p1/feat-gateway-store-proxy | Proxy, log, batching, signed heads, anchoring, evidence bundle, disclosure, decision and dev tamper routes. Smoke-tested on anvil |
| P1-10 | Merchant SDK (402, receipts) | S1, P1 to P3 | DONE | p1/feat-merchant-sdk | `protect()` middleware, receipts, replay store. `requireGatewaySignature` (Should tier) not built. Verified end to end with the gateway |
| P1-11 | API server: mandates, disputes, dispute watcher, arbiter service | docs/04 s3 | DONE | p1/feat-api-server | Verified live on anvil with real gateway + SDK merchant. Adjudicator and mandate compiler are stubs until P2 lands (see apps/api/src/index.ts TODO(P2)) |

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
| P3-02 | Demo merchant with failure modes | docs/04 s4 | DONE | p3/feat-demo-merchant-agent | All 11 modes; X-Demo-Mode per request |
| P3-03 | Dashboard shell, wallet, API client, MSW mocks | docs/06 | IN REVIEW | Hardik | Vite+React+Query+viem (no wagmi, no MSW: runs against the real services) |
| P3-04 | Mandate and Run pages | M1, M2, D1 | IN REVIEW | Hardik | Compile returns 501 until P2 lands the compiler |
| P3-05 | Verdict, Bench and Reputation pages | D1, D3 | TODO | | |
| P3-06 | Verify page with tamper test | G4, D2 | TODO | | |
| P3-07 | Demo agent and `pnpm demo` script | docs/05, docs/06 | DONE | p3/feat-demo-merchant-agent | `pnpm demo` verified live: all 9 scenes PASS with a real adjudicator; scenes 2 to 5 and 7 report PENDING until P2 lands |
| P3-08 | Validation sprint log and interview notes (outside repo if personal data) | docs/07 s7 | TODO | | |
| P3-09 | Pitch deck and rehearsal answers | docs/05 s8 | TODO | | |
