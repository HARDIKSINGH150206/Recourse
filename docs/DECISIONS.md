# DECISIONS

Dated decision log (lightweight ADRs). Newest decisions go at the bottom of the list. Add an entry whenever a spec or a scope rule changes. Format: ID, date, decision, context, alternatives, consequences.

All entries below: **29 Oct 2026**, decided by the team during ideation unless noted.

## Decisions

### D-001: Digital goods and API calls first
- **Decision:** The MVP targets digital goods and API calls (demo: weather-data API). Shoes and other physical goods are story and roadmap only.
- **Context:** Delivery of a digital response is machine-verifiable; nobody can verify what a courier delivered.
- **Alternatives:** physical goods with simulated merchants (rejected: the "how do you know the wrong size arrived?" question has no answer).
- **Consequences:** variant logic for physical goods (three-zone mandate, colour and size) stays in the roadmap; the demo mandate uses category, price cap, budget, merchants, expiry and freshness.

### D-002: Own 402-style escrow flow, not the official x402 facilitator
- **Decision:** Implement our own HTTP 402 flow where the payment goes into the escrow contract (`createEscrow`) and the merchant verifies on-chain.
- **Context:** Standard x402 pays the merchant directly; compatibility with escrow is unverified.
- **Alternatives:** official x402 facilitator or a custom scheme on it (revisit after Day-0 spike S1).
- **Consequences:** the payment scheme name is `recourse-escrow`. If the spike shows x402 can carry it, add an adapter later.

### D-003: One language: TypeScript plus Solidity
- **Decision:** All services, SDK, rules, adjudicator, benchmark and dashboard are TypeScript; contracts are Solidity with Foundry.
- **Alternatives:** Python adjudicator and benchmark (rejected for MVP: second language and HTTP boundary).
- **Consequences:** shared zod schemas and the same hashing code run in the backend and the browser verify page.

### D-004: keccak256 everywhere
- **Decision:** Use keccak256 for all hashes (log entries, Merkle trees, commitments, mandate terms).
- **Context:** Cheapest and native on-chain; compatible with OpenZeppelin merkle-tree and viem.
- **Alternatives:** SHA-256 (kept only if reusing DigiVault document hashing for documents; not used for evidence).

### D-005: EIP-712 for every signed object
- **Decision:** Mandate (domain `RecourseEscrow`), tree heads (domain `RecourseGateway`) and receipts (domain `RecourseReceipt`) are EIP-712 typed data. Mandates are also verifiable via ERC-1271 for smart-account owners.
- **Consequences:** wallets show readable signing prompts; domain separation and nonces provide replay protection.

### D-006: Mandate registered on-chain; agent triggers escrow; owner funds it
- **Decision:** `registerMandate(mandate, merchants, signature)` stores the mandate once. The agent calls `createEscrow(mandateId, merchant, amount, requestId)`; the contract pulls tokens from the owner's pre-approved allowance and enforces cap, budget, merchant allowlist and expiry.
- **Context:** The agent holds no funds, so it cannot overspend by design (prevention, not just evidence).
- **Alternatives:** pass the signed mandate with every call (higher gas, no benefit); ERC-4337 session keys (roadmap).
- **Consequences:** the PRD escrow interface was updated to match (see D-019).

### D-007: Rules first, AI second
- **Decision:** Code decides schema validity, timeouts, price, merchant, expiry, freshness timestamps, receipt signatures and clear entity mismatches. AI is invoked only for meaning (ambiguous entity, content that contradicts itself, embedded error text, text-level staleness, dispute reason).
- **Consequences:** the benchmark must show an ablation (rules-only vs rules plus AI) so the AI's value is measured, not claimed.

### D-008: Dual-LLM plus citation-or-abstain
- **Decision:** An extractor model turns untrusted text (merchant body, owner reason) into structured facts; judge models see only mandate terms, rule results and extracted facts. Every claim cites log `seq` numbers verified in code; failures become `needs_human_review`.
- **Consequences:** prompt injection cannot reach the judge directly; the demo includes a live injection scene.

### D-009: SQLite for gateway and API storage
- **Decision:** better-sqlite3 files under `data/`.
- **Consequences:** no database server; the tamper test can copy the file; production storage is out of scope.

