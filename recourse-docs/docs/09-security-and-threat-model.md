# 09: Security, threat model and privacy

Scope: testnet MVP. Nothing here is a claim of production security; it is the design we build to, the assumptions we state, and the checks that must pass. Companion docs: `docs/03` (crypto), `docs/04` (interfaces), `docs/08` (adjudicator).

## 1. Assets and trust assumptions

| Asset | Who could harm it | Protected by |
|---|---|---|
| Owner funds (allowance) | Rogue agent, merchant, arbiter | Contract caps, budget, allowlist, expiry, dispute window, pause |
| Merchant payment | False dispute, arbiter bias | Receipts, rules-first adjudication, buyer-regret class, verdict commitment |
| Evidence integrity | Agent, gateway operator, merchant | Gateway-only writes, hash chain, anchored roots, merchant receipts |
| Verdict integrity | Injected text, model error, arbiter key | Extractor/judge split, citation check, quorum, commitment, `needs_human_review` |
| Keys | Leak, reuse | Role separation (section 3), `.env` never committed |

**Trusted (stated assumptions):** the gateway operator before a batch is anchored (up to `BATCH_MAX_SECONDS`); the arbiter key (single key in the MVP); the chain and RPC; the OpenZeppelin libraries. **Untrusted:** the agent, merchant response bodies, owner free-text reasons, anything from the network.

## 2. Threat table (STRIDE-style)

| # | Threat | Impact | Mitigation | Residual risk | Test |
|---|---|---|---|---|---|
| T1 | Agent spends beyond cap or budget | Fund loss | `createEscrow` reverts: `ExceedsMaxPrice`, `ExceedsBudget` | None for hard limits | Forge unit + fuzz |
| T2 | Agent pays a non-allowlisted merchant | Fund loss | `MerchantNotAllowed` | None | Forge unit |
| T3 | Mandate replay or cross-chain replay | Unauthorised mandate | EIP-712 domain with chainId and verifyingContract, per-owner nonce, expiry | None | Forge unit, vector S5 |
| T4 | Duplicate payment for one request | Double charge | `escrowId` unique per (mandateId, requestId): `DuplicateRequest` | None | Forge unit |
| T5 | Reentrancy on release/resolve | Fund loss | Checks-effects-interactions, `ReentrancyGuard`, pull payments, `SafeERC20` | Low | Forge invariant, reentrant mock token |
| T6 | Arbiter key stolen or biased | Wrong refunds/releases | Verdict commitment on-chain, `pause`, state machine forbids refund after release, key never in browser | **Single key in MVP (stated limit)**; roadmap: quorum signer, appeals | Review + docs |
| T7 | Agent edits its own log | Evidence forgery | Agent has no write path to the gateway log; entries chained and anchored | Pre-anchor window | `bundle` tamper tests |
| T8 | Gateway operator alters entries | Evidence forgery | Merchant co-signed receipt; anchored roots; short batches | **Pre-anchor window, bypass (stated limit)** | Tamper tests |
| T9 | Prompt injection from merchant text | Wrong verdict | Rules first; extractor treats text as data; judge never sees raw text; schema-valid structured output; citation-or-abstain | Model error remains; measured in benchmark | Bench injection category, demo scene |
| T10 | Owner files false dispute | Merchant loses payment | Receipt + rules; regret class releases to merchant | Semantic edge cases | Bench |
| T11 | Merchant replays old receipt | Fake proof of delivery | Receipt binds `requestId`; gateway checks request match | Low | Unit |
| T12 | Brute-forcing disclosed hashes | Privacy leak | Salted per-field leaves, 32-byte random salts | Salts held by gateway | Unit |
| T13 | SSRF or open proxy via gateway | Internal network access | Gateway forwards only to registered `merchantId` base URLs; no user-supplied hosts; block private ranges outside dev | Medium until config reviewed | Integration test |
| T14 | Log or blob exhaustion (DoS) | Service down | Body size limit, rate limit per agent, timeout, bounded batch size | Accepted in MVP | Config test |
| T15 | Dependency or supply-chain compromise | Anything | Lockfile committed, pinned versions, `pnpm audit` in CI, minimal deps | Accepted | CI |
| T16 | Secrets in git or logs | Key leak | `.env` ignored, `.env.example` placeholders only, pino redaction, secret scan in CI | Human error | CI scan |
| T17 | Front-run or griefing of `registerMandate` | Nuisance | Owner signature required; anyone may submit but cannot alter | None | Forge unit |
| T18 | Frozen funds (arbiter offline) | Liveness | `needs_human_review` holds funds; arbiter manual resolve; **no timeout in MVP (stated limit; roadmap: timeout default)** | Stated | Docs |

## 3. Key custody and roles

