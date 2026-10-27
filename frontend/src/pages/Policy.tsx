import { useEffect, useState } from "react";
import { api } from "../api";
import { Alert, Btn, LoadError, Loading, PageHead, Panel } from "../components/ui";

type PolicyOut = {
  epsilon: number;
  states: number;
  prefs: Record<string, number>;
  actions: string[];
  platform: string;
  gcs_uri: string | null;
  history: { ts: string | null; episodes: number; avg_reward: number; epsilon: number; notes: string }[];
};

export default function Policy() {
  const [data, setData] = useState<PolicyOut | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");
  const [gcs, setGcs] = useState("");

  async function load() {
    try {
      const body = await api<PolicyOut>("/api/policy");
      setData(body);
      if (body.gcs_uri) setGcs(body.gcs_uri);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function train() {
    setPending("train");
    try {
      await api("/api/policy/train", { method: "POST", body: JSON.stringify({ episodes: 80 }) });
      await load();
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Train failed");
    } finally {
      setPending("");
    }
  }

  async function onImport(file: File) {
    setPending("import");
    try {
      const parsed = JSON.parse(await file.text()) as {
        q?: Record<string, number[]>;
        epsilon?: number;
        platform?: string;
        episodes?: number;
        avg_reward?: number;
      };
      if (!parsed.q) throw new Error("File needs a `q` map — use q_policy.json from Kaggle/GCS");
      await api("/api/policy/import", {
        method: "POST",
        body: JSON.stringify({
          q: parsed.q,
          epsilon: parsed.epsilon ?? 0.05,
          platform: parsed.platform ?? "kaggle",
          notes: file.name,
          episodes: parsed.episodes ?? 0,
          avg_reward: parsed.avg_reward ?? 0,
        }),
      });
      await load();
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setPending("");
    }
  }

  async function pull() {
    setPending("pull");
    try {
      await api("/api/policy/pull", { method: "POST", body: JSON.stringify({ uri: gcs || null }) });
      await load();
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "GCS pull failed");
    } finally {
      setPending("");
    }
  }

  if (!data) {
    if (error) return <LoadError message={error} onRetry={() => void load()} />;
    return <Loading>Loading policy…</Loading>;
  }
  const max = Math.max(...Object.values(data.prefs).map(Math.abs), 0.01);

  return (
    <div className="console-gutter py-8">
      <PageHead
        n="04"
        kicker="Policy"
        title="Train anywhere. Import one file."
        lede="Train locally, or on Kaggle / Vertex AI, then import q_policy.json. Isolate and contain pay an availability tax so the agent cannot nuke the estate for a cheap win."
        action={
          <div className="flex flex-wrap gap-2">
            <Btn variant="primary" className="h-10 px-5" onClick={train} disabled={!!pending}>
              {pending === "train" ? "Training…" : "Train 80 local"}
            </Btn>
            <label
              className="inline-flex h-10 cursor-pointer items-center rounded-full border border-line px-5 font-mono text-[0.72rem] uppercase tracking-[0.16em] hover:border-accent focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent"
              aria-busy={pending === "import"}
            >
              Import q_policy.json
              <input
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onImport(f);
                }}
              />
            </label>
          </div>
        }
      />
      {error ? <Alert>{error}</Alert> : null}
      <p className="kicker mt-6">
        {data.states} states · ε {data.epsilon.toFixed(3)} · {data.platform}
      </p>

      <section className="mt-8 grid gap-4 lg:grid-cols-2">
        <Panel title="Laptop or notebook" hint="Upload backend/ as dataset aegis-src. Run the Kaggle notebook with Internet on. Download q_policy.json and import it here.">
          <p className="kicker">Local · Kaggle</p>
        </Panel>
        <Panel title="Same job, remote box" hint="Submit the job in train/gcp. When it finishes, pull the artifact from a Cloud Storage URI.">
          <p className="kicker">Vertex AI</p>
          <label className="kicker mt-4 block" htmlFor="gcs">
            gs:// URI
          </label>
          <input
            id="gcs"
            className="mt-1 w-full rounded-sm border border-line bg-ink px-3 py-2 font-mono text-xs"
            value={gcs}
            onChange={(e) => setGcs(e.target.value)}
            placeholder="gs://bucket/aegis/policy"
          />
          <Btn className="mt-3 h-10 px-5" onClick={pull} disabled={!!pending}>
            {pending === "pull" ? "Pulling…" : "Pull from GCS"}
          </Btn>
        </Panel>
      </section>

      <ul className="mt-8 space-y-3">
        {data.actions.map((a) => {
          const v = data.prefs[a] || 0;
          const w = Math.max(4, (Math.abs(v) / max) * 100);
          return (
            <li key={a}>
              <div className="flex justify-between font-mono text-xs">
                <span className="uppercase tracking-[0.14em]">{a}</span>
                <span className="tabular-nums text-mute">{v.toFixed(3)}</span>
              </div>
              <div className="mt-1 h-px bg-raised">
                <div className="h-px bg-accent" style={{ width: `${w}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      <h2 className="display mt-10 text-2xl">Training snapshots</h2>
      <ul className="mt-4 divide-y divide-line rounded-sm border border-line">
        {data.history.length === 0 ? (
          <li className="px-3 py-3 text-sm text-mute">No snapshots yet.</li>
        ) : (
          data.history.map((h, i) => (
            <li key={i} className="flex flex-wrap justify-between gap-2 px-3 py-3 text-sm">
              <span>{h.notes || "train"}</span>
              <span className="font-mono text-xs tabular-nums text-mute">
                {h.episodes} ep · R̄ {h.avg_reward}
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
