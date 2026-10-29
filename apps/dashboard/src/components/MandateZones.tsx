import type { CompileResponse } from "../lib/types";
import { Hash } from "./Copy";

/** Three zones: hard limits (contract-enforced), safe defaults, agent discretion (docs/06 section 1.4). */
export function MandateZones({ c }: { c: CompileResponse }) {
  const { display, mandate, terms, merchants } = c;
  return (
    <div className="zones">
      <section className="card" aria-labelledby="z-hard">
        <h3 id="z-hard">Hard limits</h3>
        <p className="muted">Enforced by the escrow contract.</p>
        <table>
          <tbody>
            <tr>
              <th>Per call</th>
              <td>
                {display.maxPricePerCall} {display.symbol}
              </td>
            </tr>
            <tr>
              <th>Total budget</th>
              <td>
                {display.totalBudget} {display.symbol}
              </td>
            </tr>
            <tr>
              <th>Expires</th>
              <td>{new Date(mandate.expiresAt * 1000).toLocaleString()}</td>
            </tr>
            <tr>
              <th>Merchants</th>
              <td>
                {merchants.map((m) => (
                  <div key={m}>
                    <Hash value={m} />
                  </div>
                ))}
              </td>
            </tr>
          </tbody>
        </table>
      </section>
      <section className="card" aria-labelledby="z-def">
        <h3 id="z-def">Safe defaults</h3>
        <p className="muted">Used by the adjudicator if there is a dispute.</p>
        <table>
          <tbody>
            <tr>
              <th>Category</th>
              <td>{terms.category}</td>
            </tr>
            {Object.entries(terms.defaults).map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td>{String(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card" aria-labelledby="z-disc">
        <h3 id="z-disc">Agent discretion</h3>
        <p className="muted">Not restricted: the agent may choose these.</p>
        {terms.discretion.length === 0 ? (
          <p>None.</p>
        ) : (
          <ul>
            {terms.discretion.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
