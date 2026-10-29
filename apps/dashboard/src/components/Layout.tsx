import { NavLink, Outlet } from "react-router-dom";
import { config } from "../lib/config";
import { Hash } from "./Copy";

const links = [
  ["/mandate", "Mandate"],
  ["/run", "Run"],
  ["/disputes", "Disputes"],
  ["/verify", "Verify"],
] as const;

export function Layout() {
  return (
    <>
      <header className="top">
        <strong>Recourse</strong>
        <span className="badge">testnet</span>
        <nav aria-label="Main">
          {links.map(([to, label]) => (
            <NavLink key={to} to={to}>
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
      <footer>
        chain {config.chainId} · escrow{" "}
        {config.escrow ? <Hash value={config.escrow} /> : <em>not configured</em>}
      </footer>
    </>
  );
}
