import type { RunStep } from "../lib/types";
import { Hash } from "./Copy";

export function StepList({ steps }: { steps: RunStep[] }) {
  if (steps.length === 0) return <p className="muted">No steps yet.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Step</th>
          <th>Result</th>
          <th>Log seq</th>
          <th>Tx</th>
          <th>Detail</th>
        </tr>
      </thead>
      <tbody>
        {steps.map((s, i) => (
          <tr key={`${s.name}-${i}`}>
            <td>{s.name}</td>
            <td className={s.ok ? "ok" : "bad"}>{s.ok ? "✓ ok" : "✗ failed"}</td>
            <td>{s.seq ?? ""}</td>
            <td>{s.tx ? <Hash value={s.tx} /> : ""}</td>
            <td>{s.detail ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
