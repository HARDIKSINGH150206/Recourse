import { useState } from "react";
import { short } from "../lib/format";

/** Truncated monospace value with a copy button (docs/06 section 3). */
export function Hash({ value, n = 6 }: { value: string; n?: number }) {
  const [done, setDone] = useState(false);
  return (
    <span className="hash">
      <code title={value}>{short(value, n)}</code>{" "}
      <button
        type="button"
        className="link"
        aria-label={`copy ${value}`}
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1200);
          });
        }}
      >
        {done ? "copied" : "copy"}
      </button>
    </span>
  );
}
