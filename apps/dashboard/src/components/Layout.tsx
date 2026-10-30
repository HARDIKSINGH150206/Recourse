import { useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { config } from "../lib/config";
import { Hash } from "./Copy";

const links = [
  ["/mandate", "Mandate"],
  ["/run", "Run"],
  ["/disputes", "Disputes"],
  ["/verify", "Verify"],
  ["/reputation", "Reputation"],
  ["/bench", "Bench"],
] as const;

export function Layout() {
  const { pathname } = useLocation();
  // one title per page so screen readers and tabs announce where you are
  useEffect(() => {
    const page = links.find(([to]) => pathname.startsWith(to))?.[1];
    document.title = page ? `${page} · Recourse` : "Recourse";
  }, [pathname]);
  return (
    <>
      <a href="#main" className="skip">
        Skip to content
      </a>
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
      <main id="main">
        <Outlet />
      </main>
      <footer>
        chain {config.chainId} · escrow{" "}
        {config.escrow ? <Hash value={config.escrow} /> : <em>not configured</em>}
      </footer>
    </>
  );
}
