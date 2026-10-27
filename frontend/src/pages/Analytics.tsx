import { useEffect, useState } from "react";
import { api } from "../api";
import { Alert, Loading, PageHead, Panel } from "../components/ui";

type Pulse = {
  mitre: Record<string, number>;
  incidents_by_subnet: Record<string, number>;
  score_spark: number[];
  actions: Record<string, number>;
  prefs: Record<string, number>;
};

export default function Analytics() {
  const [data, setData] = useState<Pulse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Pulse>("/api/analytics")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, []);

  if (!data) return <Loading>Loading pulse…</Loading>;
  const spark = data.score_spark;
  const max = Math.max(...spark, 0.01);
  const path = spark
    .map((y, i) => `${i === 0 ? "M" : "L"} ${i * (320 / Math.max(spark.length - 1, 1))} ${80 - (y / max) * 70}`)
    .join(" ");

  return (
    <div className="console-gutter py-8">
      <PageHead
        n="06"
        kicker="Pulse"
        title="Detection quality"
        lede="MTTD lives on Command; this page is mix and score shape."
      />
      {error ? <Alert>{error}</Alert> : null}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Panel title="Anomaly scores">
          <svg viewBox="0 0 320 90" className="w-full" role="img" aria-label="Anomaly score sparkline">
            <path d={path} fill="none" stroke="#2de2e6" strokeWidth="1.6" />
          </svg>
        </Panel>
        <Bars title="MITRE" rows={data.mitre} />
        <Bars title="Incidents by subnet" rows={data.incidents_by_subnet} />
        <Bars title="Executed actions" rows={data.actions} />
      </div>
    </div>
  );
}

function Bars({ title, rows }: { title: string; rows: Record<string, number> }) {
  const entries = Object.entries(rows);
  const max = Math.max(...entries.map(([, n]) => n), 1);
  return (
    <Panel title={title}>
      {entries.length === 0 ? (
        <p className="text-sm text-mute">No data yet. Simulate ticks from Command.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map(([k, n]) => (
            <li key={k}>
              <div className="flex justify-between font-mono text-xs">
                <span>{k}</span>
                <span className="tabular-nums text-mute">{n}</span>
              </div>
              <div className="mt-1 h-px bg-raised">
                <div className="h-px bg-accent" style={{ width: `${(n / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
