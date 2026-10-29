# DEVELOPMENT

Setup, exact commands, environment variables, testing and git rules. Run all commands from the repo root unless stated. Everything is testnet or local; never use real funds or real keys.

## 1. Prerequisites

| Tool | Notes |
|---|---|
| Node.js | current LTS |
| pnpm | via Corepack: `corepack enable && corepack prepare pnpm@latest --activate` |
| Foundry | `curl -L https://foundry.paradigm.xyz \| bash` then `foundryup` (provides `forge`, `cast`, `anvil`) |
| Ollama | https://ollama.com ; start with `ollama serve` |
| Git | for the repo |
| A GPU is recommended for local models | CPU-only works but the benchmark will be slow; run it on the GPU machine ahead of time |

## 2. First-time setup

```bash
git clone <repo-url> recourse && cd recourse
corepack enable
pnpm install
cp .env.example .env              # then fill in the values (section 4)
pnpm contracts:install            # pinned OpenZeppelin + forge-std into contracts/lib (gitignored)
ollama pull <extractor-model>      # chosen in Day-0 spike S3; pin names in config/models.json
ollama pull <judge-model>
```

Model names are decided in spike S3 (`docs/07-build-plan.md`); verify what is available with `ollama list`.

## 3. Running locally

### 3.1 Local chain (default for development and the demo fallback)

```bash
pnpm chain:up                      # runs: anvil --chain-id 31337 (port 8545)
pnpm chain:deploy                  # forge script Deploy.s.sol, writes deployments/31337.json, updates .env
pnpm seed                          # funds accounts with MockUSDC and ETH, sets arbiter and gateway, owner approves escrow
pnpm dev                           # gateway, api, demo-merchant, demo-agent, dashboard
```

### 3.2 Base Sepolia

1. Set in `.env`: `CHAIN_ID=84532`, `RPC_URL=<base sepolia rpc>`, `TOKEN_ADDRESS=<testnet usdc>` (verify the address and faucet first; spike S1/S2).
2. Fund the five keys with testnet ETH; fund the owner with testnet USDC.
3. Deploy: `cd contracts && forge script script/Deploy.s.sol --rpc-url $RPC_URL --private-key $DEPLOYER_PRIVATE_KEY --broadcast && cd ..`
4. `pnpm sync:deployment` (copies addresses into `deployments/84532.json` and `.env`), then `pnpm seed` and `pnpm dev`.

### 3.3 Demo and reset

```bash
pnpm demo:reset                    # wipes data/, reseeds, restarts clean state
pnpm demo                          # runs the full golden path headlessly (docs/05) and prints pass/fail per scene
```

### 3.4 Ports

anvil 8545, gateway 4000, api 4100, demo-merchant 4200, demo-agent 4300, dashboard 5173, Ollama 11434.

## 4. Environment variables (`.env.example`)

```bash
# chain
CHAIN_ID=31337
RPC_URL=http://127.0.0.1:8545
ESCROW_ADDRESS=
TOKEN_ADDRESS=

# keys (TESTNET ONLY, never reuse real keys, never commit this file)
DEPLOYER_PRIVATE_KEY=
OWNER_PRIVATE_KEY=
AGENT_PRIVATE_KEY=
MERCHANT_PRIVATE_KEY=
GATEWAY_PRIVATE_KEY=
ARBITER_PRIVATE_KEY=

# protocol parameters
DISPUTE_WINDOW_SECONDS=120          # demo: 30
BATCH_MAX_ENTRIES=16
BATCH_MAX_SECONDS=30

# services
GATEWAY_PORT=4000
API_PORT=4100
MERCHANT_PORT=4200
AGENT_PORT=4300
GATEWAY_URL=http://localhost:4000
API_URL=http://localhost:4100
MERCHANT_URL=http://localhost:4200
DB_DIR=./data
LOG_LEVEL=info
ENABLE_DEV_ROUTES=0                 # 1 enables /admin/tamper on the gateway

# AI (names pinned in config/models.json; these override it if set)
OLLAMA_URL=http://localhost:11434
MODEL_EXTRACTOR=
MODEL_JUDGE_1=
MODEL_JUDGE_2=
MODEL_JUDGE_3=
JUDGE_COUNT=1                       # 1 (Must) or 3 (Should, quorum)
AGENT_LLM=0                         # 1 enables the LLM planner mode in the demo agent
DEMO_REPLAY=0                       # 1 replays stored verdicts (UI shows a replay badge)

# dashboard (Vite)
VITE_API_URL=http://localhost:4100
VITE_GATEWAY_URL=http://localhost:4000
VITE_AGENT_URL=http://localhost:4300
VITE_CHAIN_ID=31337
VITE_RPC_URL=http://127.0.0.1:8545
VITE_ESCROW_ADDRESS=
VITE_TOKEN_ADDRESS=
VITE_DEMO_KEY_MODE=0                # 1 uses a burner owner key (stage fallback only)
```

`packages/shared/src/config.ts` parses these with zod and fails fast on missing values. `.env` is gitignored; commit `.env.example` only. Anvil's well-known development keys are acceptable for local use only.

## 5. Root scripts (`package.json`)

