import { useEffect, useState } from "react";
import { api, type Command as Cmd, type Incident } from "../api";
import { ActRow } from "../components/ActRow";
import { Alert, Btn, LoadError, Loading, Metric, PageHead, Panel } from "../components/ui";
import { cn } from "../cn";

const SUBNET_X: Record<string, number> = { user: 70, ent: 230, ops: 390 };

export default function Command() {
  const [data, setData] = useState<Cmd | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    try {
      setData(await api<Cmd>("/api/command"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  async function tick() {
    setBusy("tick");
    try {
      await api("/api/sim/tick", { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tick failed");
    } finally {
      setBusy("");
    }
  }

  async function act(inc: Incident, action: string) {
    setBusy(`${inc.id}:${action}`);
    try {
      await api(`/api/incidents/${inc.id}/act`, { method: "POST", body: JSON.stringify({ action }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy("");
    }
  }

  if (!data) {
    if (error) return <LoadError message={error} onRetry={() => void load()} />;
    return <Loading>Loading command…</Loading>;
  }

  const k = data.kpis;
  const role = data.user.role;
  const frozen = data.governance.kill_switch;
  return (
    <div>
      {frozen ? (
        <p className="border-b border-bad bg-panel px-6 py-2 text-sm text-bad lg:px-8" role="status">
          Kill switch is on. Isolate, restore, and contain are frozen.
        </p>
      ) : null}
      <div className="console-gutter py-8">
        <PageHead
          n="01"
          kicker="Command"
          title="Estate posture"
          action={
            <Btn
              variant="primary"
              className="h-10 px-5"
              onClick={tick}
              disabled={busy === "tick" || role === "analyst"}
            >
              {busy === "tick" ? "Ingesting…" : "Simulate tick"}
            </Btn>
          }
        />
        {error ? <Alert>{error}</Alert> : null}

        <section className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Metric label="Assets" value={k.assets} />
          <Metric label="Events" value={k.events} />
          <Metric label="Detections" value={k.detections} />
          <Metric label="Open" value={k.open_incidents} />
          <Metric label="MTTR min" value={k.mttr_min} />
          <Metric label="Q states" value={k.policy_states} />
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <Panel title="Network mesh" hint="user → ent → ops. Isolation and decoys drawn from live assets.">
            <svg viewBox="0 0 480 280" className="w-full" role="img" aria-label="Infrastructure map">
              {(["user", "ent", "ops"] as const).map((sn) => (
                <text key={sn} x={SUBNET_X[sn]} y="22" fill="#8b90a5" fontSize="11" fontFamily="JetBrains Mono, monospace">
                  {sn}
                </text>
              ))}
              {data.assets.map((a) => {
                const col = data.assets.filter((x) => x.subnet === a.subnet);
                const idx = col.findIndex((x) => x.id === a.id);
                const x = SUBNET_X[a.subnet];
                const y = 58 + idx * 52;
                const fill = !a.up ? "#fb7185" : a.isolated ? "#f5b942" : a.compromised ? "#fb7185" : "#121522";
                const stroke = a.decoy ? "#2de2e6" : "#1e2233";
                return (
                  <g key={a.id}>
                    <rect x={x - 48} y={y - 16} width="96" height="36" rx="2" fill={fill} stroke={stroke} />
                    <text x={x} y={y + 6} textAnchor="middle" fill="#edeef5" fontSize="10" fontFamily="JetBrains Mono, monospace">
                      {a.id}
                    </text>
                  </g>
                );
              })}
            </svg>
            <p className="kicker mt-3">
              kill switch {frozen ? "on" : "off"} · autonomy {data.governance.autonomy_enabled ? "on" : "off"}
            </p>
          </Panel>
          <Panel title="Open incidents">
            <ul className="space-y-3">
              {data.incidents.length === 0 ? (
                <li className="text-sm text-mute">Queue clear. Simulate a tick to ingest mixed telemetry.</li>
              ) : (
                data.incidents.map((inc) => (
                  <li key={inc.id} className="border-b border-line pb-3 last:border-0">
                    <p className="text-sm">
                      <span className="font-mono text-xs text-accent">{inc.mitre || "untagged"}</span> {inc.title}
                    </p>
                    <p className="font-mono text-xs text-mute">
                      {inc.asset_id} · rec {inc.recommended} · {Math.round(inc.confidence * 100)}%
                    </p>
                    <ActRow inc={inc} role={role} frozen={frozen} busy={busy} onAct={act} />
                  </li>
                ))
              )}
            </ul>
          </Panel>
        </section>

        <section className="mt-6 overflow-x-auto rounded-sm border border-line">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Recent telemetry</caption>
            <thead className="bg-panel">
              <tr className="kicker text-left">
                <th className="px-3 py-2 font-normal">Asset</th>
                <th className="px-3 py-2 font-normal">Type</th>
                <th className="px-3 py-2 font-normal">Score</th>
                <th className="px-3 py-2 font-normal">MITRE</th>
                <th className="px-3 py-2 font-normal">Summary</th>
              </tr>
            </thead>
            <tbody>
              {data.events.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-sm text-mute">
                    No telemetry yet. Simulate a tick.
                  </td>
                </tr>
              ) : (
                data.events.map((e) => (
                  <tr key={e.id} className="border-t border-line">
                    <td className="px-3 py-2 font-mono text-xs">{e.asset_id}</td>
                    <td className="px-3 py-2">{e.event_type}</td>
                    <td className={cn("px-3 py-2 font-mono tabular-nums", e.anomaly_score >= 0.62 && "text-bad")}>
                      {e.anomaly_score.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{e.mitre || "—"}</td>
                    <td className="max-w-md truncate px-3 py-2 text-mute">{e.summary}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
