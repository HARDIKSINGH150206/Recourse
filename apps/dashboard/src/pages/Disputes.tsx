import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { request } from "../lib/api";
import { config } from "../lib/config";
import type { Dispute } from "../lib/types";

export function DisputesPage() {
  const q = useQuery({
    queryKey: ["disputes"],
    queryFn: () => request<{ disputes: Dispute[] }>(config.apiUrl, "/disputes?limit=100"),
    refetchInterval: 2000,
  });
  return (
    <>
      <h1>Disputes</h1>
      {q.error && <p className="bad">Cannot load disputes from the API.</p>}
      {q.data?.disputes.length === 0 && <p className="muted">No disputes yet.</p>}
      <table>
        <thead>
          <tr>
            <th>Opened</th>
            <th>Status</th>
            <th>Outcome</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {q.data?.disputes.map((d) => (
            <tr key={d.dispute_id}>
              <td>{new Date(d.created_at * 1000).toLocaleTimeString()}</td>
              <td>{d.status}</td>
              <td>{d.verdict?.outcome ?? d.review?.outcome ?? ""}</td>
              <td>
                <Link to={`/disputes/${d.dispute_id}`}>Open</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
