import { Link } from "react-router-dom";
import type { Verdict } from "../lib/types";
import { Hash } from "./Copy";

/** Every claim links to the log entries it cites (docs/06 section 3). */
export function VerdictCard({
  verdict,
  requestId,
  resolveTx,
}: {
  verdict: Verdict;
  requestId: string;
  resolveTx: string | null;
}) {
  const needsReview = verdict.outcome === null;
  return (
    <section className="card" aria-label="Verdict">
      <h2>
        {needsReview ? (
          <span className="warn">Needs human review</span>
        ) : (
          <>
            <span className={verdict.outcome === "REFUND" ? "bad" : "ok"}>{verdict.outcome}</span>
            {" · fault: "}
            {verdict.fault}
          </>
        )}
      </h2>
      {verdict.injection_detected && (
        <p role="note" className="warn">
          <strong>Injection attempt detected:</strong> the merchant's response tried to instruct the
          arbiter. It was treated as data and did not influence this verdict.
        </p>
      )}
      <table>
        <tbody>
          <tr>
            <th>Class</th>
            <td>{verdict.class_name ?? "none"}</td>
          </tr>
          <tr>
            <th>Decided by</th>
            <td>{verdict.decided_by}</td>
          </tr>
          {verdict.review_reason && (
            <tr>
              <th>Review reason</th>
              <td>{verdict.review_reason}</td>
            </tr>
          )}
        </tbody>
      </table>
      <h3>Claims</h3>
      {verdict.claims.length === 0 ? (
        <p className="muted">No claims.</p>
      ) : (
        <ul>
          {verdict.claims.map((c, i) => (
            <li key={i}>
              {c.text}{" "}
              {c.cites.map((n) => (
                <Link key={n} to={`/timeline/${requestId}#seq-${n}`} className="mono">
                  [entry {n}]
                </Link>
              ))}
            </li>
          ))}
        </ul>
      )}
      <h3>Explanation</h3>
      <p>{verdict.explanation || <span className="muted">none</span>}</p>
      <p>
        Verdict commitment: <Hash value={verdict.commitment} />
        {resolveTx && (
          <>
            {" "}
            · resolve tx <Hash value={resolveTx} />
          </>
        )}
      </p>
    </section>
  );
}
