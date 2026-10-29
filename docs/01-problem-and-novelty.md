# 01: Problem and novelty

Pitch context for the team and for anyone reading the repo cold. Numbers here are directional; re-check before putting them on slides.

## 1. The problem in plain terms

AI agents can now pay for APIs and data on their own. When an agent pays wrongly, three things are missing:

1. **Proof.** The agent's own log is often the only record, and agents can delete or edit their own logs.
2. **A judge.** Nobody can tell whether the agent broke its limits, chose badly within them, the merchant failed to deliver, or the buyer changed their mind. Card chargeback codes cannot separate these cases.
3. **A refund.** Crypto (stablecoin) payments have no chargeback. The agent company, merchant, bank and user each blame the others.

Result: people do not give agents wallets.

Everyday comparison: hiring someone to shop for you with a written list and budget (mandate), a CCTV camera they do not control (gateway), a trusted third person holding the money (escrow), a fair judge (adjudicator) and an automatic refund (contract).

## 2. Who feels it

- **Teams running agents with real budgets** (first customer): need spend limits, audit and a way to recover wrong spend.
- **API merchants selling to agents**: want a trusted signal, clear dispute rules and receipts that win unwinnable disputes.
- **Agent platforms**: blamed for every mistake; want bounded liability.

## 3. Why now (market reality, with caveats)

- x402 (HTTP 402 payments with stablecoins, backed by Coinbase and Cloudflare) handled about 75M transactions worth roughly $24M over 30 days in mid-2026, mostly sub-dollar. Chainalysis reports over 87% of payments are under 10 cents.
- TRM Labs reports most x402 volume is not agentic and agent volume is small (roughly USD 5,000 to 11,000 a month in its analysis). Another analysis suggests about half of volume was testing. Sources disagree and use different definitions.
- x402 itself has no mandate, authority or dispute mechanism. Card-side standards (AP2, Verifiable Intent, Visa Trusted Agent Protocol, Mastercard Agent Pay) provide evidence and identity, not a resolution process.
- Vendor surveys (Salt Security, EMA/Cequence; from the original handoff, not re-verified by us) report that roughly half of firms saw an agent take an unauthorised action and that few can trace a full agent path. Both are vendor-run and self-reported.
- A 2026 preprint ("LLM Agents Can Easily Tamper With Their Own Traces") reports agents can delete their own traces. Takeaway used in this project: **logs an agent can write, it can erase**, so evidence must be captured outside the agent.

**Implication:** the market is early. The pitch is infrastructure ahead of volume. Because average payments are cents, a per-call AI verdict costs more than the payment; micro payments need batched SLA credits (roadmap) and mid-size payments need escrow plus adjudication.

## 4. Existing solutions

| Player | What it does | Gap relative to Recourse |
|---|---|---|
| **GenLayer "Internet Court"** (July 2026, 26+ companies) | Agent dispute arbitration with escrow and payments | Closest competitor. Binding enforcement not confirmed. We position as the prevention and evidence layer that feeds courts like this. |
| Kleros | General on-chain arbitration | Not agent-specific; no mandate enforcement or evidence capture |
| Causa Prima ($20M seed) | AI agents resolving B2B billing disputes | B2B invoices, not agent spend enforcement |
| Casap ($25M Series A) | AI payment dispute automation | Card disputes for financial institutions |
| Ralio (pre-seed) | Agent payments infrastructure with verification and auditability | Payments rails focus |
| Chargeflow | Card chargeback tooling for merchants | Not crypto; does not execute refunds |
| AP2, Verifiable Intent, Visa TAP, Mastercard Agent Pay | Evidence and identity standards | Evidence, not resolution or liability |
| Hackathon projects (AgentCourt, Clawback, Docket Arbiter, Veridict, AI-Autonomous Escrow on Arc) | Same direction | Usually one slice; verify before the pitch |
| Agent log startups (TrustNotch, AgentStamp, Spanchain, others) | Tamper-evident agent audit logs | Recording only; no enforcement, verdict or refund |

## 5. What is novel (defensible claims only)

