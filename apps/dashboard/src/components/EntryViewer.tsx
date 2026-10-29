import { changedPaths, leaves, samePath, type Path } from "../lib/verify";

interface Props {
  original: unknown;
  current: unknown;
  /** Top-level keys of the bundle to show, in order. */
  sections: string[];
  onEdit: (path: Path, text: string) => void;
}

const label = (p: Path) => p.slice(1).join(".") || String(p[0]);

/** Every field of the evidence is an input: edit any character and the checks re-run. */
export function EntryViewer({ original, current, sections, onEdit }: Props) {
  const changed = changedPaths(original, current);
  const all = leaves(current);
  return (
    <div>
      {sections.map((section) => {
        const groups = new Map<string, typeof all>();
        for (const l of all.filter((x) => x.path[0] === section)) {
          const key = typeof l.path[1] === "number" ? `${section}[${l.path[1]}]` : section;
          groups.set(key, [...(groups.get(key) ?? []), l]);
        }
        return [...groups.entries()].map(([key, rows]) => (
          <details key={key} className="card" open={key.endsWith("[0]") || !key.includes("[")}>
            <summary>
              <strong>{key}</strong>
              {rows.some((r) => changed.some((c) => samePath(c, r.path))) && (
                <span className="bad"> · edited</span>
              )}
            </summary>
            <table>
              <tbody>
                {rows.map((r) => {
                  const edited = changed.some((c) => samePath(c, r.path));
                  const id = r.path.join(".");
                  return (
                    <tr key={id} className={edited ? "edited" : undefined}>
                      <th>
                        <label htmlFor={id} style={{ margin: 0, fontWeight: 400 }}>
                          {label(r.path.slice(typeof r.path[1] === "number" ? 1 : 0))}
                        </label>
                      </th>
                      <td>
                        <input
                          id={id}
                          className="mono"
                          value={String(r.value)}
                          onChange={(e) => onEdit(r.path, e.target.value)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </details>
        ));
      })}
    </div>
  );
}