### D-010: Hash chain plus per-batch Merkle trees; no consistency proofs in MVP
- **Decision:** Entries form a hash chain; batches use OpenZeppelin `StandardMerkleTree` over `[seq, entry_hash]`; the signed tree head is anchored on-chain. Continuity across batches comes from `prev_hash` linking.
- **Alternatives:** Certificate-Transparency-style consistency proofs and independent witnesses (roadmap).

### D-011: Base Sepolia primary, local anvil as demo fallback
- **Decision:** Demo targets Base Sepolia with testnet USDC; anvil with `MockUSDC` is the fallback if RPC or faucet fails.
- **Consequences:** every script takes `RPC_URL`, `CHAIN_ID`, `TOKEN_ADDRESS` from env; no hardcoded chain.

### D-012: Single arbiter key in the MVP
- **Decision:** One arbiter address calls `resolve`. The verdict commitment (evidence root, rule results, models, prompt hash) is posted on-chain so verdicts can be replayed and challenged.
- **Consequences:** stated openly as a trust assumption. Appeals (Kleros or GenLayer) and a bonded panel are roadmap.

### D-013: Demo currency is testnet USDC
- **Decision:** Demo amounts are in USDC (cap 0.05, price 0.01, budget 2.00). Rupee figures in the PRD are illustrative only.

### D-014: Local models via Ollama
- **Decision:** Extractor and judges run locally for privacy and reproducibility. Exact model names are chosen in Day-0 spike S3 and pinned in `config/models.json`.

### D-015: Plain-English mandate summary is rendered by a template, not an LLM
- **Decision:** The LLM only produces the structured mandate JSON; a deterministic template renders the read-back the owner confirms.
- **Context:** The same model must not be able to misdescribe its own output.

### D-016: Courts are the appeal layer, not competitors
- **Decision:** Position Recourse as the prevention and evidence layer that feeds courts such as Kleros and GenLayer's Internet Court. Not built in the MVP.

### D-017: Documentation layout
- **Decision:** Numbered docs and `ARCHITECTURE.md`, `DECISIONS.md`, `DEVELOPMENT.md` live in `docs/`; `PRD.md` and `CLAUDE.md` are in the repo root. There is no `02` document (dataflow is in `ARCHITECTURE.md`). The redaction-recall document from an earlier project is replaced by `08-adjudicator-and-benchmark.md`.

### D-018: Razorpay and card-rails adapter is roadmap
- **Decision:** The core is rail-agnostic; a Razorpay test-mode settlement adapter is a later swap, not part of this build.

### D-019: PRD escrow interface aligned with the specs
- **Decision:** `PRD.md` sections 5.2 and 7.1 were updated to the `registerMandate` plus `createEscrow(mandateId, ...)` interface, `dispute(escrowId, reasonHash)` and `resolve(escrowId, outcome, fault, commitment)`.
- **Consequences:** `docs/04-api-spec.md` is the authoritative interface.

### D-020: Dispute window defaults
- **Decision:** Contract takes `disputeWindow` in the constructor. Dev default 120 seconds; demo uses 30 seconds. On anvil, time can be advanced with `evm_increaseTime`.

### D-021: Class coverage in the benchmark
- **Decision:** The MVP benchmark covers verdict classes 3 (merchant failure), 4 (buyer regret) and `needs_human_review`. Classes 1 (agent exceeded mandate) and 2 (agent chose unreasonably) are covered by contract tests (hard limits cannot be breached) and are otherwise roadmap, because the demo has a single vendor and the contract blocks hard-limit breaches.

### D-022: Drizzle ORM and generated migrations
- **Decision:** Gateway and API storage use Drizzle ORM over better-sqlite3, with `drizzle-kit` generated, committed, forward-only migrations. Each app owns its database; no cross-app database access. Supersedes the raw-SQL approach implied by D-009 (engine unchanged: SQLite).
- **Consequences:** `pnpm db:generate`, `db:migrate`, `db:reset`, `db:studio`; migration tests; the SQL in `docs/ARCHITECTURE.md` section 5 is logical design only. Rules: `GUIDE.md` section 6.

