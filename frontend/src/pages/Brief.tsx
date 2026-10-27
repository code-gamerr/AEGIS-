import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { getToken } from "../api";
import { cn } from "../cn";
import "../landing/landing.css";
import raw from "../../../docs/AEGIS-RESEARCH-BRIEF.md?raw";
import { assetSrc, parseBrief, tocOf } from "../landing/briefMd";

function consoleTo() {
  return getToken() ? "/command" : "/login";
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < text.length) {
    if (text.startsWith("**", i)) {
      const end = text.indexOf("**", i + 2);
      if (end !== -1) {
        out.push(<strong key={k++}>{inline(text.slice(i + 2, end))}</strong>);
        i = end + 2;
        continue;
      }
    }
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end !== -1) {
        out.push(<code key={k++}>{text.slice(i + 1, end)}</code>);
        i = end + 1;
        continue;
      }
    }
    if (text[i] === "[") {
      const m = text.slice(i).match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (m) {
        const href = m[2]!;
        const ext = /^https?:\/\//.test(href);
        out.push(
          <a key={k++} href={href} {...(ext ? { target: "_blank", rel: "noreferrer" } : undefined)}>
            {m[1]}
          </a>,
        );
        i += m[0].length;
        continue;
      }
    }
    if (text[i] === "*" && text[i + 1] !== "*") {
      const end = text.indexOf("*", i + 1);
      if (end !== -1) {
        out.push(<em key={k++}>{text.slice(i + 1, end)}</em>);
        i = end + 1;
        continue;
      }
    }
    let j = i + 1;
    while (j < text.length && text[j] !== "*" && text[j] !== "`" && text[j] !== "[") j++;
    out.push(text.slice(i, j));
    i = j;
  }
  return out;
}

function tocLabel(s: string) {
  return s.replace(/^\d+\.\s*/, "").replace(/\*/g, "");
}

export default function Brief() {
  const blocks = useMemo(() => parseBrief(raw), []);
  const toc = useMemo(() => tocOf(blocks), [blocks]);
  const firstP = blocks.findIndex((b) => b.t === "p");
  const [here, setHere] = useState(toc[0]?.id ?? "");

  useEffect(() => {
    document.title = "AEGIS: a control plane for the move after the alert";
    return () => {
      document.title = "AEGIS";
    };
  }, []);

  useEffect(() => {
    const onScroll = () => {
      let id = toc[0]?.id ?? "";
      for (const h of toc) {
        const el = document.getElementById(h.id);
        if (el && el.getBoundingClientRect().top <= 120) id = h.id;
      }
      setHere(id);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [toc]);

  return (
    <div className="landing lx-paper">
      <a className="skip" href="#note">
        Skip to note
      </a>
      <header className="pointer-events-none fixed inset-x-0 top-0 z-50 h-16 border-b border-[var(--lx-line)] bg-[color-mix(in_srgb,var(--lx-bg)_92%,transparent)] backdrop-blur-md">
        <div className="gutter flex h-full items-center justify-between">
          <Link to="/" className="pointer-events-auto text-[0.95rem] tracking-normal text-[var(--lx-text)]">
            AEGIS
          </Link>
          <p className="hidden text-[0.8rem] text-[var(--lx-muted)] md:block">Research note, October 2026</p>
          <Link to={consoleTo()} className="pointer-events-auto text-[0.8rem] text-[var(--lx-muted)] hover:text-[var(--lx-text)]">
            Console
          </Link>
        </div>
      </header>

      <div className="gutter relative pt-24 pb-28 lg:grid lg:grid-cols-[13.5rem_minmax(0,38rem)_1fr] lg:gap-16">
        <nav className="mb-14 hidden lg:block" aria-label="Contents">
          <div className="sticky top-24">
            <p className="lx-paper-kicker">Contents</p>
            <ol className="lx-paper-toc">
              {toc.map((h, n) => (
                <li key={h.id}>
                  <a href={`#${h.id}`} className={cn(here === h.id && "is-here")}>
                    <span>{String(n + 1).padStart(2, "0")}</span>
                    <span>{tocLabel(h.text)}</span>
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </nav>

        <article id="note" className="lx-prose min-w-0">
          {blocks.map((b, i) => {
            if (b.t === "h1")
              return (
                <header key={i} className="lx-mast">
                  <p className="lx-paper-kicker">Research note</p>
                  <h1 id={b.id}>{inline(b.text)}</h1>
                </header>
              );
            if (b.t === "dek")
              return (
                <p key={i} className="lx-dek">
                  {inline(b.text)}
                </p>
              );
            if (b.t === "byline")
              return (
                <p key={i} className="lx-byline">
                  {inline(b.text)}
                </p>
              );
            if (b.t === "h2")
              return (
                <h2 key={i} id={b.id}>
                  {inline(b.text)}
                </h2>
              );
            if (b.t === "h3")
              return (
                <h3 key={i} id={b.id}>
                  {inline(b.text)}
                </h3>
              );
            if (b.t === "hr") return <hr key={i} />;
            if (b.t === "p")
              return (
                <p key={i} className={i === firstP ? "lx-standfirst" : undefined}>
                  {inline(b.text)}
                </p>
              );
            if (b.t === "ul")
              return (
                <ul key={i}>
                  {b.items.map((it, j) => (
                    <li key={j}>{inline(it)}</li>
                  ))}
                </ul>
              );
            if (b.t === "ol")
              return (
                <ol key={i}>
                  {b.items.map((it, j) => (
                    <li key={j}>{inline(it)}</li>
                  ))}
                </ol>
              );
            if (b.t === "table")
              return (
                <div key={i} className="lx-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {b.heads.map((h) => (
                          <th key={h}>{inline(h)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {b.rows.map((r, ri) => (
                        <tr key={ri}>
                          {r.map((c, ci) => (
                            <td key={ci}>{inline(c)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            if (b.t === "code" && b.lang === "mermaid") {
              return (
                <figure key={i} className="lx-schematic">
                  <figcaption>Schematic. Telemetry is scored, a policy proposes, a gate admits or refuses the verb, and the ledger records the act.</figcaption>
                  <ol>
                    {["Estate telemetry", "Isolation Forest", "Tabular Blue policy", "Human gate and blast-radius flags", "isolate / restore / contain / decoy / monitor", "Host and segment flags; append-only ledger"].map(
                      (s) => (
                        <li key={s}>{s}</li>
                      ),
                    )}
                  </ol>
                </figure>
              );
            }
            if (b.t === "code")
              return (
                <pre key={i}>
                  <code>{b.body}</code>
                </pre>
              );
            if (b.t === "img")
              return (
                <figure key={i}>
                  <img
                    src={assetSrc(b.src)}
                    alt={b.alt}
                    onError={(e) => {
                      const fig = e.currentTarget.closest("figure");
                      if (fig) fig.hidden = true;
                    }}
                  />
                  {b.caption ? <figcaption>{b.caption}</figcaption> : null}
                </figure>
              );
            return null;
          })}
        </article>
      </div>

      <footer className="gutter flex flex-wrap items-center justify-between gap-4 border-t border-[var(--lx-line)] py-8 text-[0.85rem] text-[var(--lx-muted)]">
        <p>AEGIS research note, October 2026</p>
        <Link to="/" className="hover:text-[var(--lx-text)]">
          Return to AEGIS
        </Link>
      </footer>
    </div>
  );
}
