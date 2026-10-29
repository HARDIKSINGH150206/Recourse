import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { escrowAbi, ESTATES } from "@recourse/chain";
import type { Hex } from "viem";
import { config } from "../lib/config";
import { publicClient } from "../lib/wallet";
import { Hash } from "./Copy";

/** Escrow state read straight from the contract, with a countdown to the end of the dispute window. */
export function EscrowCard({ escrowId }: { escrowId: string }) {
  const { data, error } = useQuery({
    queryKey: ["escrow", escrowId],
    queryFn: () =>
      publicClient.readContract({
        address: config.escrow as Hex,
        abi: escrowAbi,
        functionName: "escrows",
        args: [escrowId as Hex],
      }),
    refetchInterval: 2000,
  });
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  if (error) return <p className="bad">Cannot read the escrow from the chain.</p>;
  if (!data) return <p className="muted">Reading escrow…</p>;
  const state = ESTATES[data.state] ?? "None";
  const left = Number(data.windowEnds) - now;
  return (
    <section className="card" aria-label="Escrow">
      <h3>
        Escrow · <span data-state={state}>{state}</span>
      </h3>
      <table>
        <tbody>
          <tr>
            <th>Id</th>
            <td>
              <Hash value={escrowId} />
            </td>
          </tr>
          <tr>
            <th>Amount</th>
            <td>{data.amount.toString()} token units</td>
          </tr>
          <tr>
            <th>Merchant</th>
            <td>
              <Hash value={data.merchant} />
            </td>
          </tr>
          {state === "Held" && (
            <tr>
              <th>Dispute window</th>
              <td>{left > 0 ? `${left}s left` : "closed, ready to release"}</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
