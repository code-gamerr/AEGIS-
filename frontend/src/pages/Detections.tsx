import { useEffect, useState } from "react";
import { api, type Detection, type Incident, type Me } from "../api";
import { ActRow } from "../components/ActRow";
import { Alert, LoadError, Loading, PageHead } from "../components/ui";
import { cn } from "../cn";

export default function Detections() {
  const [rows, setRows] = useState<Detection[] | null>(null);
  const [incs, setIncs] = useState<Incident[]>([]);
  const [role, setRole] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    try {
      const [d, i, me] = await Promise.all([
        api<Detection[]>("/api/detections"),
        api<Incident[]>("/api/incidents"),
        api<Me>("/api/me"),
      ]);
      setRows(d);
      setIncs(i);
      setRole(me.role);
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

  if (rows === null) {
    if (error) return <LoadError message={error} onRetry={() => void load()} />;
    return <Loading>Loading detections…</Loading>;
  }

  return (
    <div className="console-gutter py-8">
      <PageHead
        n="02"
        kicker="Detections"
        title="Scores, not verdicts"
        lede="Rules overlay MITRE tags. Isolation Forest scores residual anomalies against the local baseline."
      />
      {error ? <Alert>{error}</Alert> : null}
      <div className="mt-8 overflow-x-auto rounded-sm border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-panel">
            <tr className="kicker text-left">
              <th className="px-3 py-2 font-normal">Title</th>
              <th className="px-3 py-2 font-normal">Asset</th>
              <th className="px-3 py-2 font-normal">MITRE</th>
              <th className="px-3 py-2 font-normal">Score</th>
              <th className="px-3 py-2 font-normal">Rationale</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-sm text-mute">
                  No detections yet. Simulate a tick from Command.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-3 py-2">{r.title}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.asset_id}</td>
                  <td className="px-3 py-2 font-mono text-xs text-accent">{r.mitre}</td>
                  <td className={cn("px-3 py-2 font-mono tabular-nums", r.score >= 0.7 && "text-bad")}>
                    {r.score.toFixed(2)}
                  </td>
                  <td className="max-w-xl truncate px-3 py-2 text-mute">{r.rationale}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <h2 className="display mt-10 text-2xl">Incident ledger</h2>
      <ul className="mt-4 divide-y divide-line rounded-sm border border-line">
        {incs.length === 0 ? (
          <li className="px-3 py-6 text-sm text-mute">No open incidents.</li>
        ) : (
          incs.map((i) => (
            <li key={i.id} className="px-3 py-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span>
                  {i.title} <span className="font-mono text-xs text-mute">{i.asset_id}</span>
                </span>
                <span className="font-mono text-xs text-mute">
                  {i.status} · rec {i.recommended}
                </span>
              </div>
              <ActRow inc={i} role={role} busy={busy} onAct={act} />
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
