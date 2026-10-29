import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { VerificationReport } from "@recourse/shared";
import { CheckChip } from "../components/CheckChip";
import { EntryViewer } from "../components/EntryViewer";
import { useNotifyError } from "../components/Toast";
import { request } from "../lib/api";
import { config } from "../lib/config";
import { errMessage } from "../lib/format";
import { CHECKS, checkState, setLeaf, verifyInBrowser, type Path } from "../lib/verify";
import { publicClient } from "../lib/wallet";

/** Browser-side verification with an editable view (docs/06 section 1.5). */
export function VerifyPage() {
  const notify = useNotifyError();
  const { requestId: routeId } = useParams();
  const [idInput, setIdInput] = useState(routeId ?? "");
  const [original, setOriginal] = useState<unknown>(null);
  const [current, setCurrent] = useState<unknown>(null);
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [useChain, setUseChain] = useState(false);
  const [pasted, setPasted] = useState("");
  const seq = useRef(0);

  // Re-verify on every edit. Out-of-order results are dropped so a slow earlier run cannot
  // overwrite a newer one.
  useEffect(() => {
    if (current === null) return;
    const mine = ++seq.current;
    void verifyInBrowser(current, useChain ? publicClient : undefined).then((r) => {
      if (mine === seq.current) setReport(r);
    });
  }, [current, useChain]);

  const load = (bundle: unknown) => {
    setOriginal(bundle);
    setCurrent(bundle);
  };

  const fetchBundle = useMutation({
    mutationFn: (id: string) =>
      request<unknown>(config.gatewayUrl, `/evidence/${encodeURIComponent(id.trim())}`),
    onSuccess: load,
    onError: notify,
  });

  const { data: head } = useQuery({
    queryKey: ["log-head"],
    queryFn: () =>
      request<{ batch_index: number; anchored: boolean }>(config.gatewayUrl, "/log/head"),
    retry: false,
  });

  useEffect(() => {
    if (routeId) fetchBundle.mutate(routeId);
  }, [routeId]);

  const parsePaste = (text: string) => {
    try {
      load(JSON.parse(text));
    } catch (e) {
      notify(new Error(`not valid JSON: ${errMessage(e)}`));
    }
  };

  const edited = JSON.stringify(original) !== JSON.stringify(current);
  const onEdit = (path: Path, text: string) => setCurrent((c: unknown) => setLeaf(c, path, text));

  return (
    <>
      <h1>Verify</h1>
      <p>
        Everything below is checked in your browser from the evidence itself. You do not have to
        trust this dashboard or the gateway. Edit any field to see what tampering looks like.
      </p>

      <label htmlFor="rid">Request id</label>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <input
          id="rid"
          className="mono"
          value={idInput}
          onChange={(e) => setIdInput(e.target.value)}
          placeholder="0x…"
        />
        <button
          type="button"
          disabled={!idInput.trim()}
          onClick={() => fetchBundle.mutate(idInput)}
        >
          Load
        </button>
      </div>
      <details className="card">
        <summary>Paste or upload evidence JSON</summary>
        <textarea
          rows={5}
          className="mono"
          aria-label="evidence bundle JSON"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
        />
        <p>
          <button type="button" disabled={!pasted.trim()} onClick={() => parsePaste(pasted)}>
            Verify pasted JSON
          </button>{" "}
          <input
            type="file"
            accept="application/json,.json"
            aria-label="upload evidence JSON"
            style={{ width: "auto" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && f.size <= 5_000_000) void f.text().then(parsePaste);
              else if (f) notify(new Error("file is larger than 5 MB"));
            }}
          />
        </p>
      </details>
      {head && <p className="muted">Gateway log is at batch {head.batch_index}.</p>}

      {report && current !== null && (
        <>
          <h2>Checks</h2>
          <ul className="chips-list" aria-live="polite">
            {CHECKS.map(([key, text]) => (
              <CheckChip key={key} label={text} state={checkState(report, key)} />
            ))}
          </ul>
          <label style={{ fontWeight: 400 }}>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={useChain}
              onChange={(e) => setUseChain(e.target.checked)}
            />{" "}
            Verify anchor on-chain (reads <code>anchoredAt</code> from {config.rpcUrl})
          </label>
          {report.errors.length > 0 && (
            <details className="card" open>
              <summary className="bad">{report.errors.length} problem(s) found</summary>
              <ul>
                {report.errors.map((e, i) => (
                  <li key={i} className="mono">
                    {e}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="muted">
            Passing shows these records are internally consistent, signed by the keys they name, and
            (with the anchor check) existed by the anchored time. It does not show the merchant's
            data was correct or that the gateway saw every request. The log is tamper-evident, not
            tamper-proof.
          </p>

          <h2>
            Evidence{" "}
            {edited && (
              <button type="button" className="secondary" onClick={() => setCurrent(original)}>
                Reset
              </button>
            )}
          </h2>
          <EntryViewer
            original={original}
            current={current}
            sections={["entries", "tree_heads", "anchors", "receipt"]}
            onEdit={onEdit}
          />
        </>
      )}
    </>
  );
}
