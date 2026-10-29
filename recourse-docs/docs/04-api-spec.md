# 04: API and interface spec

Authoritative interfaces: the escrow contract, HTTP APIs (gateway, API, demo merchant, demo agent), the merchant SDK and the package-level functions. If code and this document differ, fix one of them in the same change and log it in `DECISIONS.md`. Data formats are defined in `03-crypto-and-merkle-spec.md`.

Conventions: JSON over HTTP; errors use `{ "error": { "code": "string", "message": "string", "details": {} } }`; all ids and hashes are lowercase `0x` hex; amounts are decimal strings in token units (USDC 6 decimals, so "0.01" means 10000 base units); timestamps are unix seconds.

---

## 1. Escrow contract (`contracts/src/RecourseEscrow.sol`)

### 1.1 Interface

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRecourseEscrow {
    enum State { None, Held, Disputed, Released, Refunded }
    enum Outcome { REFUND, RELEASE }
    enum Fault { NONE, AGENT, MERCHANT }

    struct Mandate {
        address owner;
        address agent;
        address token;
        uint256 maxPricePerCall;
        uint256 totalBudget;
        uint64  expiresAt;
        uint256 nonce;
        bytes32 merchantsHash;
        bytes32 termsHash;
    }

    struct Escrow {
        bytes32 mandateId;
        address merchant;
        uint256 amount;
        bytes32 requestId;
        uint64  createdAt;
        uint64  windowEnds;
        State   state;
    }

    struct Reputation { uint32 disputes; uint32 faults; }

    // --- events
    event MandateRegistered(bytes32 indexed mandateId, address indexed owner, address indexed agent, bytes32 termsHash);
    event EscrowCreated(bytes32 indexed escrowId, bytes32 indexed mandateId, address indexed merchant, uint256 amount, bytes32 requestId, uint64 windowEnds);
    event Released(bytes32 indexed escrowId);
    event Disputed(bytes32 indexed escrowId, address indexed by, bytes32 reasonHash);
    event Resolved(bytes32 indexed escrowId, Outcome outcome, Fault fault, bytes32 verdictCommitment);
    event RootAnchored(bytes32 indexed root, uint64 size, uint64 batchIndex, uint64 timestamp);

    // --- custom errors
    error BadSignature(); error NonceUsed(); error MandateUnknown(); error MandateExpired();
    error NotAgent(); error NotOwner(); error NotArbiter(); error NotGateway();
    error ExceedsMaxPrice(); error ExceedsBudget(); error MerchantNotAllowed();
    error DuplicateRequest(); error WrongState(); error WindowOpen(); error WindowClosed();
    error MerchantsHashMismatch(); error ZeroAmount();

    // --- mandate registry
    /// Anyone may submit; the signature must be a valid EIP-712 signature by m.owner (EOA or ERC-1271).
    /// Requires keccak256(abi.encodePacked(merchants)) == m.merchantsHash, merchants sorted ascending, nonce unused.
    function registerMandate(Mandate calldata m, address[] calldata merchants, bytes calldata signature) external returns (bytes32 mandateId);

    // --- escrow lifecycle
    /// Callable only by mandate.agent. Enforces: not expired, merchant allowlisted, amount > 0,
    /// amount <= maxPricePerCall, spent + amount <= totalBudget, unique (mandateId, requestId), not paused.
    /// Pulls `amount` of m.token from m.owner (pre-approved allowance) into this contract. State -> Held.
    function createEscrow(bytes32 mandateId, address merchant, uint256 amount, bytes32 requestId) external returns (bytes32 escrowId);

    /// Anyone, after windowEnds, if state == Held. Pays merchant. State -> Released.
    function release(bytes32 escrowId) external;

    /// Mandate owner only, while state == Held and block.timestamp < windowEnds. State -> Disputed.
    /// reasonHash = keccak256(utf8(reason text)) commits the owner's reason (text stored off-chain).
    function dispute(bytes32 escrowId, bytes32 reasonHash) external;

    /// Arbiter only, while state == Disputed.
    /// REFUND: tokens go back to mandate.owner, state -> Refunded. RELEASE: tokens go to merchant, state -> Released.
    /// Updates reputation: both agent and merchant get disputes++; the party named in `fault` gets faults++.
    function resolve(bytes32 escrowId, Outcome outcome, Fault fault, bytes32 verdictCommitment) external;

    // --- evidence anchoring
    /// Gateway address only. Idempotent: first call per root sets anchoredAt[root].
    function anchorRoot(bytes32 root, uint64 size, uint64 batchIndex) external;

    // --- admin
    function setArbiter(address a) external;     // onlyOwner
    function setGateway(address g) external;     // onlyOwner
    function pause() external;                   // onlyOwner (guardian)
    function unpause() external;                 // onlyOwner

    // --- views
    function mandates(bytes32 mandateId) external view returns (Mandate memory);
    function spent(bytes32 mandateId) external view returns (uint256);
    function isMerchantAllowed(bytes32 mandateId, address merchant) external view returns (bool);
    function escrows(bytes32 escrowId) external view returns (Escrow memory);
    function anchoredAt(bytes32 root) external view returns (uint64);
    function agentReputation(address agent) external view returns (Reputation memory);
    function merchantReputation(address merchant) external view returns (Reputation memory);
    function disputeWindow() external view returns (uint64);
    function arbiter() external view returns (address);
    function gateway() external view returns (address);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}
