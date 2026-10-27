import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { getToken } from "../api";
import { cn } from "../cn";
import "../landing/landing.css";
import { BLUE, Fleet, GATED, SUBNETS, risk, type RedKind, type Zone } from "../landing/fleet";
import { startParticles } from "../landing/particles";

const SCRAMBLE =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/·<>#_+= ";
const PHRASES = [
  "Node telemetry",
  "Pod restarts",
  "Egress volume",
  "Auth failures",
  "Config drift",
  "Blast radius",
];
const PILL = [
  { n: "01", word: "Loop", href: "#loop" },
  { n: "02", word: "Range", href: "#range" },
  { n: "03", word: "Capabilities", href: "#capabilities" },
  { n: "04", word: "Process", href: "#process" },
];
const LOOP_POINTS = [
  {
    n: "01",
    title: "Detection is a score, not a verdict.",
    body: "Isolation Forest ranks how unusual a node looks. It never acts on its own.",
  },
  {
    n: "02",
    title: "The policy only proposes.",
    body: "A tabular Q-learning Blue policy picks among monitor, decoy, isolate, restore. Every Q-value is inspectable.",
  },
  {
    n: "03",
    title: "Blast radius is a gate.",
    body: "Isolate and restore need an operator unless autonomy is on and the action is under the blast-radius threshold. Every mutation is audited.",
  },
];
const INTERLUDE = [
  {
    n: "01",
    word: "Detect",
    body: "Isolation Forest scores every node each tick. Healthy, anomalous, isolated — three states, one score.",
  },
  {
    n: "02",
    word: "Decide",
    body: "The Blue policy reads a discretised state and proposes one verb. Monitor is cheap. Isolate is not.",
  },
  {
    n: "03",
    word: "Gate",
    body: "High-impact verbs stop at the operator. Approve, reject, or let the gate decide — the ledger records all three.",
  },
];
const CAPS = [
  {
    n: "01",
    title: "Detect",
    body: "Isolation Forest over node telemetry. Scores, not verdicts; thresholds you can read.",
    tags: ["Isolation Forest", "Per-node score", "Drift"],
    to: "/detections",
  },
  {
    n: "02",
    title: "Decide",
    body: "Tabular Q-learning proposes monitor, decoy, isolate, or restore. Train locally or on Kaggle / Vertex and import the table.",
    tags: ["Q-table", "ε-greedy", "q_policy.json"],
    to: "/policy",
  },
  {
    n: "03",
    title: "Govern",
    body: "Human gates on high blast radius, an append-only ledger, retention and PII tags per setting.",
    tags: ["Human gate", "Audit ledger", "Retention"],
    to: "/governance",
  },
];
const SURFACES = [
  { n: "01", name: "Command", line: "The queue: proposed actions waiting on a decision.", to: "/command" },
  { n: "02", name: "Detections", line: "Anomaly scores per node, newest first.", to: "/detections" },
  { n: "03", name: "Range", line: "The abstract gym where Blue trains against labelled Red moves.", to: "/gym" },
  { n: "04", name: "Policy", line: "Inspect, import, or pull the Q-table.", to: "/policy" },
  { n: "05", name: "Ledger", line: "Every mutation, who did it, and why.", to: "/governance" },
  { n: "06", name: "Pulse", line: "Episode reward, detection rate, gate decisions over time.", to: "/analytics" },
];
const STEPS = [
  { who: "Collector", title: "Ingest", body: "Telemetry lands on this box. Nothing is shipped out." },
  { who: "Isolation Forest", title: "Score", body: "Each node gets an anomaly score. Scoring does not act." },
  { who: "Blue policy", title: "Propose", body: "The Q-table picks monitor, decoy, isolate, or restore." },
  { who: "Operator", title: "Gate", body: "Isolate and restore wait for a person unless autonomy is on and blast radius is under the threshold." },
  { who: "Ledger", title: "Record", body: "The decision is appended. The outcome can retrain the table." },
];
const TICK_MS = [
  { id: "slow", label: "Slow", ms: 700 },
  { id: "normal", label: "Normal", ms: 220 },
  { id: "fast", label: "Fast", ms: 60 },
] as const;
const ZONES: { id: Zone; label: string }[] = [
  { id: "user", label: "User" },
  { id: "ent", label: "Enterprise" },
  { id: "ops", label: "Ops" },
];

