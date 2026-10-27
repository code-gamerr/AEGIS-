import { BLUE_ACTIONS, HIGH_IMPACT, type Incident } from "../api";
import { cn } from "../cn";

export function ActRow({
  inc,
  role,
  frozen,
  busy,
  onAct,
}: {
  inc: Incident;
  role: string;
  frozen?: boolean;
  busy: string;
  onAct: (inc: Incident, action: string) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {BLUE_ACTIONS.map((a) => {
        const gated = role === "analyst" && HIGH_IMPACT.has(a);
        const rec = inc.recommended === a;
        return (
          <button
            key={a}
            type="button"
            className={cn(
              "rounded-full border px-3 py-1.5 font-mono text-[0.66rem] uppercase tracking-[0.14em] disabled:opacity-50",
              rec
                ? "border-accent text-accent"
                : "border-line text-mute hover:border-accent hover:text-paper",
            )}
            disabled={busy.startsWith(`${inc.id}:`) || gated || !!frozen}
            title={frozen ? "kill switch on" : gated ? "operator required" : undefined}
            onClick={() => onAct(inc, a)}
          >
            {a}
          </button>
        );
      })}
    </div>
  );
}