| Key | Used by | Allowed to do | Must not |
|---|---|---|---|
| `OWNER` | Dashboard wallet / scripts | Sign mandate, approve token allowance, `dispute` | Be shared with any service |
| `AGENT` | demo-agent | `createEscrow` only | Hold funds |
| `MERCHANT` | demo-merchant | Sign receipts, receive payment | Call `resolve` |
| `GATEWAY` | gateway | Sign tree heads, `anchorRoot` | Resolve disputes |
| `ARBITER` | api | `resolve` | Be loaded by any other process |
| `GUARDIAN` | deployer | `pause`/`unpause` | Be the arbiter |

Rules: separate keys per role even on testnet; all demo keys are throwaway and generated by `pnpm seed` for local runs; private keys are read only from environment variables at process start; never log them; never commit `.env`. Mainnet use is out of scope.

## 4. Contract invariants (must hold; encode as Foundry invariant tests)

1. Sum of tokens held by the escrow equals the sum of `amount` over escrows in `Held` or `Disputed`.
2. For each mandate, cumulative `spent` never exceeds `totalBudget`, and each escrow `amount` never exceeds `maxPricePerCall`.
3. State transitions only follow `Created -> Held -> Released` and `Held -> Disputed -> Refunded | Released`; terminal states never change.
4. A token leaves the escrow only through `release` (to the merchant) or `resolve` (to the owner or merchant); never to the agent.
5. `resolve` and `anchorRoot` callable only by their roles; `createEscrow` only by the mandate's agent; `dispute` only by the mandate owner within the window.
6. A mandate nonce is used at most once per owner.
7. While paused, no state-changing call except `unpause` succeeds.
8. Reputation counters only increase.

Also required: fuzz tests on amounts, budgets and timestamps; a malicious/reentrant token mock; tests for every custom error in `docs/04` section 1.

## 5. Application security requirements

- **Input validation:** every HTTP body, header set and LLM output is parsed with zod. Reject unknown or oversized input. Never `eval`, never build shell commands or SQL from input (use prepared statements).
- **LLM safety:** no tool use or network access for the extractor or judge; fixed prompts versioned in `prompts/`; temperature and seed pinned; output must pass schema validation, else `needs_human_review` (`model_error`). Never put merchant text, owner reasons or log contents into a prompt as instructions.
- **Authentication (MVP):** the API trusts the dashboard wallet signature for mandate and dispute actions and a shared secret for service-to-service calls (`INTERNAL_API_TOKEN`). The gateway accepts agent traffic by `X-Agent-Address` bound to a mandate; stronger auth is roadmap.
- **Transport:** localhost or HTTPS only outside local dev; CORS restricted to the dashboard origin.
- **Rate limits and bounds:** max body size, max log entries per request, per-agent request rate, bounded model timeouts.
- **Logging:** pino structured logs with redaction of keys, tokens and raw bodies; evidence blobs are not logged.
- **Dependencies:** commit the lockfile, pin versions, run `pnpm audit --prod` and `forge` build with warnings as errors in CI.

## 6. Privacy and data handling

- Data in logs: request paths and query strings, response bodies, agent and merchant addresses, timestamps. Treat query strings and bodies as potentially personal.
- Minimisation: the arbiter receives only the disclosed fields it needs; models run locally so content does not leave the machine.
- On-chain: only hashes, roots, amounts, addresses and outcomes. Never raw content or reasons (only `reasonHash`).
- Retention: demo data is wiped by `pnpm demo:reset`; no retention policy exists for the MVP.
- Open item (PRD section 16.5): GDPR, India DPDP and EU AI Act obligations are not assessed. Do not use real personal data in the demo. This is not legal advice.

## 7. Security acceptance checklist (before the demo freeze)

- [ ] All invariants in section 4 pass (`forge test` with invariants enabled, at least 256 runs).
- [ ] Slither run on `contracts/`: no high or medium findings unresolved or explained in `docs/DECISIONS.md`.
- [ ] Reentrancy mock test passes for `release` and `resolve`.
- [ ] Injection benchmark category run; result reported honestly.
- [ ] Tamper test fails the verifier in the browser and in unit tests.
- [ ] No secrets in git history (`git log -p | grep -i private_key` is empty; secret scanner clean).
- [ ] Gateway cannot proxy to a host outside the merchant registry.
- [ ] Stated limits (T6, T8, T18) appear in the pitch.

## 8. Incident handling (demo and testnet)

1. Suspicious behaviour or a wrong verdict: call `pause()` with the guardian key.
2. Preserve `data/` and `deployments/` before any reset.
3. Record what happened, the evidence bundle and commitment in `docs/DECISIONS.md`.
4. Rotate any key that may have been exposed; redeploy on testnet if the arbiter or gateway key leaked.

## 9. Responsible disclosure

This is a hackathon prototype with no production deployment. Report issues to the maintainers privately (repository owner) before posting publicly.
