# Handoff: P2 (AI) lane, as of 2026-10-31

Written for an agent or person picking up the P2 lane with no prior context. Read `CLAUDE.md` and `GUIDE.md` first (they are the rules); this file is the state of the work, what was learned the hard way, and what to do next. Where this file and the specs disagree, the specs win (`docs/03`, `docs/04`, then `PRD.md`, then `docs/DECISIONS.md`).

## 1. Who and what

- **Project:** Recourse, a trust layer for AI agent payments (pay-per-call with a money-back guarantee). Hacker House Goa. Testnet only.
- **Lane:** P2 (AI), owner Ayush Pundhir (GitHub `ayush983215`). Hardik Singh (`HARDIKSINGH150206`) owns everything else (P1 backend and chain, P3 frontend and scaffold).
- **You may edit only:** `packages/rules-engine`, `packages/llm`, `packages/adjudicator` (incl. `prompts/`), `packages/mandate`, `bench/`, `config/models.json`, `config/alias-table.json`, `packages/shared/src/schemas/{verdict,rules,facts}.ts`, `docs/08`, your own tests, your rows in `docs/TASKS.md`, and handoff notes. Everything else is read-only. To get a change elsewhere, add a `REQUEST(P2):` row in Hardik's table of `docs/TASKS.md`; never "just fix it".
- **Git rules (CLAUDE.md rule 11):** branch from fresh `dev` as `p2/<type>-<area>-<topic>`; push your own branch (`--force-with-lease` after a rebase is allowed); open PRs **into `dev`**; **never** merge or approve a PR, push to `dev` or `main`, use plain `--force`, or delete remote branches. Hardik reviews and merges. End commits with the `Co-Authored-By` line the tool gives.

## 2. State of the P2 work

