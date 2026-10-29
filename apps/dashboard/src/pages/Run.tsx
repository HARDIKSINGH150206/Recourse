import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { StepList } from "../components/StepList";
import { Hash } from "../components/Copy";
import { useNotifyError } from "../components/Toast";
import { post, request } from "../lib/api";
import { config } from "../lib/config";
import type { Run, ScenarioInfo } from "../lib/types";
import { MANDATE_KEY } from "./Mandate";

const FINAL = new Set(["completed", "blocked", "failed"]);

const savedMandate = (): string | undefined => {
  try {
    return sessionStorage.getItem(MANDATE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};

export function RunPage() {
  const notify = useNotifyError();
  const [runId, setRunId] = useState<string | null>(null);

  const scenarios = useQuery({
    queryKey: ["scenarios"],
    queryFn: () => request<{ scenarios: ScenarioInfo[] }>(config.agentUrl, "/scenarios"),
  });
  const health = useQuery({
    queryKey: ["agent-health"],
    queryFn: () => request<{ can_dispute: boolean }>(config.agentUrl, "/health"),
  });

  const start = useMutation({
    mutationFn: (id: string) =>
      post<{ run_id: string }>(
        config.agentUrl,
        `/scenarios/${id}/run`,
        savedMandate() ? { mandate_id: savedMandate() } : {},
      ),
    onSuccess: (r) => setRunId(r.run_id),
    onError: notify,
  });

  // Poll every 2 seconds until the run reaches a final status (docs/06 section 1.6).
  const run = useQuery({
    queryKey: ["run", runId],
    enabled: runId !== null,
    queryFn: () => request<Run>(config.agentUrl, `/runs/${runId}`),
    refetchInterval: (q) => (q.state.data && FINAL.has(q.state.data.status) ? false : 2000),
  });

  const dispute = useMutation({
    mutationFn: (reason: string) =>
      post(config.agentUrl, `/runs/${runId}/dispute`, { reason_text: reason }),
    onSuccess: () => void run.refetch(),
    onError: notify,
  });

  const r = run.data;
  return (
    <>
      <h1>Run</h1>
      <p>Start a scripted agent scenario and watch each step.</p>
      {scenarios.error && (
        <p role="alert" className="bad">
          Cannot load scenarios from the demo agent at {config.agentUrl}.
        </p>
      )}
      <table>
        <tbody>
          {scenarios.data?.scenarios.map((s) => (
            <tr key={s.id}>
              <td>
                <code>{s.id}</code>
              </td>
              <td>{s.description}</td>
              <td>
                <button type="button" disabled={start.isPending} onClick={() => start.mutate(s.id)}>
                  Run
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {r && (
        <section className="card" aria-live="polite">
          <h2>
            {r.scenario} · <span className={r.status === "failed" ? "bad" : ""}>{r.status}</span>
          </h2>
          {r.reverted && (
            <p className="warn">
              Contract refused the payment: <code>{r.reverted}</code>
            </p>
          )}
          {r.error && <p className="bad">{r.error}</p>}
          <StepList steps={r.steps} />
          {r.escrow_id && (
            <p>
              Escrow <Hash value={r.escrow_id} />
              {r.request_id && (
                <>
                  {" "}
                  · request <Hash value={r.request_id} />
                </>
              )}
            </p>
          )}
          {r.dispute && (
            <p>
              Dispute: <strong>{r.dispute.status}</strong>
            </p>
          )}
          {r.escrow_id && !r.dispute && health.data?.can_dispute && (
            <button
              type="button"
              className="secondary"
              disabled={dispute.isPending}
              onClick={() => dispute.mutate("The response is not what I paid for.")}
            >
              Dispute this payment
            </button>
          )}
        </section>
      )}
    </>
  );
}