### D-023: No GitHub issues; tasks tracked in the repo
- **Decision:** Work is tracked in `docs/TASKS.md` (one table per lane), decisions in `docs/DECISIONS.md`, and discussion in team chat. Trunk-based development with short branches, squash merges, and circular cross-lane review.
- **Consequences:** `GUIDE.md` defines ownership, interface-change process and the agent rules.

### D-024: Module ownership and shared package split by file
- **Decision:** Three lanes: P1 Backend and Blockchain, P2 AI, P3 Frontend and Research. `packages/shared` is split by file (P1 crypto and mandate/evidence/api schemas, P2 verdict/rules/facts schemas) so parallel work does not collide. `schemas.ts` becomes a `schemas/` folder with unchanged exports.
- **Consequences:** `.github/CODEOWNERS` mirrors `GUIDE.md` table 2.1; interfaces freeze after M0.

### D-025: Git permissions for AI agents
- **Decision:** Agents have standing permission to commit and push their own feature branch (and `--force-with-lease` after rebasing it) and to open PRs into `dev`. Agents never merge or approve PRs, never push to `dev` or `main`, and never use plain force-push or rewrite others' branches. Replaces the earlier "never push" rule.

### D-026: Feature -> dev -> main branching
- **Decision:** Feature branches merge (squash) into `dev` after review; `dev` is promoted to `main` by a human merge commit after the milestone integration check. Feature branches are cut from fresh `dev` and rebased on it often. Supersedes the "squash-merge into main" wording of D-023.
- **Consequences:** `main` stays demo-ready; integration conflicts surface in `dev` early. CI runs on PRs into both `dev` and `main`. `GUIDE.md` section 7.

### D-027: Models pinned after spike S3 (P2-01)
- **Decision:** Local Ollama models, three families so the quorum is not one model's bias: extractor `mistral:7b`; judges `mistral:7b`, `gemma2:9b`, `llama3.1:8b`. Spike S3 (20 cases that must reach the AI, config B, the model as both extractor and judge): mistral 18/20, gemma2 17/20, llama3.1 16/20, none followed an injection, 100% first-try valid JSON. Rejected: `qwen2.5:7b` (8/20, refunds everything), and the 2 to 3B models tried earlier (qwen2.5:3b, llama3.2:3b, gemma2:2b).
- **Consequences:** `config/models.json` holds the names; `MODEL_EXTRACTOR` and `MODEL_JUDGE_1` still override. Spike results are a screening test, not a benchmark. Benchmark run on seed 1 (200 cases plus 20 controls) is in `bench/results/` (git-ignored) and reproducible with `pnpm bench:gen && pnpm bench -- --config all`. Prompts were not tuned on the demo scenes.

### D-028: Judge input narrowing and rule abstention
- **Decision:** The judge receives sanitised extractor facts only (`sanitizeFacts` drops `notes` and entity names, keeps allow-listed value names and units), and `RuleResults` has an optional `abstain` so R0 and R3 can end in `needs_human_review`. This narrows docs/08 section 4.3 (rule 3 of CLAUDE.md: untrusted text never reaches the judge raw).
- **Consequences:** documented in docs/08; the gateway `entries` table has no `batch_index` (derived from batch ranges) so it stays append-only.

## Open decisions (fill in as they are resolved)

| # | Question | Owner | Status |
|---|---|---|---|
| O-1 | Does Hacker House Goa require disclosure of prior-work reuse (DigiVault or VeriDoc components)? If yes, add `docs/PRIOR_WORK.md`. | _TBD_ | open |
| O-2 | Exact extractor and judge models (Day-0 spike S3) | _TBD_ | open |
| O-3 | ERC-8004 registry vs our own reputation counters (MVP uses our own counters) | _TBD_ | open |
| O-4 | Name clash check for "Recourse" (fallbacks: Surety, Redress) | _TBD_ | open |
| O-5 | Event length, checkpoints and submission format | _TBD_ | open |
| O-6 | Team roles per workstream (see `docs/07-build-plan.md`) | _TBD_ | open |
| O-7 | Can official x402 carry the escrow scheme? (Day-0 spike S1) | _TBD_ | open |