| Script | Does |
|---|---|
| `pnpm dev` | runs gateway, api, demo-merchant, demo-agent and dashboard in parallel |
| `pnpm chain:up` | starts anvil |
| `pnpm chain:deploy` | deploys contracts to the chain in `.env` and syncs addresses |
| `pnpm sync:deployment` | writes `deployments/<chainId>.json` and updates `.env` |
| `pnpm seed` | funds accounts, sets roles, approves escrow |
| `pnpm demo` / `pnpm demo:reset` | golden path run / clean state |
| `pnpm test` | Vitest across packages and apps |
| `pnpm contracts:install` | installs pinned OpenZeppelin and forge-std into `contracts/lib` |
| `pnpm test:contracts` | `forge test -vvv` inside `contracts/` |
| `pnpm typecheck` | `tsc --noEmit` per package |
| `pnpm lint` | ESLint, Prettier check, solhint |
| `pnpm bench:gen` | generate benchmark cases from a seed |
| `pnpm bench` | run the benchmark (`-- --config C`) |
| `pnpm bench:report` | render the Markdown and chart data |
| `pnpm db:generate` / `db:migrate` / `db:reset` / `db:studio` | Drizzle migrations for gateway and api (`GUIDE.md` section 6) |
| `pnpm vectors` | regenerate `packages/shared/test/vectors.json` |

## 6. Testing

| Layer | Tool | What must be covered |
|---|---|---|
| Contracts | `forge test` | unit tests for every revert and happy path; fuzz for cap and budget; invariants for balance and monotonic state |
| Shared crypto | Vitest | test vectors (docs/03 section 13); cross-check of mandate digest with the contract |
| Rules engine | Vitest | one test group per rule R0 to R8 including alias table and ambiguous entity |
| Adjudicator | Vitest with a stubbed `llm` | citation check, quorum, `needs_human_review` paths, commitment stability |
| Gateway and merchant SDK | Vitest + supertest + local anvil | 402 flow, receipt verification, entry hashing, batching, tamper detection |
| Benchmark | `pnpm bench` | produces results JSON with counts and rates |
| Demo | `pnpm demo` | all scenes pass (AC1 to AC7) |

CI (`.github/workflows/ci.yml`): checkout, install Foundry, `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:contracts`. Model-dependent tests are skipped in CI (they need Ollama); they run locally and in the benchmark.

## 7. Code style

- TypeScript `strict`; ES modules; no `any` without a comment; zod schemas at every IO boundary.
- Small pure functions in `rules-engine` and `shared`; side effects only in apps and `chain`.
- Solidity: custom errors, no unbounded loops, events for every state change, NatSpec on external functions.
- No hardcoded chain ids, addresses or ports: read from config.
- Never log private keys or raw evidence bodies at `info`.

## 8. Git workflow

- Branch names: `p<lane>/<type>-<area>-<topic>` (see `GUIDE.md` section 7.1); areas: `contracts`, `gateway`, `sdk`, `api`, `adjudicator`, `bench`, `dashboard`, `agent`, `shared`.
- Branching: feature branch -> `dev` (integration) -> `main` (stable). Small pull requests into `dev`; `dev` is promoted to `main` by humans after the integration check (`GUIDE.md` section 7.5).
- Commit messages in the imperative mood; reference the spec section or requirement id (for example `E1`, `docs/03 section 6`).
- **AI agents** may commit and push their own feature branch and open PRs into `dev`; they never merge or approve PRs, never touch `dev` or `main`, and never plain force-push (D-025, D-026). Humans open PRs and merge. Full workflow, branch naming (`p<n>/<type>-<area>-<topic>`) and review rules: `GUIDE.md` sections 7 and 8.
- Never commit `.env`, `data/`, `bench/results/`, `contracts/out`, `contracts/cache` or `node_modules`.

## 9. Working with Claude Code

1. Start every session by pointing it at `CLAUDE.md` (it loads automatically from the repo root) and the specific spec sections for the task, for example: "Implement requirement G3 following docs/03 sections 6.1 to 6.4 and docs/04 section 2."
2. Ask for small, verifiable steps: contract function plus tests, one endpoint plus tests, one rule plus tests.
3. After each step run `pnpm typecheck && pnpm test` (and `pnpm test:contracts` for contract work) before moving on.
4. If a spec seems wrong, ask Claude Code to propose a change to the spec and `docs/DECISIONS.md` first, then implement.
5. Keep the scope lock: refuse "while we are here" additions that are not in `PRD.md` Must or Should.

## 10. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `createEscrow` reverts `BadSignature` or `MandateUnknown` | Mandate not registered, or domain mismatch (chainId or verifying contract); re-run the digest vector test |
| `ExceedsBudget` unexpectedly | `spent` counts Held and Disputed escrows; reset with `pnpm demo:reset` |
| Merchant returns 402 repeatedly | `X-Payment` header missing or escrow not `Held`; check `payment_proof` entry and chain state |
| Verify page shows `membership` red on untouched data | Wrong Merkle type encoding (`["uint256","bytes32"]`) or a different tree library |
| Judge returns invalid JSON | Check `format` JSON schema, lower context size, retry once, otherwise `needs_human_review` |
| Benchmark is very slow | Run on the GPU machine, use cached outputs, reduce judges to 1 for config B |
| Anvil time-sensitive tests flaky | Use `evm_increaseTime` and `evm_mine`; never sleep in tests |
