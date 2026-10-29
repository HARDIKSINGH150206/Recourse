# 10: Testing and quality gates

What "done" means for code in this repo. Commands are in `docs/DEVELOPMENT.md`; acceptance criteria AC1 to AC7 are in `PRD.md` section 10; security checks are in `docs/09` section 7.

## 1. Test pyramid

| Layer | Tool | What it proves | Where |
|---|---|---|---|
| Contract unit | forge | Every function, every revert, every custom error | `contracts/test/*.t.sol` |
| Contract fuzz | forge | Budget, cap and timing hold for arbitrary inputs | same |
| Contract invariants | forge | The eight invariants in `docs/09` section 4 | `contracts/test/invariant/` |
| Unit (TS) | vitest | Hashing, EIP-712, Merkle, rules R0-R8, schema parsing, mandate compile | `packages/*/test` |
| Cross-language vectors | forge + vitest | Same digests in Solidity and viem (spike S5) | `packages/shared/test/vectors.json` |
| Integration | vitest + anvil | Gateway to merchant to chain; dispute to resolve | `apps/*/test` |
| End-to-end | `pnpm demo` | Golden path scenes pass/fail, AC1 to AC7 | `scripts/demo.ts` |
| Benchmark | `bench/` | Accuracy, false-refund rate, injection resistance, AI lift | `bench/` |

## 2. Required tests by component

- **Contract:** each custom error in `docs/04` triggered by a test; happy path for register, create, release, dispute, resolve (refund and release, each fault), anchor; pause behaviour; reentrant token mock; nonce reuse; expiry boundary (equal and one second over); window boundary.
- **shared:** test vectors for entry hash, field leaf, batch root, tree head digest, receipt digest, mandate digest, verdict commitment; `verifyBundle` returns all-green on the vector and a specific red check for each single-byte mutation (entry field, disclosed value, salt, proof, tree-head signature, receipt body).
- **rules-engine:** one table-driven test file per rule, including boundary values (price equals cap, freshness exactly at limit, alias vs different entity), and R8 (evidence invalid) running first.
- **adjudicator:** schema failure handling, citation checker (missing cite, wrong entry type, non-existent seq), quorum (2-1, 1-1-1), injection fixtures (extractor flags `contains_instructions_to_reader`, verdict unchanged). Models are mocked in unit tests; real models only in bench and e2e.
- **gateway:** gapless `seq` under concurrent requests, batching boundaries (count and timer), flush on dispute, tamper of a stored byte detected, unknown merchant rejected, body size limit.
- **merchant-sdk:** 402 requirements shape, on-chain verification of `Held`, replay rejection, receipt signature recovers the merchant.
- **api:** dispute watcher idempotency (same event twice does not double-resolve), arbiter never resolves outside `Disputed`, error codes match `docs/04`.
- **dashboard:** component tests for mandate review and verify page; one Playwright smoke test for the tamper flow if time allows.

## 3. Quality gates (CI blocks merge unless all pass)

| Gate | Command | Threshold |
|---|---|---|
| Typecheck | `pnpm typecheck` | zero errors, strict mode |
| Lint and format | `pnpm lint` | zero errors |
| TS unit and integration | `pnpm test` | all pass |
| Contracts | `pnpm test:contracts` | all pass; invariants at least 256 runs; fuzz at least 1000 runs |
| Coverage | `pnpm test -- --coverage`, `forge coverage` | `packages/shared`, `rules-engine`, `mandate` at least 90% lines; contracts at least 95% lines and 90% branches |
| Static analysis | `slither contracts/` | no unexplained high or medium |
| Dependency audit | `pnpm audit --prod` | no high or critical |
| Secret scan | gitleaks or equivalent | none found |

Gates are decided once and listed in `.github/workflows/ci.yml`; changing a threshold needs an entry in `docs/DECISIONS.md`.

## 4. Determinism and flakiness rules

- Tests never call the public internet or a live model unless named `*.live.test.ts` (excluded from default CI).
- Time is injected (a clock interface); chain time uses `vm.warp` or anvil `evm_increaseTime`.
- Randomness (salts, uuids) is injected or seeded in tests; vectors use fixed keys.
- A flaky test is a bug: fix or delete it within the day; never retry-loop it in CI.
- The golden path (`pnpm demo`) must pass three runs in a row before freeze (`docs/07` M6).

## 5. Benchmark quality rules

Defined in `docs/08` section 5. In short: ground truth is set by construction; configurations A1, A2, B, C are run on the same cases; report counts with rates; show the confidence interval for headline rates (Wilson interval) and the number of cases; keep raw outputs in `bench/results/`; never edit results by hand; say so if AI lift is weak.

## 6. Code review checklist

- [ ] Does it match `docs/03` and `docs/04` exactly (names, field order, encodings)?
- [ ] Any new untrusted input parsed with zod?
- [ ] Any raw merchant text reaching a judge prompt? (must be no)
- [ ] Any private key read outside the role's process? (must be no)
- [ ] Tests for the new revert paths or error codes?
- [ ] Docs updated in the same change (spec, `DECISIONS.md` if a decision changed)?
- [ ] Scope: is it in Must or Should (`PRD.md` section 4)?

## 7. Release and freeze

- Tag `v0.1-demo` when the definition of done in `docs/07` section 9 is met.
- After the freeze point (last 5% of build time) only bug fixes with a failing test first.
- Keep a recorded golden-path video and the `data/` snapshot as the fallback (`docs/05` section 5).