1. **Prevention and recovery in one loop:** a contract-enforced mandate (agent cannot overspend) plus automatic refund when something still goes wrong.
2. **Evidence captured outside the agent** with merchant-signed receipts, so neither side's own logs decide the case.
3. **Injection-resistant AI arbitration:** untrusted text goes only to an extractor; the judge sees structured facts; every claim cites a log entry; verdicts are committed on-chain so they can be replayed.
4. **Measured, not claimed:** a benchmark with false-refund rate, injection resistance and a rules-only vs rules-plus-AI ablation.
5. **Four-way verdict** (agent exceeded mandate, agent chose unreasonably, merchant failure, buyer regret) that card chargeback codes cannot express.

Not novel (do not claim): hash chains, Merkle trees, escrow contracts, LLM judges individually.

## 6. Why blockchain (rehearsed 20-second answer)

- The agent and merchant do not trust each other and no bank sits between them; a contract is the neutral holder of funds.
- Mandate timestamps, root anchors and verdict commitments cannot be backdated by either side.
- Spending limits are enforced by the contract, not by the agent's promise.

Expected pushback: "why not signed logs and a normal escrow?" Answer with the three points above and note that a signed log alone cannot move money or prove anchoring time.

## 7. Honest limits (state them in the pitch)

- The log proves what the gateway captured was not changed later; it does not prove the agent was right, nor that nothing bypassed the gateway.
- Between an event and its anchoring there is a **trust window** in which the gateway operator could alter data (see `docs/03` section 12).
- The arbiter is a single key in the MVP; mitigations are the verdict commitment and a pause role. Appeals via Kleros or GenLayer are roadmap.
- Refunds work only inside the dispute window (no clawback without a merchant bond; bond is roadmap).
- Nothing proves what a courier delivered; hence digital goods first.
- Testnet only. Not legal or financial advice. Payment and stablecoin rules differ by country.

## 8. Business hypotheses (guesses; test in interviews)

Fee on protected spend (about 0.5 to 2%), per-agent monthly subscription, merchant "guaranteed" badge, later insurer data. Moat candidates: dispute-outcome dataset, reliability scores, SDK distribution, AP2 and ERC-8004 compatibility. First customer: teams running agent fleets with real budgets.

14-day validation sprint (parallel to the build): 20 outreach messages, 8 calls, 3 written quotes, 2 merchants trying the receipt SDK, 1 letter of intent. Interview questions are in `docs/07-build-plan.md`.

## 9. Related event: Razorpay AI Buildathon (roadmap, not this build)

The core (mandate, evidence, verdict, reputation) is rail-agnostic. A Razorpay test-mode adapter (hold, refund, dispute) is a later swap of the settlement layer. See `docs/DECISIONS.md` (D-018).

## 10. Sources

- Chainalysis x402 figures: https://aiweekly.co/alerts/chainalysis-base-x402-agentic-payments-hit-138m-in-q3-with-87-under-10-cents
- x402 July 2026 volume (CoinDesk via LCX): https://lcx.com/nl/cryptonews/visa-mastercard-and-ripple-back-x402-as-agent-payments-average-32-cents
- TRM Labs, who is actually paying: https://www.trmlabs.com/trm-tech-blog/whos-actually-paying-measuring-ai-agent-payments-onchain
- x402 testing share: https://dev.to/feed/noxliehf
- GenLayer Internet Court: https://sociable.co/?p=101165 and https://coin360.com/news/27-institutions-internet-court-ai-agent-disputes
- Causa Prima: https://dealroom.co/news/161957-causa-prima-raises-20m-seed-to-let-ai-agents-settle-business-billing-dis/
- Casap: https://www.pymnts.com/?p=2904618
- Ralio: https://www.startupmag.co.uk/funding/ralio-2026-pre-seed-funding/
- Razorpay AI Buildathon: https://razorpay.com/buildathon/
- From the original handoff (not re-verified): Salt Security survey (https://www.prnewswire.com/news-releases/nearly-half-of-enterprises-report-an-ai-agent-took-an-unauthorized-action-last-year-salt-security-research-finds-302906338.html), EMA/Cequence survey (https://www.infosecurity-magazine.com/news/65-percent-enterprises-ai-agents/), tamper paper (https://arxiv.org/pdf/2609.30266), Chargeflow evidence playbook (https://www.chargeflow.io/blog/agentic-commerce-chargebacks-the-evidence-playbook-merchants-need), private.law agentic payments wiki (https://wiki.private.law/en/agentic-payments), EU AI Act Article 12 (https://artificialintelligenceact.eu/article/12/)
