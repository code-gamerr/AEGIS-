import type { ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { cn } from "../cn";
import { setToken } from "../api";
import { Btn, LogoMark } from "./ui";

const LINKS = [
  { to: "/command", n: "01", label: "Command" },
  { to: "/detections", n: "02", label: "Detections" },
  { to: "/gym", n: "03", label: "Range" },
  { to: "/policy", n: "04", label: "Policy" },
  { to: "/governance", n: "05", label: "Ledger" },
  { to: "/analytics", n: "06", label: "Pulse" },
];

export default function Shell({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  return (
    <div className="relative min-h-dvh bg-ink text-paper">
      <div className="console-grain" aria-hidden />
      <header className="sticky top-0 z-50 h-20 border-b border-line bg-ink/90 backdrop-blur-md">
        <div className="console-gutter relative z-10 flex h-full items-center justify-between gap-4">
          <Link to="/" className="flex shrink-0 items-center gap-2 text-paper">
            <LogoMark />
            <span className="display text-[1.15rem] tracking-[-0.02em]">AEGIS</span>
          </Link>
          <nav
            className="hidden items-center gap-1 overflow-x-auto rounded-full border border-line bg-ink/40 px-2 py-1.5 md:flex"
            aria-label="Primary"
          >
            {LINKS.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  cn(
                    "flex min-w-16 flex-col items-center px-2 py-1 font-mono text-[0.66rem] uppercase tracking-[0.14em]",
                    isActive ? "text-paper" : "text-mute hover:text-paper",
                  )
                }
              >
                <span>{l.n}</span>
                <span>{l.label}</span>
              </NavLink>
            ))}
          </nav>
          <Btn
            className="h-10 shrink-0 px-5"
            onClick={() => {
              setToken(null);
              nav("/login");
            }}
          >
            Sign out
          </Btn>
        </div>
      </header>
      <nav
        className="relative z-10 flex gap-1 overflow-x-auto border-b border-line px-4 py-2 md:hidden"
        aria-label="Primary"
      >
        {LINKS.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            className={({ isActive }) =>
              cn(
                "shrink-0 rounded-full px-3 py-1.5 font-mono text-[0.66rem] uppercase tracking-[0.14em]",
                isActive ? "bg-raised text-paper" : "text-mute",
              )
            }
          >
            {l.label}
          </NavLink>
        ))}
      </nav>
      <main className="relative z-10 min-w-0 pb-[env(safe-area-inset-bottom)]">{children}</main>
    </div>
  );
}
