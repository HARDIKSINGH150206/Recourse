import type { CheckState } from "../lib/verify";

const TEXT: Record<CheckState, string> = { pass: "✓ pass", fail: "✗ fail", pending: "… not run" };
const CLASS: Record<CheckState, string> = { pass: "ok", fail: "bad", pending: "muted" };

/** Pass, fail or pending: always text plus a symbol, never colour alone (docs/06 section 3). */
export function CheckChip({ label, state }: { label: string; state: CheckState }) {
  return (
    <li className={`chip ${CLASS[state]}`}>
      <strong>{TEXT[state]}</strong> {label}
    </li>
  );
}
