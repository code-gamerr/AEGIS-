import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "../cn";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-5", className)} aria-hidden>
      <path
        d="M16 3 28 10v12L16 29 4 22V10L16 3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        className="text-accent"
      />
      <path d="M16 11v10M12 16h8" stroke="currentColor" strokeWidth="1.6" className="text-accent" />
    </svg>
  );
}

const btnBase =
  "group relative inline-flex h-12 items-center justify-center overflow-hidden rounded-full px-7 font-mono text-[0.72rem] tracking-[0.16em] uppercase disabled:opacity-50";

export function Btn({
  variant = "ghost",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" }) {
  return (
    <button
      className={cn(
        btnBase,
        variant === "primary"
          ? "bg-paper text-ink hover:bg-accent"
          : "border border-line text-paper hover:border-accent hover:text-accent",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function TextCta({
  to,
  variant = "primary",
  children,
}: {
  to: string;
  variant?: "primary" | "ghost";
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cn(
        btnBase,
        variant === "primary"
          ? "bg-paper text-ink hover:bg-accent"
          : "border border-line text-paper hover:border-accent hover:text-accent",
      )}
    >
      {children}
    </Link>
  );
}

export function PageHead({
  n,
  kicker,
  title,
  lede,
  action,
}: {
  n: string;
  kicker: string;
  title: string;
  lede?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <p className="kicker">
          {n} / {kicker}
        </p>
        <h1 className="display mt-3 text-balance text-[clamp(1.8rem,3.4vw,2.8rem)]">{title}</h1>
        {lede ? <p className="mt-3 max-w-xl text-pretty text-sm text-mute">{lede}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-ink p-3 min-w-0">
      <p className="kicker truncate">{label}</p>
      <p className="mt-1 truncate font-mono text-sm tabular-nums text-paper">{value}</p>
    </div>
  );
}

export function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-sm border border-line bg-panel p-6">
      <h2 className="display text-2xl">{title}</h2>
      {hint ? <p className="mt-2 text-pretty text-sm text-mute">{hint}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 text-sm text-bad" role="alert">
      {children}
    </p>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="console-gutter py-8">
      <p className="text-sm text-bad" role="alert">
        {message}
      </p>
      <Btn className="mt-4 h-10 px-5" onClick={onRetry}>
        Retry
      </Btn>
    </div>
  );
}

export function Loading({ children }: { children: ReactNode }) {
  return (
    <p className="console-gutter py-8 text-sm text-mute" aria-busy="true">
      {children}
    </p>
  );
}