```

Constructor: `(address owner, address arbiter, address gateway, uint64 disputeWindow)`.

### 1.2 Required properties (tests)

- Unit: every revert path above; happy path release; dispute then refund; dispute then release (buyer regret).
- Fuzz: random price, budget and sequences never let `spent(mandateId) > totalBudget`; `amount > maxPricePerCall` always reverts.
- Invariant: contract token balance equals the sum of amounts in `Held` and `Disputed` escrows; no state moves backwards; funds leave only on `release` or `resolve`.
- Security: `nonReentrant` on token-moving functions; pull payments only; checks-effects-interactions; `Pausable` blocks `createEscrow` and `registerMandate`, not `resolve`.
- Known limit: no refund after `Released` (no clawback without a bond; roadmap). No arbiter timeout in the MVP.

### 1.3 Deployment output

`script/Deploy.s.sol` deploys `MockUSDC` (local only) and `RecourseEscrow`, sets arbiter and gateway, and prints JSON; `scripts/sync-deployment.ts` writes `deployments/<chainId>.json` and updates `.env`.

---

## 2. Gateway HTTP API (port 4000)

### 2.1 Proxy

`ANY /proxy/:merchantId/*` forwards to the merchant registered in `config/demo.json` (`merchants: { weather: "http://localhost:4200" }`).

Request headers from the agent:
| Header | Required | Meaning |
|---|---|---|
| `X-Recourse-Agent` | yes | agent address |
| `X-Recourse-Mandate` | yes | mandateId |
| `X-Recourse-Request-Id` | no | bytes32; generated if absent |
| `X-Payment` | on retry | `base64(JSON({ escrowId, txHash }))` |

Response headers added: `X-Recourse-Request-Id`, `X-Recourse-Seq` (seq of the response entry).

Behaviour: logs `request`; forwards; if the merchant returns 402, logs `payment_required` and passes it through; on a retry with `X-Payment`, reads the escrow from chain (state must be `Held`) and logs `payment_proof` with `chain_state`; logs `response` (body stored as blob) and, if the `X-Recourse-Receipt` header is present, a `receipt` entry. Errors from the merchant (timeouts, 5xx) are logged as `response` with their status and latency.

### 2.2 Log and evidence endpoints

| Method and path | Purpose | Response |
|---|---|---|
| `GET /health` | liveness | `{ ok: true, head_seq, last_batch }` |
| `GET /log/head` | latest tree head | `{ root, size, batch_index, timestamp, signature, anchored: bool }` |
| `GET /log/entries?from=&to=&request_id=` | list entries (public fields only) | `{ entries: LogEntry[] }` |
| `GET /log/entries/:seq` | one entry | `LogEntry` |
| `GET /log/batches/:index` | **full batch export** for the verify page | `{ batch, entries: LogEntry[], tree_head, anchor }` |
| `GET /log/proof/:seq` | batch Merkle proof | `{ seq, batch_index, proof: bytes32[], tree_head }` |
| `POST /log/flush` | force batch and anchor now | `{ batch_index, root, anchor_tx }` |
| `GET /evidence/:requestId` | evidence bundle (docs/03 section 8) | `EvidenceBundle` |
| `GET /evidence/blob/:bodyHash` | raw stored body, verify by rehash | bytes |
| `POST /evidence/:requestId/disclose` | selective disclosure | body `{ fields: [{ seq, name }] }` returns `{ disclosed: [...] }` |
| `POST /log/decision` | agent submits a decision record (logged as agent-claimed) | `{ seq }` |
| `POST /admin/tamper` | **dev only** (`ENABLE_DEV_ROUTES=1`): mutate one stored entry to demonstrate detection | `{ ok: true }` |

Dev routes are disabled unless `ENABLE_DEV_ROUTES=1`. The browser tamper test does not need the server route: it edits the downloaded batch in memory.

---

## 3. Recourse API (port 4100)

| Method and path | Purpose |
|---|---|
| `GET /health` | liveness |
| `POST /mandates/compile` | natural language to a structured, unsigned mandate |
| `POST /mandates` | store a signed mandate and its off-chain terms |
| `GET /mandates/:mandateId` | mandate, terms, plain-English summary, on-chain status |
| `GET /disputes` | list disputes (filter by `status`, `mandateId`) |
| `GET /disputes/:id` | dispute detail with verdict and cited entries |
| `POST /disputes` | register reason text for an on-chain dispute (see below) |
| `POST /disputes/:id/adjudicate` | manually (re)run adjudication (dev and recovery) |
| `POST /disputes/:id/review` | human override for `needs_human_review` (Should tier; arbiter key) |
| `GET /reputation/:address` | agent and merchant counters (reads chain) |
| `GET /bench/latest` | latest benchmark run results |
| `GET /bench/runs/:id` | one run |

### 3.1 `POST /mandates/compile`

Request:
```json
{ "text": "Buy weather data for Mumbai, max 5 cents per call, 2 USDC total, for one day", "owner": "0x...", "agent": "0x...", "merchants": ["0x..."], "chain_id": 84532, "escrow": "0x...", "token": "0x..." }
```
Response:
```json
{
  "mandate": { "owner": "0x...", "agent": "0x...", "token": "0x...", "maxPricePerCall": "0.05", "totalBudget": "2.00", "expiresAt": 1767286400, "nonce": "17", "merchantsHash": "0x...", "termsHash": "0x..." },
  "terms": { "version": 1, "category": "weather_data_api", "defaults": { "freshness_seconds": 3600, "schema_required": true, "substitutions": "not_allowed", "sla_ms": 5000 }, "discretion": ["vendor_choice"] },
  "merchants": ["0x..."],
  "summary": "Your agent may spend up to 0.05 USDC per call and 2.00 USDC in total on weather data API calls until ... Allowed merchants: ... Any other field is not restricted: vendor_choice. Responses must be valid and fresher than 1 hour.",
  "questions": [ { "id": "inclusive_fees", "text": "Is the 2.00 USDC budget inclusive of gas fees?", "options": ["yes", "no"] } ],
  "typed_data": { "domain": { "...": "EIP-712 domain" }, "types": { "Mandate": [ ] }, "primaryType": "Mandate", "message": { } }
}
```
The summary is rendered by a **template** from the validated struct (D-015), never by the LLM. The dashboard requires the owner to confirm the summary and answer `questions` before signing.

### 3.2 `POST /mandates`

Request `{ mandate, terms, merchants, signature, summary }`. The API recomputes `termsHash`, `merchantsHash` and the digest, verifies the signature, stores the record, and returns `{ mandate_id }`. The owner (via the dashboard wallet) separately calls `approve` and `registerMandate` on-chain; the API listens for `MandateRegistered` and marks `registered_onchain`.

### 3.3 Disputes

1. The owner calls `dispute(escrowId, reasonHash)` on-chain (from the dashboard wallet or `apps/demo-agent` CLI in demo mode).
2. The API's **dispute watcher** sees `Disputed`, creates a record (status `opened`), flushes and anchors the gateway log, fetches the evidence bundle, then adjudicates automatically.
3. `POST /disputes` `{ escrow_id, reason_text }` stores the owner's reason text; the API checks `keccak256(utf8(reason_text)) == reasonHash` from the on-chain event. A dispute with no reason text is adjudicated with `reason_category = "unclear"`.

Dispute detail response:
```json
{
  "dispute_id": "uuid",
  "status": "resolved",
  "escrow_id": "0x...",
  "verdict": { "...": "see docs/08 Verdict schema" },
  "evidence_report": { "entry_hash_ok": true, "membership_ok": true, "...": "..." },
  "txs": { "dispute": "0x...", "resolve": "0x..." }
}
```

---

## 4. Demo merchant (port 4200)

`GET /api/weather?city=<name>` (protected by the merchant SDK; price `0.01` USDC).

Healthy response body:
```json
{ "city": "Mumbai", "temp_c": 31, "humidity": 68, "observed_at": 1767200000, "summary": "Humid and partly cloudy" }
```
(`observed_at` is unix seconds; `WeatherResponseSchema` in `packages/shared`: `temp_c` -60..60, `humidity` 0..100.)

Failure modes set per request with header `X-Demo-Mode` **or** globally with `POST /admin/mode { "mode": "..." }`:

| Mode | Behaviour |
|---|---|
| `honest` | valid, fresh, correct city |
| `wrong_schema` | body `{"temp":"hot"}` (fails schema) |
| `empty` | 200 with empty body |
| `http_error` | 500 after payment verified |
| `timeout` | delays beyond `sla_ms` |
| `stale_timestamp` | `observed_at` older than `freshness_seconds` |
| `wrong_city` | valid body for a clearly different city |
| `stale_in_text` | valid schema, fresh timestamp, but `summary` says cached/yesterday data |
| `embedded_error` | valid schema, `summary` is an error or quota message |
| `implausible` | in-range values that contradict the summary or are placeholders |
| `injection` | schema-valid body whose `summary` is an error message plus text instructing the arbiter to release funds (see docs/05); forces the AI path |

`GET /.well-known/recourse.json` returns the merchant manifest `{ merchant, price, scheme, schema_hint, freshness_guarantee_seconds }` (Should tier).

### 4.1 The 402 flow (scheme `recourse-escrow`)

1. First call (no `X-Payment`) returns **HTTP 402** with header `X-Payment-Required: base64(JSON(requirements))` and the same JSON as the body:
```json
{
  "scheme": "recourse-escrow", "chain_id": 84532, "escrow": "0x...", "token": "0x...",
  "merchant": "0x...", "amount": "0.01", "request_id": "0x...", "expires_at": 1767200300,
  "resource": "/api/weather?city=Mumbai"
}
```
2. The agent calls `createEscrow(mandateId, merchant, amount, requestId)`, then retries with `X-Payment: base64(JSON({ escrowId, txHash }))`.
3. The merchant reads the escrow from chain: state `Held`, `merchant` equals itself, `amount >=` price, `requestId` matches, not already served. Then it serves the body and the `X-Recourse-Receipt` header.

---

## 5. Merchant SDK (`@recourse/merchant-sdk`)

```ts
import { recourse } from "@recourse/merchant-sdk";

const protect = recourse.protect({
  merchantPrivateKey: process.env.MERCHANT_PRIVATE_KEY as `0x${string}`,
  chainId: 84532,
  rpcUrl: process.env.RPC_URL!,
  escrow: "0x...",
  token: "0x...",
  price: "0.01",                      // decimal string in token units
  requestTtlSeconds: 300,
  requireGatewaySignature: false,     // Should tier
});

app.get("/api/weather", protect, (req, res) => { /* handler; body is signed after res.send */ });
```

Behaviour: issues 402 requirements; verifies escrow on-chain; marks the `requestId` as served (replay protection); wraps `res.send` to hash the final body bytes and attach `X-Recourse-Receipt` (EIP-712 `Receipt`, docs/03 section 7). Exports `signReceipt`, `verifyReceipt`, `buildRequirements` for tests.

---

## 6. Demo agent (port 4300)

| Method and path | Purpose |
|---|---|
| `GET /scenarios` | list scenario ids and descriptions |
| `POST /scenarios/:id/run` | run a scenario; returns `{ run_id }` |
| `GET /runs/:runId` | steps, request ids, escrow ids, tx hashes, status |
| `POST /runs/:runId/dispute` | open an on-chain dispute for the run's escrow, body `{ reason_text }` (demo owner key) |

CLI: `pnpm --filter @recourse/demo-agent cli -- run <scenarioId>`. Scenario ids match docs/05: `happy`, `over_cap`, `wrong_schema`, `stale_in_text`, `injection`, `regret`.

---

## 7. Package-level interfaces

```ts
// @recourse/shared
export function canonicalHash(value: unknown): `0x${string}`;                       // keccak256(utf8(JCS(value)))
export function entryHash(e: Omit<LogEntry, "entry_hash">): `0x${string}`;
export function buildFieldCommitments(fields: Record<string, unknown>): { root: `0x${string}`; leaves: FieldLeaf[] };
export function verifyBundle(bundle: EvidenceBundle, opts?: { rpc?: PublicClient }): Promise<VerificationReport>;
export const MandateTypes, TreeHeadTypes, ReceiptTypes;                           // EIP-712 definitions

