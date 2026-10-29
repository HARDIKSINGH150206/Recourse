# 06: Frontend and agent plan

Plan for the dashboard (`apps/dashboard`), the verify page (browser-side verification) and the scripted demo agent (`apps/demo-agent`). Requirements: `PRD.md` sections 5.1, 5.8 (D1 to D3). Visual and demo expectations: `05-demo-golden-path.md`. API details: `04-api-spec.md`.

## 1. Dashboard

### 1.1 Stack

React, Vite, TypeScript (strict), Tailwind, TanStack Query for server state, wagmi plus viem for wallet and chain, Recharts for benchmark charts. No server-side rendering. Dev port 5173. Environment via `VITE_*` variables (`VITE_API_URL`, `VITE_GATEWAY_URL`, `VITE_AGENT_URL`, `VITE_CHAIN_ID`, `VITE_RPC_URL`, `VITE_ESCROW_ADDRESS`, `VITE_TOKEN_ADDRESS`, `VITE_DEMO_KEY_MODE`).

Chains configured in `lib/wagmi.ts`: Base Sepolia (84532) and local anvil (31337); the active one comes from `VITE_CHAIN_ID`. `VITE_DEMO_KEY_MODE=1` uses a burner owner key from env (stage fallback only; never for real funds).

### 1.2 Routes and pages

| Route | Page | Purpose | Key API calls |
|---|---|---|---|
| `/mandate` | Mandate | Compose, compile, review, sign, register | `POST /mandates/compile`, `POST /mandates`; wallet: `approve`, `registerMandate` |
| `/run` | Run | Start scenarios, watch steps live | demo-agent `GET /scenarios`, `POST /scenarios/:id/run`, `GET /runs/:id` |
| `/timeline/:requestId` | Timeline | Every log entry, escrow state, tx links | gateway `GET /log/entries?request_id=`, `GET /evidence/:requestId`; chain reads |
| `/disputes` | Disputes | List and open disputes | `GET /disputes`; wallet: `dispute` |
| `/disputes/:id` | Verdict | Verdict card with cited entries | `GET /disputes/:id` |
| `/verify` | Verify | Browser-side verification and tamper test | gateway `GET /log/batches/:index`, `GET /evidence/:requestId`; chain `anchoredAt` |
| `/bench` | Benchmark | Results table and charts | `GET /bench/latest` |
| `/reputation` | Reputation | Agent and merchant counters | `GET /reputation/:address` |

### 1.3 Mandate page flow (requirement M1 to M4)

1. Text box for the natural-language request plus fields for owner, agent and merchant addresses (prefilled from `deployments/<chainId>.json` and `config/demo.json`).
2. **Compile** calls `/mandates/compile`. The page shows a structured table split into three zones (hard limits, safe defaults, agent discretion) and the **template-rendered plain-English summary**.
3. Clarifying questions appear as one-tap chips; the owner must answer all before the Sign button is enabled; every "any" field is listed explicitly.
4. **Sign** uses wagmi `signTypedData` with the returned `typed_data`; then `POST /mandates`.
5. **Register on-chain:** wallet sends `token.approve(escrow, budget)` then `escrow.registerMandate(...)`; the page waits for `MandateRegistered` and shows the mandateId.

### 1.4 Components

| Component | Notes |
|---|---|
| `MandateZones` | three-column display of hard / defaults / discretion |
| `StepList` | run steps with seq numbers, tx hashes (explorer links), status icons |
| `EscrowCard` | state badge, amount, live countdown to `windowEnds`, Dispute button (owner only, while `Held`) |
| `VerdictCard` | class, outcome, fault, `decided_by`, claims with expandable cited entries, explanation, commitment, resolve tx; badge when `injection_detected` |
| `EntryViewer` | JSON view of a log entry with disclosed fields; used by Timeline and Verify |
| `CheckChip` | pass/fail/pending chip for each verification check |
| `ReplayBadge` | visible badge when a verdict was replayed (`DEMO_REPLAY=1`); never hide this |
| `BenchTable`, `BenchChart` | per-config and per-category tables; accuracy bars; confusion matrix |
| `ReputationPanel` | counters before and after verdicts |

### 1.5 Verify page (the tamper test)

Runs entirely in the browser using `@recourse/shared` (`verifyBundle`).

