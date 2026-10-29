# GUIDE: How we build Recourse together (for humans and AI agents)

**Give this file to your AI coding agent at the start of every session.** It tells the agent who owns what, how three people build in parallel without colliding, how work is tracked without GitHub issues, how the database and migrations work (ORM), how everything is tested, and what the agent may and may not do.

Reading order for an agent: this file, then `CLAUDE.md` (project rules), then only the spec sections for your task (`docs/03`, `docs/04`, `docs/08`, ...). Where documents disagree, precedence is: `docs/03` and `docs/04` (formats and interfaces) > `PRD.md` (scope) > `docs/DECISIONS.md` (latest decisions) > this guide > other docs.

---

## 1. Operating model in one page

- **Three people, three lanes, parallel development.** The project is cut into modules. Every module has exactly one owner. You write code only in your own modules; everything else is read-only for you (and for your agent).
- **Contract first.** Modules talk to each other only through the interfaces in `docs/04` and the schemas in `packages/shared`. Nobody waits for a teammate's implementation: code against the interface and a fake.
- **Three-tier branching.** Feature branch -> `dev` (integration) -> `main` (stable, demo-able). Feature branches are short (under one working day) and merge into `dev` often, so conflicts surface early and small. `main` is updated from `dev` only after the integration check passes (section 7.5).
- **No GitHub issues.** Work is tracked in the repo in `docs/TASKS.md` (section 6). Discussion happens in the team chat; decisions are written to `docs/DECISIONS.md`.
- **Production-grade means:** typed, validated, tested, migrated, reviewed, documented. Nothing merges without passing the quality gates (section 9).
- **Testing is part of the task, not a later phase.** A module is not done until its tests, fakes and docs are in the same pull request.

## 2. People and ownership

Two people cover the three lanes for now (assigned 2026-10-29). If a third person joins, hand them lane P3 and update this table and `.github/CODEOWNERS` in one commit.

| Lane | Person | GitHub handle | Focus |
|---|---|---|---|
| **P1: Backend and Blockchain** | Hardik Singh | `HARDIKSINGH150206` | Contracts, crypto core, gateway, merchant SDK, API server |
| **P2: AI** | Ayush Pundhir | `ayush983215` | Rules, LLM pipeline, mandate compiler, benchmark |
| **P3: Frontend and Research** | Hardik Singh (until a third person joins) | `HARDIKSINGH150206` | Dashboard, demo agent and merchant, scaffold and CI, pitch, market research |

### 2.1 Module map (single owner each)

| Module | Path | Owner | Public interface (other modules may use only this) | Depends on | Fake for others to use |
|---|---|---|---|---|---|
| Escrow contract | `contracts/` | P1 | `IRecourseEscrow` (docs/04 s1) | none | `MockUSDC`, local anvil |
| Chain client | `packages/chain` | P1 | typed functions in docs/04 s5 | contracts ABI | `createFakeChain()` in `packages/chain/src/testing` |
| Shared crypto and schemas | `packages/shared` | P1 (see 2.2) | hash, eip712, merkle, commit, bundle, zod schemas | none | test vectors `test/vectors.json` |
| Gateway | `apps/gateway` | P1 | HTTP in docs/04 s2 | shared, chain | recorded bundles from vectors |
| Merchant SDK | `packages/merchant-sdk` | P1 | middleware in docs/04 s5 | shared, chain | n/a |
| API server | `apps/api` | P1 | HTTP in docs/04 s3 | shared, chain, mandate, adjudicator | fixtures in `apps/api/test/fixtures` |
| Rules engine | `packages/rules-engine` | P2 | `runRules(input) -> RuleResults` | shared | n/a (pure functions) |
| LLM client | `packages/llm` | P2 | `generateStructured(...)` | none | `createStubLlm()` |
| Adjudicator | `packages/adjudicator` | P2 | `adjudicate(bundle, mandate, deps) -> Verdict` | shared, rules-engine, llm | `createStubAdjudicator()` returns canned verdicts |
| Mandate compiler | `packages/mandate` | P2 | `compileMandate(text, ctx)`, `summarize(mandate)` | shared, llm | canned compile results |
| Benchmark | `bench/` | P2 | CLI scripts | adjudicator, shared | n/a |
| Demo merchant | `apps/demo-merchant` | P3 | HTTP in docs/04 s4 | merchant-sdk | n/a |
| Demo agent | `apps/demo-agent` | P3 | HTTP in docs/04 s5 | shared, chain | n/a |
| Dashboard | `apps/dashboard` | P3 | UI | shared (browser-safe parts), API over HTTP | mock server (MSW) from `docs/04` examples |
| Scaffold, CI, scripts | root config, `.github/`, `scripts/demo*.ts` | P3 | `pnpm` scripts | all | n/a |
| Docs and pitch | `docs/`, slides | shared (section 2.3) | n/a | n/a | n/a |