function useReducedMotion() {
  const [v, setV] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setV(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return v;
}

function useInView<T extends Element>(once = true) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true);
          if (once) io.disconnect();
        } else if (!once) setInView(false);
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once]);
  return { ref, inView };
}

function authed() {
  return Boolean(getToken());
}

function consoleTo() {
  return authed() ? "/command" : "/login";
}

function consoleLabel() {
  return authed() ? "Enter console" : "Operator sign in";
}

function Kicker({ n, word }: { n: string; word: string }) {
  return (
    <p className="label">
      {n} / {word}
    </p>
  );
}

function Seg({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
      <p className="label w-14 shrink-0">{label}</p>
      <div role="radiogroup" aria-label={label} className="lx-seg">
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Cta({
  to,
  href,
  variant = "primary",
  children,
}: {
  to?: string;
  href?: string;
  variant?: "primary" | "ghost";
  children: ReactNode;
}) {
  const cls = cn(
    "group relative inline-flex h-12 items-center overflow-hidden rounded-full px-7 font-mono text-[0.72rem] tracking-[0.16em] uppercase",
    variant === "primary"
      ? "bg-[var(--lx-text)] text-[var(--lx-bg)] hover:bg-[var(--lx-cyan)]"
      : "border border-[color-mix(in_srgb,var(--lx-text)_22%,transparent)] text-[var(--lx-text)] hover:border-[var(--lx-cyan)] hover:text-[var(--lx-cyan)]",
  );
  const inner = (
    <span className="relative block h-4 overflow-hidden">
      <span className="block transition-transform duration-500 ease-[var(--lx-ease-out)] group-hover:-translate-y-full">
        {children}
      </span>
      <span className="absolute inset-0 translate-y-full transition-transform duration-500 ease-[var(--lx-ease-out)] group-hover:translate-y-0" aria-hidden>
        {children}
      </span>
    </span>
  );
  if (to) return <Link className={cls} to={to}>{inner}</Link>;
  return (
    <a className={cls} href={href}>
      {inner}
    </a>
  );
}

function Scramble({ text, play }: { text: string; play: boolean }) {
  const [out, setOut] = useState(text);
  useEffect(() => {
    if (!play) {
      setOut(text);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / 700);
      const keep = Math.floor(p * text.length);
      let s = "";
      for (let i = 0; i < text.length; i++) {
        s += i < keep || text[i] === " " ? text[i] : SCRAMBLE[(Math.random() * SCRAMBLE.length) | 0];
      }
      setOut(s);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setOut(text);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, play]);
  return (
    <span aria-label={text} className="tabular-nums">
      <span aria-hidden>{out}</span>
    </span>
  );
}

function LogoMark() {
  return (
    <svg viewBox="0 0 32 32" className="size-5" aria-hidden>
      <path
        d="M16 3 28 10v12L16 29 4 22V10L16 3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        className="text-[var(--lx-cyan)]"
      />
      <path d="M16 11v10M12 16h8" stroke="currentColor" strokeWidth="1.6" className="text-[var(--lx-cyan)]" />
    </svg>
  );
}

function Loader({ onDone }: { onDone: () => void }) {
  const [p, setP] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      done.current();
    };
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const n = Math.min(1, (now - t0) / 1400);
      setP(n);
      if (n < 1) raf = requestAnimationFrame(tick);
      else finish();
    };
    raf = requestAnimationFrame(tick);
    const kill = window.setTimeout(finish, 1800);
    window.addEventListener("keydown", finish);
    window.addEventListener("pointerdown", finish);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(kill);
      window.removeEventListener("keydown", finish);
      window.removeEventListener("pointerdown", finish);
    };
  }, []);
  const n = Math.floor(p * 100)
    .toString()
    .padStart(3, "0");
  return (
    <div className="fixed inset-0 z-[90] flex flex-col justify-between bg-[var(--lx-bg)] p-[var(--lx-gutter)] pb-8" aria-hidden>
      <div />
      <div className="mx-auto">
        <div className="lx-loader-rays">
          {Array.from({ length: 14 }, (_, i) => (
            <span key={i} style={{ transform: `rotate(${(i / 14) * 360}deg)` }} />
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-end justify-between">
          <p className="label">Initialising environment</p>
          <p className="font-mono text-[clamp(2.5rem,7vw,5rem)] leading-none tabular-nums text-[var(--lx-text)]">{n}</p>
        </div>
        <div className="mt-4 h-px overflow-hidden bg-[var(--lx-line)]">
          <div className="lx-bar h-px" style={{ transform: `scaleX(${p})` }} />
        </div>
      </div>
    </div>
  );
}

function Header() {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 h-20 border-b border-[var(--lx-line)] bg-[color-mix(in_srgb,var(--lx-bg)_88%,transparent)] backdrop-blur-md">
      <div className="gutter flex h-full items-center justify-between">
        <a href="#hero" className="pointer-events-auto flex items-center gap-2 text-[var(--lx-text)]">
          <LogoMark />
          <span className="display text-[1.15rem] tracking-[-0.02em]">AEGIS</span>
        </a>
        <nav
          className="pointer-events-auto hidden items-center gap-1 rounded-full border border-[var(--lx-line)] bg-[color-mix(in_srgb,var(--lx-bg)_40%,transparent)] px-2 py-1.5 backdrop-blur-md md:flex"
          aria-label="Sections"
        >
          {PILL.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="flex min-w-16 flex-col items-center px-2 py-1 font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[var(--lx-muted)] hover:text-[var(--lx-text)]"
            >
              <span>{l.n}</span>
              <span>{l.word}</span>
            </a>
          ))}
        </nav>
        <div className="pointer-events-auto flex items-center gap-4">
          <Link
            to="/brief"
            className="hidden font-mono text-[0.72rem] uppercase tracking-[0.16em] text-[var(--lx-muted)] hover:text-[var(--lx-text)] md:inline"
          >
            Note
          </Link>
          <Cta to={consoleTo()}>{consoleLabel()}</Cta>
        </div>
      </div>
    </header>
  );
}

