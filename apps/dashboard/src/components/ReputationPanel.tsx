import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { request } from "../lib/api";
import { config } from "../lib/config";
import { delta, loadBaseline, saveBaseline, signed } from "../lib/baseline";
import type { Reputation } from "../lib/types";
import { Hash } from "./Copy";

/** Counters read from the contract via the API, with change since the saved baseline. */
export function ReputationPanel({ title, address }: { title: string; address: string }) {
  const [base, setBase] = useState<Reputation | null>(() => loadBaseline(address));
  const q = useQuery({
    queryKey: ["reputation", address],
    queryFn: () => request<Reputation>(config.apiUrl, `/reputation/${address}`),
    refetchInterval: 2000,
    enabled: address !== "",
  });
  const r = q.data;
  if (!address) return null;

  const rows = r
    ? ([
        ["As agent", r.as_agent, base?.as_agent ?? null],
        ["As merchant", r.as_merchant, base?.as_merchant ?? null],
      ] as const)
    : [];
  return (
    <section className="card" aria-label={title}>
      <h2>{title}</h2>
      <p>
        <Hash value={address} />
      </p>
      {q.error && <p className="bad">Cannot read reputation from the API.</p>}
      {r && (
        <table>
          <thead>
            <tr>
              <th>Role</th>
              <th>Disputes</th>
              <th>Faults</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([role, now, b]) => {
              const d = delta(now, b);
              return (
                <tr key={role}>
                  <th>{role}</th>
                  <td>
                    {now.disputes}
                    {b && <span className="muted"> ({signed(d.disputes)})</span>}
                  </td>
                  <td>
                    {now.faults}
                    {b && <span className="muted"> ({signed(d.faults)})</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {r && (
        <p>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              saveBaseline(address, r);
              setBase(r);
            }}
          >
            {base ? "Reset baseline to now" : "Set baseline to now"}
          </button>
        </p>
      )}
    </section>
  );
}
