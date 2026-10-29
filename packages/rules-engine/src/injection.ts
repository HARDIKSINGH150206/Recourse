/**
 * R8 heuristic (docs/08 section 3): instruction-like text in a response body. Never decisive; the
 * result is recorded and passed to the judge as a boolean. It is a tripwire, not a defence: the
 * real defence is that the judge never sees raw merchant text.
 */
const PATTERNS: RegExp[] = [
  /\bignore\s+(all\s+|any\s+|the\s+|your\s+)?(previous|prior|above|earlier)\b/i,
  /\bdisregard\b/i,
  /\b(system|assistant|developer)\s*:/i,
  /<\/?\s*(system|instructions?)\s*>/i,
  /\b(release|send|transfer)\s+(the\s+|all\s+)?(funds|payment|money)\b/i,
  /\brefund\s+(me|the\s+(buyer|merchant|agent))\b/i,
  /\b(arbiter|adjudicator|judge)\b/i,
  /\byou\s+(must|should|are\s+to)\b/i,
  /\bnew\s+instructions?\b/i,
];

export function looksLikeInjection(text: string | undefined): boolean {
  if (!text) return false;
  return PATTERNS.some((p) => p.test(text));
}