// @recourse/chain
export function createEscrowClient(cfg: ChainConfig): {
  registerMandate, createEscrow, release, dispute, resolve, anchorRoot,
  getEscrow, getMandate, anchoredAt, reputation, watchDisputed, watchResolved
};

// @recourse/rules-engine
export function runRules(input: RuleInput): RuleResults;     // pure, deterministic
export function decide(results: RuleResults): RuleDecision | null;   // null = not decisive

// @recourse/llm
export function structuredChat<T>(opts: { model: string; system: string; user: string; schema: ZodType<T>; jsonSchema: object; seed: number }): Promise<T>;

// @recourse/mandate
export function compileMandate(text: string, ctx: CompileContext): Promise<CompileResult>;   // LLM -> zod-validated JSON
export function renderSummary(m: Mandate, terms: Terms, merchants: string[]): string;         // template
export function typedData(m: Mandate, domain: Eip712Domain): TypedData;

// @recourse/adjudicator
export function adjudicate(input: AdjudicationInput, opts: AdjudicatorOptions): Promise<Verdict>;
```

`RuleInput`, `RuleResults`, `Verdict` and `AdjudicationInput` are defined in `docs/08-adjudicator-and-benchmark.md` and as zod schemas in `packages/shared`.

---

## 8. Configuration and environment

See `docs/DEVELOPMENT.md` for the full `.env` list. Key values consumed by the APIs: `CHAIN_ID`, `RPC_URL`, `ESCROW_ADDRESS`, `TOKEN_ADDRESS`, the five private keys, `DISPUTE_WINDOW_SECONDS`, `BATCH_MAX_ENTRIES`, `BATCH_MAX_SECONDS`, `OLLAMA_URL`, `MODEL_*`, ports.
