const KEY = "aegis_token";

export type Role = "admin" | "operator" | "analyst";

export function getToken() {
  return localStorage.getItem(KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(KEY, token);
  else localStorage.removeItem(KEY);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    setToken(null);
    if (!path.includes("/auth/login")) window.location.assign("/login");
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      msg = body.detail || JSON.stringify(body);
    } catch {
      msg = await res.text();
    }
    throw new Error(typeof msg === "string" ? msg : "Request failed");
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type Asset = {
  id: string;
  kind: string;
  subnet: string;
  criticality: number;
  compromised: boolean;
  isolated: boolean;
  decoy: boolean;
  up: boolean;
  pii_tag: string;
};

export type EventRow = {
  id: number;
  ts: string | null;
  asset_id: string;
  source: string;
  event_type: string;
  severity: number;
  mitre: string;
  summary: string;
  anomaly_score: number;
  pii_tag: string;
  labeled_attack: boolean;
};

export type Incident = {
  id: number;
  ts: string | null;
  asset_id: string;
  title: string;
  severity: number;
  status: string;
  mitre: string;
  recommended: string;
  confidence: number;
  approved_by: string | null;
  notes: string;
};

export type Governance = {
  autonomy_enabled: boolean;
  auto_isolate: boolean;
  retention_days: number;
  kill_switch: boolean;
  purpose: string;
};

export type Command = {
  user: { username: string; role: Role };
  kpis: Record<string, number>;
  assets: Asset[];
  events: EventRow[];
  incidents: Incident[];
  governance: Governance;
  subnets: Record<string, string[]>;
  gym: GymSnap;
};

export const BLUE_ACTIONS = ["monitor", "decoy", "isolate", "restore", "contain"] as const;
export const HIGH_IMPACT = new Set<string>(["isolate", "restore", "contain"]);

export type Me = { username: string; role: Role };

export type GymSnap = {
  step: number;
  red_pos: string | null;
  red_progress: number;
  compromised: string[];
  isolated: string[];
  decoy: string[];
  down: string[];
  done: boolean;
  outcome: string;
  last_sev: number;
  log: { actor: string; action: string; target: string; note: string }[];
  reward?: number;
  blue_action?: string;
  total_reward?: number;
};

export type Detection = {
  id: number;
  ts: string | null;
  asset_id: string;
  detector: string;
  score: number;
  mitre: string;
  title: string;
  rationale: string;
  incident_id: number | null;
};
