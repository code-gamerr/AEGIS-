import { useEffect, useState } from "react";
import { api, type Governance as Gov } from "../api";
import { Alert, Btn, Loading, PageHead } from "../components/ui";

type Out = {
  settings: Gov;
  audit: { id: number; ts: string | null; actor: string; action: string; resource: string; detail: string; purpose: string }[];
};

export default function Governance() {
  const [data, setData] = useState<Out | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    setData(await api<Out>("/api/governance"));
  }

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, []);

  async function patch(body: Partial<Gov>) {
    setBusy("save");
    try {
      await api("/api/governance", { method: "POST", body: JSON.stringify(body) });
      await load();
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy("");
    }
  }

  async function purge() {
    setBusy("purge");
    try {
      await api("/api/governance/purge", { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Purge failed");
    } finally {
      setBusy("");
    }
  }

  if (!data) return <Loading>Loading ledger…</Loading>;
  const s = data.settings;

  return (
    <div>
      {s.kill_switch ? (
        <p className="border-b border-bad bg-panel px-6 py-2 text-sm text-bad lg:px-8" role="status">
          Kill switch is on. Isolate, restore, and contain are frozen.
        </p>
      ) : null}
      <div className="console-gutter py-8">
        <PageHead
          n="05"
          kicker="Ledger"
          title="Every mutation is audited"
          lede="High-impact actions stay operator-gated unless autonomy is explicitly enabled."
        />
        {error ? <Alert>{error}</Alert> : null}
        <div className="mt-8 grid gap-3 md:grid-cols-2">
          <Toggle
            label="Kill switch"
            hint="Freeze isolate / restore / contain."
            on={s.kill_switch}
            disabled={busy === "save"}
            onClick={() => patch({ kill_switch: !s.kill_switch })}
          />
          <Toggle
            label="Autonomy"
            hint="Allow the policy to propose auto low-impact moves."
            on={s.autonomy_enabled}
            disabled={busy === "save"}
            onClick={() => patch({ autonomy_enabled: !s.autonomy_enabled })}
          />
          <Toggle
            label="Auto isolate"
            hint="Permit isolate without a click. Off by default."
            on={s.auto_isolate}
            disabled={busy === "save"}
            onClick={() => patch({ auto_isolate: !s.auto_isolate })}
          />
          <div className="rounded-sm border border-line bg-panel p-6">
            <p className="display text-2xl">Retention</p>
            <p className="kicker mt-3">{s.retention_days} days · {s.purpose}</p>
            <Btn className="mt-4 h-10 px-5" onClick={purge} disabled={busy === "purge"}>
              Purge expired telemetry
            </Btn>
          </div>
        </div>
        <h2 className="display mt-10 text-2xl">Audit trail</h2>
        <ul className="mt-4 max-h-[28rem] overflow-auto rounded-sm border border-line">
          {data.audit.map((a) => (
            <li key={a.id} className="border-b border-line px-3 py-2 text-sm last:border-0">
              <span className="font-mono text-xs text-accent">{a.actor}</span> {a.action}{" "}
              <span className="text-mute">{a.resource}</span>
              <p className="truncate text-xs text-mute">{a.detail}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  on,
  disabled,
  onClick,
}: {
  label: string;
  hint: string;
  on: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex items-start justify-between gap-4 rounded-sm border border-line bg-panel p-6 text-left hover:border-accent disabled:opacity-50"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
    >
      <span>
        <span className="display block text-2xl">{label}</span>
        <span className="mt-2 block text-pretty text-sm text-mute">{hint}</span>
      </span>
      <span className="lx-switch mt-1" data-on={on ? "true" : "false"} aria-hidden>
        <i />
      </span>
    </button>
  );
}
