import { CONFIG_IDS, fmtRate, type BenchRun } from "../lib/bench";

/** Accuracy per configuration as bars, with the count in the label. Bars are text-labelled. */
export function BenchChart({ run }: { run: BenchRun }) {
  return (
    <figure aria-label="Overall accuracy by configuration" style={{ margin: 0 }}>
      {CONFIG_IDS.map((id) => {
        const r = run.results.configs[id]?.overall_accuracy;
        if (!r) return null;
        return (
          <div key={id} className="bar-row">
            <span className="bar-label">{id}</span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${(r.rate ?? 0) * 100}%` }} />
            </span>
            <span className="bar-value">{fmtRate(r)}</span>
          </div>
        );
      })}
      <figcaption className="muted">Abstentions count as wrong in overall accuracy.</figcaption>
    </figure>
  );
}
