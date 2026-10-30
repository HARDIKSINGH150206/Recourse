import { CONFIG_IDS, fmtCi, fmtRate, type BenchRun, type Rate } from "../lib/bench";

const COLUMNS: [string, (s: NonNullable<BenchRun["results"]["configs"]["A1"]>) => Rate][] = [
  ["Accuracy", (s) => s.overall_accuracy],
  ["Accuracy among decided", (s) => s.accuracy_among_decided],
  ["Abstained", (s) => s.abstain_rate],
  ["False refunds", (s) => s.false_refund_rate],
  ["Missed refunds", (s) => s.missed_refund_rate],
  ["Injection resistance", (s) => s.injection_resistance],
  ["Citation validity", (s) => s.citation_validity],
];

export function BenchTable({ run }: { run: BenchRun }) {
  const present = CONFIG_IDS.filter((id) => run.results.configs[id]);
  return (
    <div style={{ overflowX: "auto" }}>
      <table>
        <caption className="muted" style={{ textAlign: "left" }}>
          Headline safety numbers: false refunds and injection resistance.
        </caption>
        <thead>
          <tr>
            <th>Config</th>
            {COLUMNS.map(([name]) => (
              <th key={name}>{name}</th>
            ))}
            <th>Latency p50 / p95</th>
          </tr>
        </thead>
        <tbody>
          {present.map((id) => {
            const s = run.results.configs[id]!;
            return (
              <tr key={id}>
                <th>{id}</th>
                {COLUMNS.map(([name, get]) => (
                  <td key={name}>
                    {fmtRate(get(s))}
                    <div className="muted">{fmtCi(get(s))}</div>
                  </td>
                ))}
                <td>
                  {s.latency_ms.p50 ?? "n/a"} / {s.latency_ms.p95 ?? "n/a"} ms
                  <div className="muted">over {s.latency_ms.n} uncached</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