### 2.2 Shared package: split by file

`packages/shared` is on everyone's critical path, so ownership is split by file to avoid conflicts:

| Files | Owner |
|---|---|
| `hash.ts`, `eip712.ts`, `merkle.ts`, `commit.ts`, `bundle.ts`, `schemas/mandate.ts`, `schemas/evidence.ts`, `schemas/api.ts`, `test/vectors.json` | P1 |
| `schemas/verdict.ts`, `schemas/rules.ts`, `schemas/facts.ts` | P2 |
| Anything exported to the browser (`index.browser.ts`) | P1 reviews, P3 consumes |

The older single `schemas.ts` in the specs means this `schemas/` folder; the exports are unchanged.

### 2.3 Shared documents

`docs/` files are owned by the person whose module they describe: P1 `03`, `04`, `09`; P2 `08`; P3 `01`, `05`, `06`, `07`, `DEVELOPMENT.md`; `PRD.md`, `DECISIONS.md` and this guide are changed only with all three agreeing (section 4.3).

### 2.4 Boundary rule

Your agent edits files only inside modules you own (plus `docs/TASKS.md`, your own tests and your own handoff notes). If a task needs a change elsewhere, follow section 4.2 (interface change) or 5.3 (request to another owner). Never "just fix it" in someone else's module.

## 3. Daily workflow (human plus agent)

### 3.1 Start of session (do this every time)

1. `git switch dev && git pull --ff-only`, then `git switch -c <branch>` (section 7.1).
2. Read `docs/TASKS.md`: find your task, check `BLOCKED` items and the other lanes' status.
3. Tell the agent: "Read GUIDE.md and CLAUDE.md. I am P<n>. My task is <id>. Work only in <paths>. Relevant specs: <sections>."
4. Agent restates the task, the files it will touch, the interfaces it depends on and the tests it will write. You approve, then it works.

### 3.2 During the session

- Small, verifiable steps: one function or endpoint plus its tests per step.
- After each step run the local gate: `pnpm typecheck && pnpm lint && pnpm test` (and `pnpm test:contracts` for contract work).
- Commit often on your branch, in the imperative mood, citing the requirement or spec section (`feat(gateway): batch closing, G3, docs/03 s6.1`).

### 3.3 End of session