1. Load either a **full batch** (`GET /log/batches/:index`) or an **evidence bundle** (`GET /evidence/:requestId`); also allow pasting or uploading JSON.
2. Show the check list: entry hashes, field proofs, batch membership, tree-head signature, anchor on-chain (needs RPC), receipt, chain continuity, time order. Each chip shows pass, fail or pending.
3. **Editable entry view:** the user can change any character of any displayed entry field or hash. On every edit the page re-runs `verifyBundle` and updates chips immediately; the changed entry is highlighted. A reset button restores the original.
4. Optional "Verify anchor" button reads `anchoredAt(root)` from the chain and compares it with the tree head.
5. Copy: use "tamper-evident", never "tamper-proof". Add a one-line caption stating what verification proves and what it does not.

### 1.6 State and errors

- TanStack Query with `refetchInterval` 2 seconds on run and dispute pages while status is not final.
- API errors use the standard error shape; show `error.message` and `code` in a toast; never swallow.
- No secrets in the browser except `VITE_DEMO_KEY_MODE` burner key for the stage fallback; document that clearly in `.env.example`.

### 1.7 Frontend tests

Vitest for `lib/verify.ts` (same vectors as `packages/shared/test/vectors.json`), component tests for `VerdictCard` and `CheckChip`; one Playwright smoke test is optional (Should).

## 2. Demo agent (`apps/demo-agent`)

### 2.1 Responsibilities

A small TypeScript service (port 4300) and CLI that behaves like a shopping agent for API calls: it calls the merchant **through the gateway**, handles the 402, pays through the escrow contract, retries, and records outcomes. It exists to make the demo deterministic.

### 2.2 Modules

| File | Role |
|---|---|
| `agent.ts` | Orchestrates one scenario run: request, handle 402, pay, retry |
| `payer.ts` | Wraps `@recourse/chain`: `createEscrow` with the agent key; maps contract errors (for example `ExceedsMaxPrice`) to readable results |
| `scenarios/*.ts` | `happy`, `over_cap`, `wrong_schema`, `stale_in_text`, `injection`, `regret` |
| `index.ts` | HTTP API (see `04-api-spec.md` section 6) |
| `cli.ts` | `pnpm --filter @recourse/demo-agent cli -- run <scenarioId>` |

### 2.3 Behaviour contract

1. Every merchant call goes to `GATEWAY_URL/proxy/weather/...` with `X-Recourse-Agent` and `X-Recourse-Mandate`; the agent never calls the merchant directly.
2. On 402 it parses `X-Payment-Required`, calls `createEscrow(mandateId, merchant, amount, requestId)`, waits for confirmation, then retries with `X-Payment`.
3. `over_cap`: attempts an escrow above `maxPricePerCall`; expected result `reverted: ExceedsMaxPrice`; the run is marked `blocked`, not `failed`.
4. The agent posts a `decision` record to the gateway (`POST /log/decision`) before paying (kind `rationale`, for example "single approved merchant"); it is logged as agent-claimed.
5. Optional **LLM planner mode** (`AGENT_LLM=1`): the planner chooses the city and the call parameters from a text task via the Ollama client; payment logic stays deterministic. Default off for demos.
6. Scenarios are idempotent per run id; a failed step stops the run and records the error.

### 2.4 Tests

Vitest with a local anvil and an in-process merchant: `happy` yields a `Held` escrow and a receipt entry; `over_cap` yields a revert; `wrong_schema` followed by a dispute yields a REFUND verdict (integration, with the adjudicator stubbed to rules-only).

## 3. Visual and copy guidelines

- Plain, high-contrast layout; large monospace for hashes with copy buttons and truncation; always show the chain id and escrow address in the footer.
- Color only as reinforcement (also use text or icons) for pass/fail.
- Copy rules: "tamper-evident" not "tamper-proof"; "testnet" visible in the header; verdict claims always link to the cited entries.
- Accessibility: keyboard focus states, labels on inputs, contrast at least WCAG AA.

## 4. Build order (see `07-build-plan.md` for milestones)

1. Scaffold app, wagmi config, API client, layout.
2. Mandate page (compile, sign, register).
3. Run page and demo-agent HTTP API; StepList and EscrowCard.
4. Verdict page and VerdictCard.
5. Verify page with editable tamper test.
6. Bench page, Reputation page, polish, replay badge.
