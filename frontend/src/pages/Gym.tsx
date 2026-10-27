import { useEffect, useState } from "react";
import { api, BLUE_ACTIONS, type GymSnap } from "../api";
import { Alert, Btn, Loading, Metric, PageHead, Panel } from "../components/ui";
import { cn } from "../cn";

export default function Gym() {
  const [snap, setSnap] = useState<GymSnap | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setSnap(await api<GymSnap>("/api/gym"));
  }

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, []);

  async function step(action?: string) {
    setBusy(true);
    try {
      const next = await api<GymSnap>("/api/gym/step", {
        method: "POST",
        body: JSON.stringify({ action: action ?? null }),
      });
      setSnap(next);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Step failed");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      setSnap(await api<GymSnap>("/api/gym/reset", { method: "POST" }));
    } finally {
      setBusy(false);
    }
  }

  async function runEpisode() {
    setBusy(true);
    try {
      const next = await api<GymSnap>("/api/gym/run", {
        method: "POST",
        body: JSON.stringify({ max_steps: 40 }),
      });
      setSnap(next);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed");
    } finally {
      setBusy(false);
    }
  }

  if (!snap) return <Loading>Loading range…</Loading>;

  return (
    <div className="console-gutter py-8">
      <PageHead
        n="03"
        kicker="Range"
        title="Watch a Blue policy learn"
        lede="Red only has abstract labels: recon, attempt_access, pivot, persist, degrade. No payloads. Blue learns under availability cost."
      />
      {error ? <Alert>{error}</Alert> : null}
      <div className="mt-8 flex flex-wrap gap-2">
        {BLUE_ACTIONS.map((a) => (
          <Btn key={a} className="h-10 px-4" disabled={busy || snap.done} onClick={() => step(a)}>
            {a}
          </Btn>
        ))}
        <Btn variant="primary" className="h-10 px-4" disabled={busy || snap.done} onClick={() => step()}>
          Policy step
        </Btn>
        <Btn className="h-10 px-4" onClick={reset}>
          Reset
        </Btn>
        <Btn className="h-10 px-4" disabled={busy} onClick={runEpisode}>
          Run episode
        </Btn>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Step" value={String(snap.step)} />
        <Metric label="Red pos" value={snap.red_pos || "—"} />
        <Metric label="Progress" value={`${snap.red_progress}/4`} />
        <Metric label="Outcome" value={snap.done ? snap.outcome : "ongoing"} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Hosts">
          <p className="font-mono text-xs text-bad">{snap.compromised.join(", ") || "none compromised"}</p>
          <p className="mt-2 font-mono text-xs text-warn">{snap.isolated.join(", ") || "none isolated"}</p>
          <p className="mt-2 font-mono text-xs text-accent">{snap.decoy.join(", ") || "no decoys"}</p>
        </Panel>
        <Panel title="Log">
          <ol className="text-sm">
            {snap.log.length === 0 ? (
              <li className="text-mute">No moves yet. Take a policy step.</li>
            ) : (
              snap.log.map((l, i) => (
                <li key={i} className="border-b border-line py-2 last:border-0">
                  <span className={cn("font-mono text-xs", l.actor === "red" ? "text-bad" : "text-accent")}>
                    {l.actor}/{l.action}
                  </span>{" "}
                  <span className="text-mute">{l.target}</span>
                  <p className="text-pretty text-xs text-mute">{l.note}</p>
                </li>
              ))
            )}
          </ol>
        </Panel>
      </div>
      {snap.reward != null ? (
        <p className="mt-4 font-mono text-sm tabular-nums">
          last blue {snap.blue_action} · reward {snap.reward}
        </p>
      ) : null}
      {snap.total_reward != null ? (
        <p className="mt-2 font-mono text-sm tabular-nums">total_reward {snap.total_reward}</p>
      ) : null}
    </div>
  );
}