1. Update your row in `docs/TASKS.md` (status, what changed, what is next, anything you need from others).
2. Rebase on `dev` (`git fetch && git rebase origin/dev`), run the full gate, push your feature branch (the agent may do this on its own; section 7.4), and open a pull request **into `dev`** (section 8). A human merges it.
3. If you stop mid-task, leave a handoff note in `docs/TASKS.md` under your row so the next session (or the agent's fresh context) can continue.

### 3.4 Sync rhythm

- **Daily 10-minute standup:** each person says done, next, blocked. Update `TASKS.md` right after.
- **Milestone sync (M0 to M6, `docs/07`):** run the integration check in section 10; apply the cut order if behind.
- **Integration hour:** at each milestone, all three pull `dev`, run `pnpm demo` (or the scenes that exist), and fix breakages together before starting new work.

## 4. Parallel development rules

### 4.1 Code against interfaces, not people

- Every module exports a small public API (table 2.1) and hides the rest. Import only from a package's public entry (`@recourse/<name>`), never from another module's `src/` internals.
- Each module ships a **fake** (table 2.1) so dependants can build and test before the real thing exists. A fake must pass the same interface tests as the real implementation (a shared "contract test" file per interface).
- Mock external HTTP in the dashboard with MSW using the examples in `docs/04`; switch to the real API at M4.

### 4.2 Changing an interface (the only way)

Interfaces are `docs/03`, `docs/04`, and the exported zod schemas in `packages/shared`.

1. Owner proposes the change in a pull request that edits the spec **and** the schema/types **and** the fake, with a "Breaking? yes/no" line.
2. Every consumer lane approves the PR (all three for shared or contract changes).
3. Add an entry to `docs/DECISIONS.md` for any non-trivial change.
4. Merge the same day; consumers adapt within one working day. Additive changes (new optional field) are preferred over breaking ones.

After milestone M0 the shared package and interfaces are **frozen**: only bug fixes and additive changes.

### 4.3 Changing scope or shared documents

`PRD.md` scope, `docs/DECISIONS.md`, this guide, CI thresholds and the Must list need all three approvals. Adding to Must requires removing something from Must (scope lock).

### 4.4 Avoiding merge conflicts

- One owner per file (section 2). Do not reformat files you do not own.
- `pnpm-lock.yaml`: after a rebase conflict, run `pnpm install` to regenerate it; never hand-merge it.
- Generated files (ABIs, `deployments/*.json`, vectors) are regenerated by their owner's script and committed in their own commit.
- Database migrations: see section 6.4 for the numbering and rebase rule.
- Root config (`package.json`, `tsconfig.base.json`, CI) is P3's. Ask P3 for new scripts or dependencies at root; add package-level dependencies in your own package.

## 5. Task tracking without GitHub issues

### 5.1 Why

Issues add ceremony and split context across tools. We keep one plain file that is reviewed like code, is visible to every agent, and is always in sync with the branch.

### 5.2 `docs/TASKS.md` format

One table per lane, one row per task. Keep rows short; details live in the spec.

```md
## P1: Backend and Blockchain
| ID | Task | Req / spec | Status | Branch | Notes / handoff |
|---|---|---|---|---|---|
| P1-03 | createEscrow with cap, budget, allowlist, expiry | E1, docs/04 s1 | IN_PROGRESS | feat/contracts-create-escrow | tests for ExceedsBudget pending |
```

- **ID:** `P<lane>-<nn>`, never reused.
- **Status:** `TODO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`, `BLOCKED(<ID or person>)`, `CUT`.
- A task is small: finishable in one session to one day. Split anything bigger.
- Only the owner edits their lane's table. To ask another lane for something, add a row in **their** table with status `TODO` and prefix the task `REQUEST(P<you>):`, then tell them in chat.
- `DONE` means the definition of done in section 9.3 is met and the pull request is merged.

### 5.3 Handling blocks

If you are blocked on another module: (1) use its fake, (2) mark your row `BLOCKED(P<n>-<id>)` only if the fake is insufficient, (3) ping the owner in chat, (4) pick another task. Never stub around a spec problem silently: raise it (section 4.2).

### 5.4 Where things live instead of issues

| Need | Where |
|---|---|
| What to do | `docs/TASKS.md` |
| Why we decided | `docs/DECISIONS.md` |
| Bugs found | A `BUG:` row in the owner's table with repro steps and a failing test name |
| Questions to the team | Team chat, answers recorded in `DECISIONS.md` if they change something |
| Customer conversations | The shared validation doc (not in this repo if it holds personal data) |

## 6. Database, ORM and migrations

### 6.1 Choices

- **ORM:** Drizzle ORM (TypeScript-first, SQL-like, no code-generation binary), with `drizzle-kit` for migrations. **Driver:** `better-sqlite3`. **Engine:** SQLite files under `data/` (MVP). The same schema code can move to Postgres later by switching the dialect.
- Decision recorded as D-022 in `docs/DECISIONS.md`. The raw SQL in `docs/ARCHITECTURE.md` section 5 is the **logical design**; the Drizzle schema files are the source of truth for the actual tables.

### 6.2 Layout (per app, no shared database)

```
apps/gateway/
  src/db/schema.ts         # Drizzle table definitions (source of truth)
  src/db/client.ts         # opens the database, applies migrations at start
  drizzle/                 # generated SQL migrations + meta (committed)
  drizzle.config.ts
apps/api/
  src/db/schema.ts
  src/db/client.ts
  drizzle/
  drizzle.config.ts
```

- Each app owns its database and migrations. **No app reads another app's database file or imports its schema**; they talk over HTTP (docs/04).
- Repositories: all queries live in `src/db/repositories/*.ts` (or `src/repositories`), not in route handlers. Handlers call repositories; repositories return plain typed objects validated by zod where they cross a boundary.

### 6.3 Commands

| Command | Does |
|---|---|
| `pnpm db:generate` | Generates a new SQL migration from schema changes (`drizzle-kit generate`) in each app that has a db |
| `pnpm db:migrate` | Applies pending migrations to `data/*.db` |
| `pnpm db:reset` | Deletes `data/*.db` and re-applies migrations (dev only) |
| `pnpm db:studio` | Opens Drizzle Studio for inspection |

Apps also run pending migrations on startup in development and in `pnpm demo`; in any other mode they refuse to start if migrations are pending and tell you to run `pnpm db:migrate`.

### 6.4 Migration rules

1. **Never edit the database by hand and never edit a migration that is merged.** Schema change = edit `schema.ts`, run `pnpm db:generate`, review the generated SQL, commit schema and migration together.
2. Migrations are **forward-only**. To undo something, write a new migration.
3. Name migrations meaningfully (`pnpm db:generate --name add_batches_anchor_tx`).
4. If two branches generate migrations at once, the one that merges second **rebases, deletes its own migration folder entries, and regenerates** on top of the merged schema. Only the app's owner touches its `drizzle/` folder, which makes this rare.
5. Append-only data (the evidence log) is enforced in code: no `update` or `delete` repository functions exist for `log_entries`; a test asserts this.
6. Every migration is tested: a test applies all migrations to an empty in-memory database and asserts the expected tables, indexes and constraints exist.
7. Demo seed data is a script (`pnpm seed` / `scripts/seed-db.ts`), never a migration.
8. Contracts have their own "migration" story: Foundry deploy scripts plus `deployments/<chainId>.json`; the ABI is exported by P1's script and committed.

### 6.5 Conventions

- Primary keys: text ids (uuid or bytes32 hex) or integer `seq` where the spec says so. Timestamps: integer unix seconds. Amounts: text (decimal string) or integer base units, as in docs/04. Booleans: integer 0/1 via Drizzle's boolean mode.
- Add indexes for every foreign key and every column used in a `where` on hot paths (for example `log_entries.request_id`).
- Transactions: batch closing and `resolve` handling run in a single transaction.

## 7. Git workflow

### 7.1 Branches

| Branch | Purpose | Who updates it | Protection |
|---|---|---|---|
| `main` | Stable, demo-ready, tagged releases | Humans only, by merging `dev` (section 7.5) | No direct pushes; CI green; approval from all three lanes for the `dev` -> `main` PR |
| `dev` | Integration of all finished features | Humans only, by merging approved feature PRs | No direct pushes; CI green; one approval from another lane |
| `p<n>/<type>-<area>-<topic>` | One task, one lane | The owner or their agent (push allowed) | None; delete after merge |

- Branch names: `<lane>/<type>-<area>-<topic>`, for example `p1/feat-contracts-create-escrow`, `p2/fix-adjudicator-citation-check`, `p3/docs-demo-script`. Types: `feat`, `fix`, `test`, `docs`, `chore`, `refactor`.
- **Always branch from fresh `dev`**, never from `main` or from another person's feature branch. Need a teammate's unmerged work? Use their fake, or ask them to merge a small PR into `dev` first.
- **Sync often:** at least at the start of every session and before opening a PR, run `git fetch && git rebase origin/dev`. This is the main defence against merge conflicts. Resolve conflicts on your branch, re-run the gate, then push with `--force-with-lease` (only your own feature branch).
- Merge feature PRs into `dev` with **squash-merge**: one commit per task, easy to revert. Delete the branch after merge.
- Lifetime: aim for under one working day and under about 400 changed lines. Split larger work into sequential PRs so `dev` receives work continuously.
- Hotfixes: branch from `dev` like anything else. Only if `main` is broken during the demo freeze, a human may branch from `main`, fix, and then merge the fix into both `main` and `dev`.

### 7.2 Commits

Imperative mood, scoped, with the requirement or spec reference: `feat(contracts): enforce per-call cap (E1, docs/04 s1)`. Small commits; each builds and passes tests.

### 7.3 Never commit

`.env`, keys, `data/`, `bench/results/` (except the final committed report), `contracts/out`, `contracts/cache`, `node_modules`, large model files. CI runs a secret scan.

### 7.4 What the AI agent may do with git

| Action | Agent |
|---|---|
| `git status`, `diff`, `log`, `add`, `commit` on your own feature branch | Yes |
| Create a feature branch from fresh `dev` | Yes |
| `git fetch` and `git rebase origin/dev` on your own feature branch | Yes |
| `git push` your own feature branch (including `--force-with-lease` after a rebase) | **Yes, standing permission** |
| Open a pull request from your feature branch **into `dev`** and write its description | Yes |
| Merge or approve any pull request (feature -> `dev`, `dev` -> `main`) | **Never** |
| Push to `dev` or `main`, merge into them locally, or tag releases | **Never** |
| Plain `--force`, rewriting another person's branch, deleting remote branches, `reset --hard` on shared work | **Never** |
| Edit CI, branch protection or CODEOWNERS | Only in a P3 task, and never to weaken a gate |

Humans review and merge. If a push is rejected or CI fails, the agent reports it and fixes its branch; it does not bypass checks.

### 7.5 Promoting `dev` to `main`

1. Trigger: a milestone integration check (section 10) passes on `dev`, or at least once per working block when `dev` is green.
2. A human opens a PR `dev` -> `main`. CI must be green and `pnpm demo` (scenes available so far) must pass on a clean checkout of `dev`.
3. All three lanes approve. Merge with a **merge commit** (not squash) so `dev` history stays intact, then tag milestones (`m1`, `m2`, ... `v0.1-demo`).
4. Never let `dev` and `main` diverge: after merging, `main` should be an ancestor of `dev`. If a hotfix went to `main`, merge `main` back into `dev` immediately.
5. During the pre-demo freeze, only `dev` -> `main` promotions of tested bug-fix batches are allowed.

## 8. Pull requests and review

### 8.1 PR template (copy into every PR description; also kept at `.github/pull_request_template.md`)

```md
## What and why
<one paragraph; cite requirement ids and spec sections>
Base branch: `dev` (only `dev` -> `main` PRs target `main`)

## Scope
- Module(s): <paths>   - Lane: P<n>   - Tier: Must / Should
- Interface change? no / yes (link to the spec edit in this PR)
- Migration? no / yes (<file>)

## Tests
- [ ] Unit tests added/updated   - [ ] Integration/fuzz/invariant as relevant
- [ ] Fake updated (if the interface changed)
- Local gate: typecheck / lint / test / test:contracts all pass

## Docs
- [ ] Spec/README/TASKS.md updated

## Risk and rollback
<what could break; how to revert>
```

### 8.2 Review rules

- Reviewer is from **another lane** (circular: P1 reviews P2, P2 reviews P3, P3 reviews P1). The author never merges their own PR unreviewed.
- Feature PRs target `dev`. Review within a few hours during the build; small PRs make this realistic. If blocked, ping in chat, do not wait silently.
- Reviewer uses the checklist in `docs/10` section 6 plus: does it stay inside the author's modules, does it match the spec, are tests meaningful (not only coverage), are errors and edge cases handled, are secrets and untrusted text handled safely.
- Feedback is resolved by changes or a short written reason. Disagreements about interfaces go to section 4.2.
- AI-assisted code gets the same review. The author must understand every line they submit.

## 9. Quality bar (production grade)

### 9.1 Gates (CI blocks merge unless all pass)

Typecheck (strict), lint and format, unit and integration tests, contract tests with fuzz and invariants, coverage thresholds, Slither, dependency audit, secret scan. Exact thresholds are in `docs/10` section 3. Model-dependent tests (Ollama) run locally and in the benchmark, not in CI.

### 9.2 Engineering standards

- TypeScript `strict`; no `any` without a comment; zod at every input boundary; pure functions in `shared` and `rules-engine`; side effects only in apps and `chain`.
- Errors: use typed error classes and the API error shape `{ "error": { "code", "message", "details?" } }`; never swallow errors; no empty `catch`.
- Config from environment, validated at startup by a zod schema; fail fast with a clear message.
- Logging: pino, structured, with request ids; never log keys or raw evidence bodies at info.
- Idempotency: event handlers (dispute watcher, anchoring) must be safe to run twice.
- Time and randomness are injected (clock and RNG interfaces) so tests are deterministic.
- No hardcoded chain ids, addresses or ports.
- Solidity: custom errors, NatSpec, events for every state change, no unbounded loops, checks-effects-interactions.
- Security rules: `docs/09` (threats, invariants, key roles). Never read a key your process role does not need.

### 9.3 Definition of done (per task)

- [ ] Matches the spec; cites requirement ids.
- [ ] Tests written first or alongside: happy path, each error path, boundaries; fake updated if relevant.
- [ ] Local gate green; CI green.
- [ ] Migration generated and tested if the schema changed.
- [ ] Docs and `TASKS.md` updated; no new TODOs without a `TASKS.md` row.
- [ ] Reviewed by another lane and squash-merged.
- [ ] Demo acceptance criteria AC1 to AC7 not regressed (`pnpm demo` once the scenes exist).

### 9.4 Testing responsibilities

Each module owner writes and maintains the tests for their module (layers and required cases: `docs/10`). Integration tests that span lanes are written by the **consumer** lane against the provider's fake first, then run against the real thing at the milestone integration hour. Failing cross-lane tests are fixed by the owner of the module that violates the interface.

## 10. Milestone integration checklist (run at each sync)

| Milestone | Integration check (everyone pulls `dev` first; passing it triggers a `dev` -> `main` promotion, section 7.5) |
|---|---|
| M0 | `pnpm install && pnpm typecheck && pnpm test && pnpm test:contracts` pass; vectors green in Solidity and TypeScript; spikes decided |
| M1 | Script runs approve, register, create, release on target chain; P3 dashboard can read chain via `packages/chain` fake and real |
| M2 | Request through gateway produces entries, signed and anchored tree head and a bundle that `verifyBundle` accepts; one-byte edit fails; P2 loads that bundle in the adjudicator tests |
| M3 | Scenes 2 to 5 pass headlessly; verdict visible via `GET /disputes/:id` |
| M4 | Full golden path from the UI |
| M5 | Benchmark numbers for A1, A2, B, C exist |
| M6 | Three consecutive clean golden-path runs; fallback tested; pre-flight checklist (`docs/05`) complete |

## 11. Environment and secrets

- One `.env` per machine, created from `.env.example`; never commit it; never paste keys into chat, PRs or prompts.
- All keys are throwaway testnet keys; generate separate keys per role (`docs/09` section 3). Share only addresses and deployment JSON, not keys.
- The dashboard may use a browser wallet for the owner; services read keys from env at startup only.
- Local fallback: anvil with `MockUSDC` (`docs/DEVELOPMENT.md` section 3.1) so anyone can run everything offline.

## 12. Instructions for the AI agent (read carefully)

1. **Identify the lane.** Ask the human which lane (P1, P2 or P3) they are if it is not stated. Work only in that lane's modules (table 2.1).
2. **Read before writing.** Read this guide, `CLAUDE.md`, and the exact spec sections for the task. Check `docs/TASKS.md` and `docs/DECISIONS.md`. Do not invent formats, field names or endpoints; if the spec is silent or wrong, stop and propose a spec change (section 4.2).
3. **Plan, then act.** State the plan (files, interfaces, tests) and wait for approval on anything larger than a small change.
4. **Tests first or with the change.** Never deliver code without tests; never weaken or delete a test to make it pass; never mark a task done with failing gates.
5. **Respect the scope lock.** Refuse "while we are here" additions that are not in `PRD.md` Must or Should; offer to add a `TASKS.md` row instead.
6. **Security reflexes.** Never put untrusted text into a judge prompt; never log keys or raw bodies; never commit secrets; validate all input with zod; use prepared statements through the ORM only.
7. **Database changes** go through the Drizzle schema and generated migrations (section 6); never hand-edit `data/*.db` or a merged migration.
8. **Do not touch other lanes' files.** If you need a change there, draft a `REQUEST(P<n>)` row and a proposed interface diff for the human to send.
9. **Git limits** as in section 7.4: work on your own feature branch cut from `dev`, commit often and push it (standing permission), open PRs into `dev`; never merge or approve PRs, never touch `dev` or `main`, never plain force-push.
10. **Report honestly.** When done, report: what changed, which spec sections it implements, test results (commands and outcomes), anything not done, assumptions made, and updates needed in `TASKS.md`/`DECISIONS.md`. If a test or gate fails, say so; do not hide it.
11. **Keep context small.** Load only the spec sections you need; prefer pointing at files over pasting them; re-read the interface before editing code that depends on it.
12. **Language of the product:** say "tamper-evident", never "tamper-proof"; the arbiter is a single key in the MVP; testnet only.

### 12.1 Prompt template for starting a session

```text
Read GUIDE.md and CLAUDE.md. I am P<n> (<lane>). Task <ID>: <title>.
Work only in: <paths>. Specs: <docs/xx sections>. Requirement ids: <ids>.
Fakes available: <list>. Definition of done: GUIDE.md section 9.3.
Plan first, wait for my OK, then implement with tests. Branch from dev; push your feature branch; open the PR into dev; do not merge.
```

## 13. Troubleshooting collaboration problems

| Problem | Do this |
|---|---|
| Two people need the same file | Stop; the owner makes the change, or they agree on who edits via chat and note it in `TASKS.md` |
| Teammate's module is not ready | Use its fake; if the fake is missing or wrong, request one (5.2) |
| CI fails only on my PR | Rebase on `dev`, rerun locally with a clean install; fix; do not disable the gate |
| Migration conflict | Section 6.4 rule 4 |
| Spec contradicts reality | Open an interface-change PR (4.2); do not code around it silently |
| Behind schedule | Apply the cut order in `docs/07` section 5 and tell the team at the next sync |
| Agent edited a file outside the lane | Revert that change, move it to a `REQUEST` row |
| Flaky test | Fix or quarantine the same day; never retry-loop in CI |

## 14. Pre-demo freeze rules (last 5% of build time)

Bug fixes only, each with a failing test first; no dependency upgrades, no schema changes, no refactors. Three consecutive green golden-path runs are required before the freeze is declared. P3 owns the recording and the fallback bundle.
