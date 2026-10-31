# Pitch outline and rehearsal answers

Working draft for P3-09. Sources: `docs/01` (problem, novelty, limits), `docs/05` (demo script, section 8 questions), `docs/08` section 5 (benchmark). Wording rules: say "tamper-evident", never "tamper-proof"; testnet only; **no benchmark number goes on a slide until `pnpm bench` has produced it with pinned models (requirement B3)**. Fill the `[ ]` placeholders from `/bench`, never from memory.

## 1. Slides (about 8, 3 minutes of talking plus the live demo)

| # | Slide | One-line message | Evidence on the slide |
|---|---|---|---|
| 1 | Title | Recourse: pay-per-call with a money-back guarantee for AI agents | name, "testnet" tag |
| 2 | Problem | Agents spend money on their own; when a call goes wrong nobody can prove what happened or get the money back | one concrete story (wrong or stale data bought by an agent) |
| 3 | Solution loop | Prevent (mandate the contract enforces), record (outside the agent), decide (rules first, AI for meaning), recover (automatic refund) | the four-step diagram from `docs/ARCHITECTURE.md` |
| 4 | Live demo | see section 2 | the dashboard itself |
| 5 | Why it can be trusted | rules decide what code can check; AI only reads meaning and must cite log entries; merchant text is data, not instructions | the injection scene result |
| 6 | Measured | full system (3-judge quorum): merchant wrongly refunded 2 of 65 (3.1%, 95% CI 0.8 to 10.5%) against 11 of 65 (16.9%) with a single judge; injection resistance 19 of 20; accuracy 189 of 200 against 154 of 200 for the default-to-release baseline (+17.5 points, +30.5 on the semantic categories). 200 synthetic cases from our own generator (seed 1) plus 20 paired controls, so say so on the slide; one weak spot, implausible values (1 of 10), falls to human review. Source: D-027 run, regenerate with `pnpm bench -- --config all` | `/bench` screenshot |
| 7 | Honest limits | trust window before anchoring, single arbiter key, refunds only inside the window, digital goods first (`docs/01` section 7) | the list, unedited |
| 8 | Market and ask | who pays (teams running agent fleets), fee on protected spend (a hypothesis), validation so far `[ ]` quotes, `[ ]` calls | only what the validation log supports |

Do not claim as novel: hash chains, Merkle trees, escrow contracts, LLM judges individually (`docs/01` section 5). Do claim: prevention and recovery in one loop, evidence captured outside the agent with merchant-signed receipts, injection-resistant arbitration, a measured benchmark, a four-way verdict.

## 2. Live demo (3 minutes, `docs/05` section 2)

Run `pnpm demo:reset` first and watch `pnpm demo` pass before going on stage. Scenes: mandate, happy path and over-cap block, hard failure (rules), semantic failure (AI), injection, buyer regret, tamper test on the Verify page, reputation close. Each narration line is in `docs/05`.

Status of the scenes on the current `dev` (re-check before every rehearsal):
- Passing without a model: mandate, happy path, over-cap, hard failure (scene 2), tamper test, final release.
- Needs a pinned model that follows the judge prompt: scenes 3, 4, 5 and the reputation check in 7. With `qwen:7b` as judge they fall to human review or the wrong class, so do not demo them until spike S3 (P2-01) is done and `pnpm demo` is 9 of 9.

Fallback if the model or Ollama fails on stage: show the stored verdict for the scene and say so (the replay badge must stay visible, `DEMO_REPLAY`); never hide a replay.

## 3. Rehearsal questions

Short answers; the first six are from `docs/05` section 8.

1. **Why blockchain?** Neutral escrow when agent and merchant do not trust each other and no bank sits between them; anchors and verdict commitments cannot be backdated; limits are enforced by the contract, not by a promise.
2. **Why not signed logs and a normal escrow?** A signed log cannot hold or move money and cannot prove when it existed.
3. **What if the gateway lies or is bypassed?** There is a stated trust window before anchoring; merchant-signed receipts give a second source; witnesses and TEEs are roadmap. We do not claim to prove nothing bypassed the gateway.
4. **Isn't the AI just a wrapper?** Show the rules-only versus rules-plus-AI ablation and where each decides; lead with the false-refund rate, then AI lift, both with counts.
5. **What if the arbiter is biased or wrong?** Single key in the MVP; every verdict is committed on-chain with prompt and model hashes so it can be replayed; abstentions go to a human; appeals through Kleros or GenLayer are roadmap.
6. **Who pays and why?** Teams running agent fleets with real budgets, as a fee on protected spend. That is a hypothesis; say what the validation log actually shows.
7. **Can the merchant just prompt-inject the judge?** Merchant text and the owner's reason go only to the extractor, which outputs structured facts; the judge never sees free text; every claim must cite a log entry or the verdict becomes needs-human-review. Show scene 4 and the injection-resistance count.
8. **What stops the agent from lying about what it bought?** The gateway records requests and responses itself and the merchant signs receipts; the agent's own rationale is logged but marked agent-claimed.
9. **How is this different from GenLayer's Internet Court / Kleros?** They arbitrate; Recourse also prevents (mandate enforced on-chain) and captures evidence outside the agent. Say we have not verified their current feature set before the event; check `docs/01` section 4.
10. **What happens to a refund after the window?** There is no clawback in the MVP; a merchant bond is roadmap. Be direct about it.
11. **Is this real money?** No. Testnet only, mock USDC locally.

## 4. Pre-stage checklist

- `pnpm demo:reset`, then `pnpm demo` three times in a row, all scenes passing.
- `/bench` shows a stored run with pinned model names and the prompt hash; slide 6 numbers match it exactly.
- Dashboard open on the Mandate page, wallet on the right chain, `API_ADMIN_TOKEN` set.
- Ollama running with the pinned models pulled; a fallback plan for scenes 3 to 5.
- Slides use "tamper-evident", show "testnet", and contain no number that is not on `/bench` or in the validation log.