function RangeDemo({ reduced }: { reduced: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const fleet = useRef(new Fleet(7));
  const visible = useRef(true);
  const [tick, setTick] = useState(0);
  const [running, setRunning] = useState(false);
  const [autonomy, setAutonomy] = useState(false);
  const [pace, setPace] = useState<(typeof TICK_MS)[number]["id"]>(reduced ? "fast" : "normal");
  const [red, setRed] = useState<RedKind>("meander");
  const bump = () => setTick((n) => n + 1);
  const f = fleet.current;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      visible.current = e.isIntersecting;
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!running) return;
    const ms = TICK_MS.find((s) => s.id === pace)?.ms ?? 220;
    const id = window.setInterval(() => {
      if (!visible.current || document.hidden) return;
      const r = f.tick(true);
      bump();
      if (r === "gated") setRunning(false);
    }, reduced ? 0 : ms);
    return () => clearInterval(id);
  }, [running, pace, reduced, f]);

  function learn() {
    if (f.pending) f.approve();
    if (reduced) {
      for (let i = 0; i < 400 && f.episodes < 24; i++) f.tick(true);
      bump();
      setRunning(false);
      return;
    }
    setAutonomy(true);
    setRunning((v) => !v);
  }

  const vals = f.values();
  const vmax = Math.max(...vals, 0.01);
  const pending = f.pending;
  void tick;

  return (
    <div ref={wrap} className="mt-8 rounded-xl border border-[var(--lx-line)] bg-[var(--lx-surface)] p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={learn}
            className="h-10 rounded-full bg-[var(--lx-text)] px-5 font-mono text-[0.72rem] uppercase text-[var(--lx-bg)] hover:bg-[var(--lx-cyan)]"
          >
            {running ? "Pause" : "Learn"}
          </button>
          <button
            type="button"
            onClick={() => {
              f.tick(autonomy);
              bump();
            }}
            className="h-10 rounded-full border border-[var(--lx-line)] px-4 font-mono text-[0.72rem] uppercase hover:border-[var(--lx-cyan)]"
          >
            Tick
          </button>
          <button
            type="button"
            onClick={() => {
              setRunning(false);
              f.resetLearner();
              bump();
            }}
            className="h-10 rounded-full border border-[var(--lx-line)] px-4 font-mono text-[0.72rem] uppercase hover:border-[var(--lx-cyan)]"
          >
            Reset
          </button>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={autonomy}
          onClick={() => setAutonomy((v) => !v)}
          className="flex cursor-pointer items-center gap-2 font-mono text-[0.7rem] text-[var(--lx-muted)]"
        >
          <span className="lx-switch" aria-hidden>
            <i />
          </span>
          Autonomy
        </button>
      </div>

      <div className="mt-5 flex flex-col gap-3">
        <Seg
          label="Pace"
          value={pace}
          options={TICK_MS.map((s) => ({ id: s.id, label: s.label }))}
          onChange={(id) => setPace(id as (typeof TICK_MS)[number]["id"])}
        />
        <Seg
          label="Red"
          value={red}
          options={[
            { id: "meander", label: "Meander" },
            { id: "bline", label: "Beeline" },
          ]}
          onChange={(id) => {
            const next = id as RedKind;
            setRed(next);
            setRunning(false);
            f.red = next;
            f.resetWorld();
            bump();
          }}
        />
      </div>

      {pending ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--lx-warn)] bg-[var(--lx-bg)] px-4 py-3">
          <p className="text-sm text-pretty">
            Policy proposes <span className="font-mono text-[var(--lx-warn)]">{pending.action}</span> on{" "}
            <span className="font-mono">{pending.target}</span>. Isolate and restore stay gated.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                f.approve();
                bump();
              }}
              className="h-9 rounded-full bg-[var(--lx-text)] px-4 font-mono text-[0.7rem] uppercase text-[var(--lx-bg)]"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => {
                f.reject();
                bump();
              }}
              className="h-9 rounded-full border border-[var(--lx-line)] px-4 font-mono text-[0.7rem] uppercase"
            >
              Monitor instead
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {ZONES.map((z) => (
          <div key={z.id}>
            <p className="label">{z.label}</p>
            <ul className="mt-3 flex flex-col gap-2">
              {SUBNETS[z.id].map((name) => {
                const h = f.hosts[name]!;
                const score = risk(h, name);
                const here = f.redPos === name;
                const wait = pending?.target === name;
                return (
                  <li
                    key={name}
                    className={cn(
                      "rounded-md border px-3 py-2",
                      wait
                        ? "border-[var(--lx-warn)]"
                        : here
                          ? "border-[var(--lx-violet)]"
                          : "border-[var(--lx-line)]",
                      !h.up && "opacity-50",
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-mono text-sm">{name}</p>
                      <p className="font-mono text-[0.65rem] tabular-nums text-[var(--lx-muted)]">{score.toFixed(2)}</p>
                    </div>
                    <div className="mt-1 h-px bg-[var(--lx-line)]">
                      <div
                        className="h-px"
                        style={{
                          width: `${score * 100}%`,
                          background: score > 0.55 ? "var(--lx-bad)" : score > 0.25 ? "var(--lx-warn)" : "var(--lx-cyan)",
                        }}
                      />
                    </div>
                    <p className="mt-1 font-mono text-[0.62rem] uppercase tracking-[0.1em] text-[var(--lx-muted)]">
                      {[
                        here && "red",
                        h.compromised && "compromised",
                        h.isolated && "isolated",
                        h.decoy && "decoy",
                        !h.up && "down",
                      ]
                        .filter(Boolean)
                        .join(" · ") || "quiet"}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { k: "Episodes", v: String(f.episodes) },
          { k: "ε", v: f.eps.toFixed(2) },
          { k: "Last reward", v: f.lastBlue ? f.lastReward.toFixed(2) : "—" },
          { k: "Outcome", v: f.done ? f.outcome : "ongoing" },
        ].map((m) => (
          <div key={m.k} className="lx-metric">
            <dt className="label truncate">{m.k}</dt>
            <dd className="mt-1 truncate font-mono text-sm tabular-nums">{m.v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 lx-metric">
        <p className="label">Q at current state</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-4">
          {BLUE.map((a, i) => (
            <li key={a}>
              <p className="flex justify-between font-mono text-[0.65rem] uppercase tracking-[0.12em] text-[var(--lx-muted)]">
                <span>
                  {a}
                  {GATED.has(a) ? " · gate" : ""}
                </span>
                <span className="tabular-nums text-[var(--lx-text)]">{vals[i]!.toFixed(2)}</span>
              </p>
              <div className="mt-1 h-1 rounded-full bg-[var(--lx-line)]">
                <div
                  className="h-1 rounded-full bg-[var(--lx-cyan)]"
                  style={{ width: `${Math.max(4, (Math.max(vals[i]!, 0) / vmax) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>

      <ol className="mt-4 max-h-40 overflow-auto font-mono text-[0.7rem] text-[var(--lx-muted)]">
        {f.log.length === 0 ? (
          <li>No ticks yet. Learn runs with autonomy. Tick respects the gate.</li>
        ) : (
          [...f.log].reverse().map((l, i) => (
            <li key={`${l.action}-${i}`} className="border-t border-[var(--lx-line)] py-1.5 first:border-0">
              <span className={l.actor === "red" ? "text-[var(--lx-bad)]" : "text-[var(--lx-cyan)]"}>
                {l.actor}/{l.action}
              </span>{" "}
              {l.target} — {l.note}
            </li>
          ))
        )}
      </ol>
    </div>
  );
}

export default function Landing() {
  const reduced = useReducedMotion();
  const [loaded, setLoaded] = useState(
    () => reduced || (typeof sessionStorage !== "undefined" && sessionStorage.getItem("aegis:loaded") === "1"),
  );
  const [phrase, setPhrase] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heroVis = useInView<HTMLElement>(false);

  const finishLoader = useCallback(() => {
    sessionStorage.setItem("aegis:loaded", "1");
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!reduced) document.documentElement.classList.add("lx-smooth");
    return () => document.documentElement.classList.remove("lx-smooth");
  }, [reduced]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    return startParticles(el, { word: "AEGIS", reduced });
  }, [reduced]);

  useEffect(() => {
    if (reduced || !heroVis.inView) return;
    const id = window.setInterval(() => setPhrase((p) => (p + 1) % PHRASES.length), 2600);
    return () => clearInterval(id);
  }, [reduced, heroVis.inView]);

  const showLoader = !loaded && !reduced;

  return (
    <div className={cn("landing", loaded && "lx-ready")}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      {showLoader ? <Loader onDone={finishLoader} /> : null}
      <div className="lx-bg" aria-hidden>
        <i className="lx-mesh" />
        <i className="lx-orb lx-orb-a" />
        <i className="lx-orb lx-orb-b" />
      </div>
      <div className="lx-grain" aria-hidden />
      <div inert={showLoader || undefined}>
      <Header />
      <main id="main" tabIndex={-1}>
        <section id="hero" ref={heroVis.ref} className="relative isolate h-svh overflow-hidden">
          <div className={cn("lx-floor-wrap z-0", !heroVis.inView && "lx-paused")}>
            <div className="lx-floor" />
          </div>
          <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-10" aria-hidden />
          <div className="gutter relative z-20 flex h-full flex-col pb-8 pt-24">
            <p className="label">Closed-loop defense × local-first</p>
            <div className="flex-1" aria-hidden />
            <h1 className="display max-w-[13ch] text-[clamp(2.4rem,6vw,5.5rem)] text-balance">
              <span className="lx-line-mask block">Detect the drift.</span>
              <span className="lx-line-mask block">Propose the move.</span>
              <span className="lx-line-mask block">Keep the human.</span>
            </h1>
            <p className="mt-5 max-w-[42ch] text-pretty text-[var(--lx-muted)]">
              Local-first control plane for infrastructure defense. Isolation Forest scores cloud and Kubernetes-shaped
              telemetry. A tabular Blue policy proposes isolate, restore, decoy, or monitor. High-impact actions stay
              with the operator.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Cta to={consoleTo()}>{consoleLabel()}</Cta>
              <Cta href="#range" variant="ghost">
                Watch it learn
              </Cta>
              <Cta to="/brief" variant="ghost">
                Read the note
              </Cta>
            </div>
            <div className="mt-10 grid gap-3 border-t border-[var(--lx-line)] pt-4 md:grid-cols-3 md:items-end md:pr-12">
              <p className="label">Episode 000 — range initialised</p>
              <p className="label md:text-center">
                Now scoring
                <span className="mt-1 block min-h-[1.4em] text-[var(--lx-text)]">
                  <Scramble text={PHRASES[phrase]} play={!reduced && heroVis.inView} />
                </span>
              </p>
              <p className="label flex items-center gap-3 md:justify-end">
                Scroll to explore
                <span className="lx-scroll-cue">
                  <i />
                </span>
              </p>
            </div>
          </div>
        </section>

        <section id="loop" aria-labelledby="loop-h" className="gutter lx-section">
          <Kicker n="01" word="Loop" />
          <h2 id="loop-h" className="lx-h2 mt-5">
            Detection, a proposal, a human gate.
          </h2>
          <p className="mt-5 max-w-2xl text-pretty text-[var(--lx-muted)]">
            Most tooling stops at the alert. AEGIS closes the loop: telemetry becomes a score, the score becomes a
            state, the state becomes a proposed action, and the action waits for a person when it matters.
          </p>
          <ol className="mt-12 grid gap-8 border-t border-[var(--lx-line)] pt-10 md:grid-cols-3">
            {LOOP_POINTS.map((p) => (
              <li key={p.n}>
                <p className="display text-4xl text-[var(--lx-cyan)]">{p.n}</p>
                <h3 className="display mt-4 text-2xl text-balance">{p.title}</h3>
                <p className="mt-3 text-pretty text-sm text-[var(--lx-muted)]">{p.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="interlude" className="lx-section overflow-hidden">
          <div className="lx-marquee" aria-hidden>
            <p className="lx-marquee-track display gap-8 px-[var(--lx-gutter)] text-5xl tracking-[-0.04em] text-transparent md:text-6xl">
              <span className="shrink-0 whitespace-nowrap" style={{ WebkitTextStroke: "1px var(--lx-violet-28)" }}>
                DETECT · DECIDE · GATE · DETECT · DECIDE · GATE ·
              </span>
              <span className="shrink-0 whitespace-nowrap" style={{ WebkitTextStroke: "1px var(--lx-cyan-20)" }}>
                DETECT · DECIDE · GATE · DETECT · DECIDE · GATE ·
              </span>
            </p>
          </div>
          <ul className="gutter mt-10 grid gap-8 md:grid-cols-3">
            {INTERLUDE.map((c) => (
              <li key={c.n}>
                <p className="label">
                  {c.n} / 03 {c.word}
                </p>
                <p className="mt-3 text-pretty text-sm text-[var(--lx-muted)]">{c.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="range" aria-labelledby="range-h" className="gutter lx-section">
          <p className="label">Live demo · same gym as the console</p>
          <h2 id="range-h" className="lx-h2 mt-5">
            Twelve hosts. Four verbs. A gate.
          </h2>
          <p className="mt-4 max-w-2xl text-pretty text-[var(--lx-muted)]">
            This is the AEGIS range, running in the browser: user / enterprise / ops, abstract Red labels, a tabular
            Blue policy, isolate and restore held for a person unless autonomy is on. No maze. No payloads.
          </p>
          <RangeDemo reduced={reduced} />
          <p className="mt-4 max-w-2xl text-pretty font-mono text-xs text-[var(--lx-muted)]">
            Red labels: recon, attempt_access, pivot, persist, degrade. Production Isolation Forest scores telemetry;
            this demo scores from the host flags the gym actually has.
          </p>
        </section>

        <section id="capabilities" aria-labelledby="cap-h" className="gutter lx-section">
          <Kicker n="02" word="Capabilities" />
          <h2 id="cap-h" className="lx-h2 mt-5">
            One plane. Three jobs.
          </h2>
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {CAPS.map((c) => (
              <article key={c.n} className="rounded-sm border border-[var(--lx-line)] bg-[var(--lx-surface)] p-6">
                <p className="display text-4xl text-[var(--lx-cyan)]">{c.n}</p>
                <h3 className="display mt-5 text-3xl">{c.title}</h3>
                <p className="mt-3 text-pretty text-sm text-[var(--lx-muted)]">{c.body}</p>
                <ul className="mt-6 flex flex-wrap gap-2">
                  {c.tags.map((t) => (
                    <li
                      key={t}
                      className="rounded-full border border-[var(--lx-line)] px-3 py-1 font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[var(--lx-muted)]"
                    >
                      {t}
                    </li>
                  ))}
                </ul>
                <Link
                  to={c.to}
                  className="mt-6 inline-block font-mono text-[0.72rem] tracking-[0.16em] uppercase text-[var(--lx-cyan)]"
                >
                  Open in console →
                </Link>
              </article>
            ))}
          </div>
        </section>

        <section id="surfaces" aria-labelledby="surf-h" className="gutter lx-section">
          <Kicker n="03" word="Surfaces" />
          <h2 id="surf-h" className="lx-h2 mt-5">
            Six desks. Nothing ornamental.
          </h2>
          <ul className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {SURFACES.map((s) => (
              <li key={s.n}>
                <Link
                  to={s.to}
                  className="lx-chromatic block min-h-40 rounded-sm border border-[var(--lx-line)] bg-[var(--lx-surface)] p-6 transition-[border-color] duration-300 hover:border-[var(--lx-cyan)]"
                >
                  <p className="label">{s.n}</p>
                  <h3 className="display mt-6 text-3xl">{s.name}</h3>
                  <p className="mt-2 text-pretty text-sm text-[var(--lx-muted)]">{s.line}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section id="process" aria-labelledby="proc-h" className="gutter lx-section">
          <Kicker n="04" word="Process" />
          <h2 id="proc-h" className="lx-h2 mt-5">
            What happens on a tick.
          </h2>
          <ol className="mt-10 border-t border-[var(--lx-line)]">
            {STEPS.map((s, i) => (
              <li
                key={s.title}
                className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-4 gap-y-1 border-b border-[var(--lx-line)] py-4 sm:grid-cols-[2.25rem_8rem_minmax(0,1fr)] sm:items-baseline"
              >
                <p className="label">{String(i + 1).padStart(2, "0")}</p>
                <h3 className="font-mono text-sm tracking-[0.04em] uppercase">{s.title}</h3>
                <p className="text-pretty text-sm text-[var(--lx-muted)]">
                  <span className="mr-2 font-mono text-[0.68rem] tracking-[0.12em] uppercase text-[var(--lx-text)]">
                    {s.who}.
                  </span>
                  {s.body}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section id="enter" aria-labelledby="enter-h" className="gutter lx-section">
          <Kicker n="05" word="Enter" />
          <h2 id="enter-h" className="lx-h2 mt-5">
            Run it on your own box.
          </h2>
          <p className="mt-5 max-w-md text-pretty text-sm text-[var(--lx-muted)]">
            Console on port 8080. API on port 8000. Sign in as admin, operator, or analyst.
          </p>
          <p className="mt-4">
            <code>docker compose up</code>
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Cta to={consoleTo()}>{consoleLabel()}</Cta>
            <Cta href="#hero" variant="ghost">
              Back to top
            </Cta>
          </div>
        </section>
      </main>
      <footer className="gutter flex flex-wrap items-center justify-between gap-4 border-t border-[var(--lx-line)] py-8">
        <p className="label">AEGIS — local-first RL control plane</p>
        <Link to="/brief" className="font-mono text-[0.72rem] uppercase tracking-[0.16em] text-[var(--lx-cyan)]">
          Research note →
        </Link>
      </footer>
      </div>
    </div>
  );
}
