import { useState } from "react";
import { ReputationPanel } from "../components/ReputationPanel";
import { config } from "../lib/config";

const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);

export function ReputationPage() {
  const [custom, setCustom] = useState("");
  return (
    <>
      <h1>Reputation</h1>
      <p>
        Counters are kept by the escrow contract: every resolved dispute adds to the disputes count,
        and a verdict that finds fault adds to the faults count. Set a baseline before a demo run to
        see the change.
      </p>
      <ReputationPanel title="Merchant" address={config.merchant} />
      <ReputationPanel title="Agent" address={config.agent} />
      <label htmlFor="addr">Look up another address</label>
      <input
        id="addr"
        className="mono"
        value={custom}
        onChange={(e) => setCustom(e.target.value.trim())}
        placeholder="0x…"
      />
      {custom && !isAddress(custom) && <p className="bad">Not a valid address.</p>}
      {isAddress(custom) && <ReputationPanel title="Address" address={custom} />}
    </>
  );
}
