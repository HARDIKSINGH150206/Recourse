import type { AdjudicationInput, Adjudicator, ExtractedFacts, Verdict } from "@recourse/shared";
import { LlmError, type Llm } from "@recourse/llm";
import { decide, runRules } from "@recourse/rules-engine";
import { entryTypes } from "./citations.js";
import { loadAliasTable, loadModelsConfig, type ModelsConfig } from "./config.js";
import { entriesOf, prepare } from "./evidence.js";
import { extractFacts } from "./extract.js";
import { entryViews, runJudge, sanitizeFacts } from "./judge.js";
import { loadPrompts } from "./prompts.js";
import { toVote, tally, type Vote } from "./quorum.js";
import { decidedVerdict, reviewVerdict, type Ctx } from "./verdict.js";

export interface AdjudicatorOptions {
  llm: Llm;
  /** Defaults to `config/models.json`. */
  models?: ModelsConfig;
  /** Defaults to `config/alias-table.json`. */
  aliasTable?: Record<string, string[]>;
}

/**
 * The adjudication pipeline (docs/08 section 1). Step 1 (verifyBundle) already ran: its report is
 * in `input.evidence_report`. Steps: rules, extractor, judge, citation check, commitment. A model
 * failure or an unusable output ends in `needs_human_review`, never in a guess.
 */
export async function adjudicate(
  input: AdjudicationInput,
  opts: AdjudicatorOptions,
): Promise<Verdict> {
  const cfg = opts.models ?? loadModelsConfig();
  const prompts = loadPrompts();
  const prepared = prepare(input, opts.aliasTable ?? loadAliasTable());
  const rules = runRules(prepared.ruleInput);
  const ctx: Ctx = { input, cfg, promptHash: prompts.hash, rules, facts: null, models: [] };

  const decision = decide(rules);
  if (decision?.kind === "review") return reviewVerdict(ctx, decision.reason);
  if (prepared.incomplete) return reviewVerdict(ctx, "evidence_incomplete");
  if (decision?.kind === "verdict") {
    return decidedVerdict(ctx, {
      class: decision.class,
      outcome: decision.outcome,
      fault: decision.fault,
      decided_by: "rules",
      claims: [{ text: decision.reason, cites: decision.cites }],
      explanation: decision.reason,
    });
  }

  // No rule was decisive: the AI stage decides meaning only.
  let facts: ExtractedFacts;
  try {
    facts = await extractFacts(opts.llm, cfg, prompts.extractor, {
      requestedCity: prepared.requestedCity,
      bodyText: prepared.bodyText,
      reasonText: input.reason_text,
    });
  } catch (err) {
    if (err instanceof LlmError) return reviewVerdict(ctx, "model_error");
    throw err;
  }
  ctx.facts = facts;

  // Judges run one after another to fit local hardware (docs/08 section 4.5).
  const judgeInput = {
    terms: input.mandate.terms,
    rules,
    facts: sanitizeFacts(facts),
    entries: entryViews(input, entriesOf(input).mine),
  };
  const types = entryTypes(input);
  const votes: Vote[] = [];
  try {
    ctx.models = [
      {
        role: "extractor",
        name: cfg.extractor.name,
        version: await opts.llm.modelVersion(cfg.extractor.name),
      },
    ];
    for (const j of cfg.judges) {
      ctx.models.push({
        role: "judge",
        name: j.name,
        version: await opts.llm.modelVersion(j.name),
      });
      try {
        votes.push(toVote(await runJudge(opts.llm, cfg, j.name, prompts.judge, judgeInput), types));
      } catch (err) {
        if (!(err instanceof LlmError)) throw err;
        votes.push({ kind: "error" });
      }
    }
  } catch (err) {
    if (err instanceof LlmError) return reviewVerdict(ctx, "model_error");
    throw err;
  }

  const result = tally(votes);
  if (!result.ok) return reviewVerdict(ctx, result.reason);
  const { judge, claims } = result.winner;
  return decidedVerdict(ctx, {
    class: judge.class,
    outcome: judge.outcome,
    fault: judge.fault,
    decided_by: cfg.judges.length > 1 ? "ai_quorum" : "ai",
    claims,
    explanation: judge.explanation.slice(0, 1000),
  });
}

/** The shape `apps/api` consumes (`Adjudicator` in @recourse/shared), with the options bound. */
export function createAdjudicator(opts: AdjudicatorOptions): Adjudicator {
  return { adjudicate: (input) => adjudicate(input, opts) };
}
