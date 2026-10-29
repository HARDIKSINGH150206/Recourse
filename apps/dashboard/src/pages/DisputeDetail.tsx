import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { VerdictCard } from "../components/VerdictCard";
import { EscrowCard } from "../components/EscrowCard";
import { request } from "../lib/api";
import { config } from "../lib/config";
import type { Dispute } from "../lib/types";

const FINAL = new Set(["resolved", "needs_human_review", "failed"]);

export function DisputeDetailPage() {
  const { id = "" } = useParams();
  const q = useQuery({
    queryKey: ["dispute", id],
    queryFn: () => request<Dispute>(config.apiUrl, `/disputes/${encodeURIComponent(id)}`),
    refetchInterval: (query) =>
      query.state.data && FINAL.has(query.state.data.status) ? false : 2000,
  });
  const d = q.data;
  if (q.error) return <p className="bad">Cannot load this dispute.</p>;
  if (!d) return <p className="muted">Loading…</p>;
  return (
    <>
      <h1>Dispute</h1>
      <p>
        Status: <strong>{d.status}</strong>
        {d.note && <span className="muted"> · {d.note}</span>} ·{" "}
        <Link to={`/timeline/${d.request_id}`}>Timeline</Link> ·{" "}
        <Link to={`/verify/${d.request_id}`}>Verify</Link>
      </p>
      {d.reason_text && (
        <blockquote>
          <strong>Owner's reason:</strong> {d.reason_text}
        </blockquote>
      )}
      <EscrowCard escrowId={d.escrow_id} />
      {d.verdict ? (
        <VerdictCard verdict={d.verdict} requestId={d.request_id} resolveTx={d.txs.resolve} />
      ) : d.review ? (
        <section className="card">
          <h2>Human review: {d.review.outcome}</h2>
          <p>
            Fault: {d.review.fault}. {d.review.note}
          </p>
        </section>
      ) : (
        <p className="muted">No verdict yet.</p>
      )}
    </>
  );
}
