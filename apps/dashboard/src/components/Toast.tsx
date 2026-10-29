import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { ApiError } from "../lib/api";
import { errMessage } from "../lib/format";

type Notify = (e: unknown) => void;
const Ctx = createContext<Notify>(() => undefined);
export const useNotifyError = () => useContext(Ctx);

/** API errors are shown with code and message, never swallowed (docs/06 section 1.6). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const notify = useCallback((e: unknown) => {
    setMsg(e instanceof ApiError ? `${e.code}: ${e.message}` : errMessage(e));
  }, []);
  return (
    <Ctx.Provider value={notify}>
      {children}
      {msg && (
        <div role="alert" className="toast">
          {msg}{" "}
          <button type="button" className="link" onClick={() => setMsg(null)}>
            dismiss
          </button>
        </div>
      )}
    </Ctx.Provider>
  );
}