Everything below is merged into `dev` (PRs #20 to #29) unless marked otherwise.

| Task | What exists | Where | Tests |
|---|---|---|---|
| P2-02 | `structuredChat`, `createLlm(transport)`, `createOllamaLlm`, `createStubLlm`, `jsonSchemaOf`. zod-validates every reply, retries once, then throws `LlmError("invalid_output")`. | `packages/llm` | 15 |
| P2-03 | `runRules` (R0 to R8) and `decide`. R8 (injection tripwire) runs on every case and is never decisive. R0 and R3 end in an optional `abstain` field on `RuleResults`. | `packages/rules-engine`, `config/alias-table.json` | 85 |
| P2-04 | `adjudicate(input, { llm, models?, aliasTable? })` and `createAdjudicator`. Rules, then extractor, then judge, then citation check, then verdict and commitment. Prompts v1 are in `packages/adjudicator/prompts/`. | `packages/adjudicator` | 47 |
| P2-05 | Quorum: `tally`, `toVote`. A strict majority of **all configured judges** must agree; a failed, inconsistent or uncited judge counts in the denominator but never as agreement. | `packages/adjudicator/src/quorum.ts` | (in the 47) |
| P2-06 | `compileMandate` / `createMandateCompiler`. The model only extracts; code validates bounds, price <= budget, and computes `expiresAt` from the injected clock. Merchants are never chosen by the model. | `packages/mandate` | 35 |
| P2-07 | Seeded case generator (200 headline cases plus 20 paired injection controls), evidence builder using the real `verifyBundle`, runner for configs A1/A2/B/C, metrics with Wilson intervals, model-output cache, Markdown and JSON report. | `bench/` | 57 |
| P2-01 | Spike script `bench/src/spike.ts` and a token-cap fix in `packages/llm`. **On branch `p2/feat-model-spike`, pushed in the PR that adds this file.** The spike was run; **no model is pinned**. See section 4. | `bench/`, `packages/llm` | in the above |

Key design rules the code enforces (do not weaken them):

1. Rules decide every checkable fact; AI decides meaning only.
2. Untrusted text (merchant body, owner reason) goes **only** to the extractor. The judge receives mandate terms, rule results, **sanitised** facts and a numeric-only entry list. `sanitizeFacts` (`packages/adjudicator/src/judge.ts`) drops `notes` and both entity names and keeps only allow-listed value names and units, because no filter can make free text safe. This narrows docs/08 s4.3 and is documented there.
3. Citation or abstain: every claim cites existing log `seq` numbers, and at least one kept claim must cite a `response` entry, else `needs_human_review`.
4. Determinism: temperature 0, fixed seed, `num_predict` capped at 1024, prompts are versioned files, and the prompt hash and model versions go into the verdict commitment.
5. Say "tamper-evident", never "tamper-proof". Testnet only. Never commit keys or `.env`.
6. Do not put a benchmark number in any doc or slide unless a run produced it (requirement B3).

## 3. Commands and environment gotchas (read before running anything)

This was learned on a MacBook (arm64, **8 GB RAM**, about 20 GB free disk, flaky network).

- **`pnpm` is not on PATH.** The repo needs Node >= 22; use nvm's Node 22 and corepack: `export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH`, then `corepack pnpm ...`. The root scripts call `pnpm` recursively, so put a tiny shim named `pnpm` (`exec corepack pnpm "$@"`) on PATH too.
- **Frozen lockfile:** if `CI=true` is set, `pnpm install` is frozen. After adding a dependency use `pnpm install --no-frozen-lockfile`, and verify `pnpm install --frozen-lockfile` is clean before pushing (CI uses it).
- **Quote workspace specs in zsh:** `pnpm add '@recourse/llm@workspace:*'` (unquoted `*` breaks). pnpm writes `workspace:^`; change it to `workspace:*` to match the other packages.
- **Prettier reshapes files.** After `pnpm format`, a later string-replace edit can silently miss. Check that an edit applied.
- **Full gate before every PR:** `pnpm typecheck && pnpm lint && pnpm test && pnpm check:secrets`. All green at the time of writing (typecheck, lint, 14 test packages, secret scan clean).
- **Benchmark:** `pnpm bench:gen` (cases), `pnpm bench -- --config A1,A2` (needs no model), `pnpm bench -- --config all` (needs pinned models; the runner refuses B/C while `config/models.json` has `TBD` names), `pnpm bench:report <run-dir>`, `pnpm bench:ingest bench/results/<run>/summary.json` (needs a running API and `API_ADMIN_TOKEN`). Results go to `bench/results/` (git-ignored).
- **Spike:** `pnpm --filter @recourse/bench spike -- <ollama-model> [<model> ...]` runs 20 cases that must reach the AI through config B for each model.
- **Ollama:** installed with Homebrew (`brew install ollama`, version 0.34.4). It is **not** running by default. Start it with `ollama serve` (a long-lived process; stop it with `pkill -f "ollama serve"`). I deliberately did not enable the login service.
- **Verify every pull.** `ollama pull ... | tail` hides failures: a failed pull looked like success once and cost a wasted run. Always check `ollama list` afterwards. If every case in a run fails in a few milliseconds with `model_error`, the model is not installed (the server answers 404 on `/api/chat`); that is not a model result.
- **Foundry (`anvil`, `forge`) is NOT installed.** `brew install foundry` stalled on the flaky network (the download hung at 0% CPU) and was cancelled. The live demo (`pnpm chain:up`, `chain:deploy`, `pnpm demo`) needs it. Retry on a stable connection.

### Local-only state (not in git)

- `.env` exists (made by `pnpm env:local`, anvil dev keys, git-ignored). I set `MODEL_EXTRACTOR=llama3.2:3b` and `MODEL_JUDGE_1=llama3.2:3b` in it for a demo attempt that never ran. Revisit or clear these; llama3.2:3b is **not** a good judge (section 4).
- `~/.ollama/models`: `qwen2.5:3b` (1.9 GB), `llama3.2:3b` (2.0 GB), `gemma2:2b` (1.6 GB). `qwen2.5:7b` failed to download twice (DNS errors).
- `bench/results/` has the rules-only run `run-1-2026-10-30T13-44-28-712Z` and the raw spike JSON. Both are reproducible (seed 1); regenerate rather than rely on them.

## 4. Open work, in priority order

### 4.1 P2-01: pin real models (the main blocker)

Nothing real can run until `config/models.json` has real model names: the quorum is inactive, benchmark configs B and C refuse to run, the mandate compiler cannot be used, and demo scenes 3, 4, 5 and the reputation check fall to human review or the wrong class.

Spike S3 results (20 cases that must reach the AI: 2 from each of 8 semantic categories plus 4 owner-reason injections; 8 truth-REFUND and 12 truth-RELEASE; config B with the model as both extractor and judge). This is a screening test on 20 cases, not a benchmark.

| Model | Correct | Abstained | First-try valid JSON | Behaviour |
|---|---|---|---|---|
| qwen2.5:3b | 11/20 | 3 | 97% of 39 calls | 17 RELEASE, 3 abstain, 0 refunds: never refunds a semantic failure |
| llama3.2:3b | 8/20 | 0 | 100% of 40 calls | REFUND on all 20: refunds everything, including all 4 injection cases and every valid response |
| gemma2:2b | 4/20 | 10 | 97% of 39 calls | mostly abstains (uncited claims); refunds 3 of the 4 injection cases |

Conclusions: structured output works (97 to 100% valid JSON on the first try), but none of these 2 to 3B models judges meaning. Each shows a default bias. The design is safe against this (unsure goes to a human, rules never use the AI), but the AI stage is not yet useful. Also seen: one qwen2.5:3b case took 908 seconds (15 minutes) and one gemma2:2b case 133 seconds before failing with `model_error`. The likely cause is a small model under JSON-constrained decoding never closing the object (not confirmed). `num_predict` is now capped at 1024 in `packages/llm` as a precaution; the timeout is still 120 s per call.

Suggested next steps:
1. On a stable connection, pull a 7 to 8B model (`qwen2.5:7b`, `llama3.1:8b`) and re-run the spike. On 8 GB RAM a 7B model (about 4.7 GB) is tight; expect slow calls and keep other apps closed. A machine with more memory or a GPU is better.
2. Prompts v1 were written without being tested against a real model, and the spike shows default-answer bias. Iterate on `prompts/extractor.v1.md` and `prompts/judge.v1.md` using the **benchmark and spike cases** (not the demo bodies), bump the prompt version, and check the result with the spike. Do not tune on the demo scenes and then present them as independent results.
3. When a model passes the spike, pin it in `config/models.json` (three entries in `judges` activate the quorum; use three different model families), then run `pnpm bench -- --config all` and `pnpm bench:ingest`.
4. Record the decision in `docs/DECISIONS.md` (needs both people's agreement).

### 4.2 Fill the benchmark and the pitch numbers

After 4.1, the report in `bench/results/<run>/report.md` gives the real false-refund rate, injection resistance and AI lift with counts. Only then can the pitch's slide 6 include AI numbers. Until then, only the rules-only numbers below are valid.

### 4.3 Live demo

Needs Foundry (section 3) and pinned models. Per `docs/PITCH.md`: scenes without a model pass (mandate, happy path, over-cap block, hard failure, tamper test, final release); scenes 3 to 5 need a model that follows the judge prompt. Do not demo them as passing until `pnpm demo` is 9 of 9. If a replay is shown, the replay badge must stay visible.

### 4.4 Smaller items

- P1-12 (compiler wired into the API) is done and the bench ingest, root `pnpm bench*` aliases and Bench page were merged in #31; the P1-13 and P3-10 rows in `docs/TASKS.md` may still read IN REVIEW. Re-check `docs/TASKS.md` for the current status of anything you depend on.
- The `abstain` field on `RuleResults` and the narrowed judge facts (docs/08 s4.3) are documented in docs/08 but not yet logged in `docs/DECISIONS.md`; propose entries.
- A2/B/C latency is only meaningful on uncached cases; the report says so.

## 5. Measured numbers that are valid today

Source: rules-only run on 200 synthetic cases generated from seed 1 (generator v1), no model involved. Reproduce with `pnpm bench:gen && pnpm bench -- --config A1,A2`. These are synthetic cases built by the team: present them as a sanity check of the design, not as external accuracy.

- Rules decided 74 cases and all 74 were correct (95% CI 95.1 to 100%).
- 0 of 65 truth-RELEASE cases were wrongly refunded (95% CI 0 to 5.6%).
- 126 of 200 cases were abstained (63%); those are the cases that need the AI.
- Rules-only injection resistance is 20 of 20 trivially (the rules never read meaning).
- A2 (default to RELEASE) misses 46 of 120 truth-REFUND cases (38.3%).

## 6. The pitch deck

A 9-slide deck with a full speaker script in the notes was built as an Artifact (private to the owner): https://claude.ai/artifact/DnbPUqYeNz4D1S9tt21Jh6. It uses only the numbers in section 5 and the spike table in section 4.1. One placeholder remains on the last slide (`[__ conversations, __ quotes]`, to be filled from the validation log). Slide 5 ("In the demo") is optional: it needs a real screen recording; delete it otherwise. Hardik's P3-09 row says "slides not built"; the deck exists but he may want to adopt or replace it. Update the deck's AI-status slide if 4.1 changes the facts.

## 7. Quick start for the next session

```bash
git fetch && git switch dev && git pull --ff-only
git switch -c p2/<type>-<area>-<topic>
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH   # plus a `pnpm` shim, see section 3
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm test && pnpm check:secrets   # expect all green
```

Read next: `docs/08-adjudicator-and-benchmark.md` (pipeline, rules table, benchmark), `docs/TASKS.md` (current status of every lane), `docs/PITCH.md` (what may be shown, and the rehearsal questions).
