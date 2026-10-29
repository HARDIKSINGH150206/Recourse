import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { EscrowCard } from "../components/EscrowCard";
import { Hash } from "../components/Copy";
import { request } from "../lib/api";
import { config } from "../lib/config";
import type { LogEntryRow } from "../lib/types";

export function TimelinePage() {
  const { requestId = "" } = useParams();
  const entries = useQuery({
    queryKey: ["entries", requestId],
    queryFn: () =>
      request<{ entries: LogEntryRow[] }>(
        config.gatewayUrl,
        `/log/entries?request_id=${encodeURIComponent(requestId)}`,
      ),
    refetchInterval: 2000,
  });
  // The evidence bundle names the escrow; it may not exist until the payment is logged.
  const bundle = useQuery({
    queryKey: ["bundle-escrow", requestId],
    queryFn: () => request<{ escrow_id: string }>(config.gatewayUrl, `/evidence/${requestId}`),
    retry: false,
  });

  return (
    <>
      <h1>Timeline</h1>
      <p>
        Request <Hash value={requestId} /> ·{" "}
        <Link to={`/verify/${requestId}`}>Verify this evidence</Link>
      </p>
      {bundle.data && <EscrowCard escrowId={bundle.data.escrow_id} />}
      {entries.error && <p className="bad">Cannot load entries from the gateway.</p>}
      <table>
        <thead>
          <tr>
            <th>Seq</th>
            <th>Time</th>
            <th>Type</th>
            <th>Entry hash</th>
          </tr>
        </thead>
        <tbody>
          {entries.data?.entries.map((e) => (
            <tr key={e.seq} id={`seq-${e.seq}`}>
              <td>{e.seq}</td>
              <td>{new Date(e.ts * 1000).toLocaleTimeString()}</td>
              <td>{e.type}</td>
              <td>
                <Hash value={e.entry_hash} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
