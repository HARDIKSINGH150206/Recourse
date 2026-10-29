import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Address, Hex } from "viem";
import { MandateZones } from "../components/MandateZones";
import { Hash } from "../components/Copy";
import { useNotifyError } from "../components/Toast";
import { post } from "../lib/api";
import { config } from "../lib/config";
import { connect, registerOnChain, signMandate } from "../lib/wallet";
import type { CompileResponse } from "../lib/types";

const EXAMPLE = "Buy weather data for Mumbai, max 5 cents per call, 2 USDC total, for one day";

export const MANDATE_KEY = "recourse.mandateId";

export function MandatePage() {
  const notify = useNotifyError();
  const [text, setText] = useState(EXAMPLE);
  const [agent, setAgent] = useState(config.agent);
  const [merchant, setMerchant] = useState(config.merchant);
  const [owner, setOwner] = useState<Address | null>(null);
  const [compiled, setCompiled] = useState<CompileResponse | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [done, setDone] = useState<{ mandateId: Hex; registerTx: Hex } | null>(null);

  const connectWallet = useMutation({ mutationFn: connect, onSuccess: setOwner, onError: notify });

  const compile = useMutation({
    mutationFn: () =>
      post<CompileResponse>(config.apiUrl, "/mandates/compile", {
        text,
        owner: owner!.toLowerCase(),
        agent: agent.toLowerCase(),
        merchants: merchant ? [merchant.toLowerCase()] : [],
        chain_id: config.chainId,
        escrow: config.escrow.toLowerCase(),
        token: config.token.toLowerCase(),
      }),
    onSuccess: (c) => {
      setCompiled(c);
      setAnswers({});
      setConfirmed(false);
      setDone(null);
    },
    onError: notify,
  });

  const sign = useMutation({
    mutationFn: async (c: CompileResponse) => {
      const signature = await signMandate(owner!, c);
      await post(config.apiUrl, "/mandates", {
        mandate: c.mandate,
        terms: c.terms,
        merchants: c.merchants,
        signature,
        summary: c.summary,
      });
      return registerOnChain(owner!, c, signature);
    },
    onSuccess: (r) => {
      setDone({ mandateId: r.mandateId, registerTx: r.registerTx });
      try {
        sessionStorage.setItem(MANDATE_KEY, r.mandateId);
      } catch {
        /* storage can be blocked; the Run page falls back to the owner's latest mandate */
      }
    },
    onError: notify,
  });

  const unanswered = compiled?.questions.filter((q) => !answers[q.id]) ?? [];
  const configured = config.escrow !== "" && config.token !== "";
  const canCompile = owner && agent && text.trim() && configured && !compile.isPending;

  return (
    <>
      <h1>Mandate</h1>
      <p>
        Describe what your agent may buy. You review the limits, then sign. The escrow contract
        enforces them.
      </p>
      {!configured && (
        <p role="alert" className="bad">
          VITE_ESCROW_ADDRESS and VITE_TOKEN_ADDRESS are not set. Run <code>pnpm env:local</code>.
        </p>
      )}

      <label htmlFor="text">What may the agent buy?</label>
      <textarea id="text" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      <label htmlFor="agent">Agent address</label>
      <input id="agent" value={agent} onChange={(e) => setAgent(e.target.value.trim())} />
      <label htmlFor="merchant">Merchant address</label>
      <input id="merchant" value={merchant} onChange={(e) => setMerchant(e.target.value.trim())} />

      <p>
        {owner ? (
          <>
            Owner wallet: <Hash value={owner} />
          </>
        ) : (
          <button type="button" onClick={() => connectWallet.mutate()}>
            Connect wallet
          </button>
        )}
      </p>
      <button type="button" disabled={!canCompile} onClick={() => compile.mutate()}>
        {compile.isPending ? "Compiling…" : "Compile"}
      </button>

      {compiled && (
        <>
          <h2>Review</h2>
          <MandateZones c={compiled} />
          <section className="card" aria-labelledby="sum">
            <h3 id="sum">In plain English</h3>
            <p>{compiled.summary}</p>
          </section>

          {compiled.questions.map((q) => (
            <fieldset key={q.id} className="card">
              <legend>{q.text}</legend>
              <div className="chips">
                {q.options.map((o) => (
                  <button
                    key={o}
                    type="button"
                    className="secondary"
                    aria-pressed={answers[q.id] === o}
                    onClick={() => setAnswers({ ...answers, [q.id]: o })}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}

          <label>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            I have read the summary above and it matches what I want.
          </label>
          <p>
            <button
              type="button"
              disabled={unanswered.length > 0 || !confirmed || sign.isPending || done !== null}
              onClick={() => sign.mutate(compiled)}
            >
              {sign.isPending ? "Waiting for wallet…" : "Sign and register"}
            </button>
            {unanswered.length > 0 && (
              <span className="muted"> Answer {unanswered.length} question(s) first.</span>
            )}
          </p>
        </>
      )}

      {done && (
        <section className="card" role="status">
          <h3 className="ok">Mandate registered</h3>
          <p>
            Mandate id: <Hash value={done.mandateId} /> · tx <Hash value={done.registerTx} />
          </p>
          <p>
            Next: <a href="/run">run a scenario</a>.
          </p>
        </section>
      )}
    </>
  );
}
