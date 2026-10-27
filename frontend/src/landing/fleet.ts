/** In-browser copy of backend NetworkGym + tabular Q. Abstract Red labels only. */

export const BLUE = ["monitor", "decoy", "isolate", "restore"] as const;
export type Blue = (typeof BLUE)[number];
export const GATED = new Set<Blue>(["isolate", "restore"]);
export const RED = ["recon", "attempt_access", "pivot", "persist", "degrade"] as const;
export type RedKind = "meander" | "bline";

export const SUBNETS = {
  user: ["ws-1", "ws-2", "ws-3", "vpn-gw"],
  ent: ["app-api", "id-svc", "ci-runner", "db-core"],
  ops: ["k8s-api", "pay-proc", "tel-bus", "vault"],
} as const;
export type Zone = keyof typeof SUBNETS;

const EDGES: Record<string, string[]> = {
  "ws-1": ["vpn-gw", "ws-2"],
  "ws-2": ["ws-1", "ws-3", "vpn-gw"],
  "ws-3": ["ws-2", "vpn-gw"],
  "vpn-gw": ["ws-1", "ws-2", "ws-3", "app-api", "id-svc"],
  "app-api": ["vpn-gw", "db-core", "id-svc", "ci-runner"],
  "id-svc": ["vpn-gw", "app-api", "k8s-api"],
  "ci-runner": ["app-api", "k8s-api"],
  "db-core": ["app-api", "vault"],
  "k8s-api": ["id-svc", "ci-runner", "tel-bus", "pay-proc"],
  "pay-proc": ["k8s-api", "vault"],
  "tel-bus": ["k8s-api"],
  vault: ["db-core", "pay-proc"],
};
const CRITICAL = new Set(["k8s-api", "pay-proc", "vault", "db-core"]);
const HOSTS = Object.values(SUBNETS).flat();

export type Host = {
  compromised: boolean;
  isolated: boolean;
  decoy: boolean;
  up: boolean;
  scanned: boolean;
  persisted: boolean;
};
export type LogLine = { actor: "red" | "blue"; action: string; target: string; note: string };
export type StateKey = string;

export function zoneOf(node: string): Zone {
  if ((SUBNETS.ent as readonly string[]).includes(node)) return "ent";
  if ((SUBNETS.ops as readonly string[]).includes(node)) return "ops";
  return "user";
}

export function risk(h: Host, name: string): number {
  let s = 0.04;
  if (h.scanned) s += 0.16;
  if (h.compromised) s += 0.38;
  if (h.persisted) s += 0.2;
  if (!h.up) s += 0.22;
  if (CRITICAL.has(name) && h.compromised) s += 0.16;
  if (h.isolated) s *= 0.35;
  return Math.min(1, Math.max(0, s));
}

function keyOf(progress: number, compromised: number, isolated: number, sev: number, decoy: number): StateKey {
  return `${progress},${compromised},${isolated},${sev},${decoy}`;
}

export class Fleet {
  red: RedKind = "meander";
  hosts: Record<string, Host> = {};
  redPos: string | null = null;
  redProgress = 0;
  step = 0;
  lastSev = 0;
  done = false;
  outcome = "ongoing";
  log: LogLine[] = [];
  q = new Map<StateKey, number[]>();
  eps = 1;
  episodes = 0;
  returns: number[] = [];
  epReturn = 0;
  lastReward = 0;
  lastBlue: Blue | null = null;
  pending: { action: Blue; target: string; values: number[] } | null = null;
  private rng: () => number;

  constructor(seed = 7) {
    this.rng = mulberry(seed);
    this.boot();
  }

  private boot() {
    this.hosts = Object.fromEntries(
      HOSTS.map((n) => [n, { compromised: false, isolated: false, decoy: false, up: true, scanned: false, persisted: false }]),
    );
    this.redPos = null;
    this.redProgress = 0;
    this.step = 0;
    this.lastSev = 0;
    this.done = false;
    this.outcome = "ongoing";
    this.log = [];
    this.epReturn = 0;
    this.lastReward = 0;
    this.lastBlue = null;
    this.pending = null;
  }

  resetWorld() {
    this.boot();
  }

  resetLearner() {
    this.q.clear();
    this.eps = 1;
    this.episodes = 0;
    this.returns = [];
    this.boot();
  }

  obs() {
    return {
      red_progress: this.redProgress,
      compromised: HOSTS.filter((n) => this.hosts[n].compromised).length,
      isolated: HOSTS.filter((n) => this.hosts[n].isolated).length,
      last_sev: this.lastSev,
      decoy: HOSTS.some((n) => this.hosts[n].decoy),
    };
  }

  stateKey() {
    const o = this.obs();
    return keyOf(
      Math.min(4, o.red_progress),
      Math.min(3, o.compromised),
      Math.min(2, o.isolated),
      Math.min(3, o.last_sev),
      o.decoy ? 1 : 0,
    );
  }

  values(k = this.stateKey()) {
    let v = this.q.get(k);
    if (!v) {
      v = [0, 0, 0, 0];
      this.q.set(k, v);
    }
    return v;
  }

  pick(greedy = false): Blue {
    const v = this.values();
    if (!greedy && this.rng() < this.eps) return BLUE[Math.floor(this.rng() * BLUE.length)]!;
    let b = 0;
    for (let i = 1; i < v.length; i++) if (v[i]! > v[b]!) b = i;
    return BLUE[b]!;
  }

  /** One Red then Blue step. High-impact verbs pause unless `autonomy`. */
  tick(autonomy: boolean): "ok" | "gated" | "ended" {
    if (this.pending) return "gated";
    if (this.done) {
      this.returns.push(this.epReturn);
      this.episodes += 1;
      this.eps = Math.max(0.05, this.eps * 0.965);
      this.boot();
    }
    const prev = this.stateKey();
    this.redStep();
    const action = this.pick();
    const target = this.redPos || "ws-1";
    if (GATED.has(action) && !autonomy) {
      this.pending = { action, target, values: this.values().slice() };
      this._prev = prev;
      return "gated";
    }
    this.applyBlue(prev, action);
    return this.done ? "ended" : "ok";
  }

  approve() {
    if (!this.pending) return;
    const { action } = this.pending;
    const prev = this._prev || this.stateKey();
    this.pending = null;
    this.applyBlue(prev, action);
  }

  reject() {
    if (!this.pending) return;
    const prev = this._prev || this.stateKey();
    this.pending = null;
    this.applyBlue(prev, "monitor");
  }

  private _prev: StateKey | null = null;

  private applyBlue(prev: StateKey, action: Blue) {
    const reward = this.blueStep(action);
    this.step += 1;
    this.lastReward = reward;
    this.lastBlue = action;
    this.epReturn += reward;
    if (this.step >= 32 && !this.done) {
      this.done = true;
      this.outcome = "timeout";
    }
    const nxt = this.stateKey();
    const a = BLUE.indexOf(action);
    const qsa = this.values(prev)[a]!;
    const target = this.done ? reward : reward + 0.93 * Math.max(...this.values(nxt));
    this.values(prev)[a] = qsa + 0.18 * (target - qsa);
  }

  private push(actor: LogLine["actor"], action: string, target: string, note: string) {
    this.log.push({ actor, action, target, note });
    if (this.log.length > 14) this.log.shift();
  }

  private redStep() {
    const s = this;
    let pos = s.redPos;
    if (pos == null) {
      const pool = s.red === "bline" ? ["vpn-gw"] : [...SUBNETS.user];
      const target = pool[Math.floor(s.rng() * pool.length)]!;
      s.hosts[target]!.scanned = true;
      s.redPos = target;
      s.lastSev = 1;
      s.push("red", "recon", target, "Abstract recon on a user-subnet host.");
      return;
    }
    const host = s.hosts[pos]!;
    if (host.isolated) {
      s.redPos = null;
      s.push("red", "blocked", pos, "Path cut; red lost the foothold.");
      return;
    }
    if (host.decoy && !host.compromised) {
      s.lastSev = 1;
      s.push("red", "recon", pos, "Red spent a turn on a decoy.");
      return;
    }
    if (!host.compromised) {
      if (s.rng() < 0.55) {
        host.compromised = true;
        s.redProgress = Math.max(s.redProgress, 1);
        s.lastSev = 2;
        s.push("red", "attempt_access", pos, "Abstract access attempt succeeded.");
      } else {
        host.scanned = true;
        s.push("red", "attempt_access", pos, "Abstract access attempt failed.");
      }
      return;
    }
    if (!host.persisted && s.rng() < 0.4) {
      host.persisted = true;
      s.redProgress = Math.max(s.redProgress, 3);
      s.push("red", "persist", pos, "Abstract persistence flag set.");
      return;
    }
    if (s.red === "bline" && CRITICAL.has(pos) && host.compromised) {
      host.up = false;
      s.redProgress = 4;
      s.lastSev = 3;
      s.done = true;
      s.outcome = "impact";
      s.push("red", "degrade", pos, "Abstract service degradation in ops.");
      return;
    }
    const nbrs = (EDGES[pos] || []).filter((n) => !s.hosts[n]!.isolated);
    const ops = nbrs.filter((n) => zoneOf(n) === "ops");
    const choice =
      s.red === "bline"
        ? towardOps(pos, (n) => s.hosts[n]!.isolated)
        : pick(ops.length ? ops : nbrs, s.rng) || pos;
    if (zoneOf(choice) === "ops" && s.hosts[choice]!.compromised) {
      s.hosts[choice]!.up = false;
      s.redProgress = 4;
      s.lastSev = 3;
      s.done = true;
      s.outcome = "impact";
      s.push("red", "degrade", choice, "Abstract service degradation in ops.");
      return;
    }
    s.redPos = choice;
    s.hosts[choice]!.scanned = true;
    if (!s.hosts[choice]!.compromised && s.rng() < 0.5) {
      s.hosts[choice]!.compromised = true;
      s.redProgress = Math.max(s.redProgress, 2);
      s.lastSev = 2;
      s.push("red", "pivot", choice, "Abstract pivot to adjacent host.");
      return;
    }
    s.push("red", "recon", choice, "Abstract recon after pivot.");
  }

  private blueStep(action: Blue): number {
    const s = this;
    let reward = 0.2;
    const target = s.redPos || "ws-1";
    const h = s.hosts[target]!;
    if (action === "monitor") {
      s.lastSev = Math.max(s.lastSev, h.compromised ? 1 : 0);
      s.push("blue", "monitor", target, "Deep inspection, no blast radius.");
      reward += h.compromised ? 0.4 : -0.05;
    } else if (action === "decoy") {
      h.decoy = true;
      s.push("blue", "decoy", target, "Decoy service advertised.");
      reward += 0.6;
    } else if (action === "isolate") {
      h.isolated = true;
      reward -= 0.8;
      if (h.compromised) {
        reward += 3.5;
        if (CRITICAL.has(target)) reward += 2;
      } else reward -= 2.2;
      s.push("blue", "isolate", target, "Network isolation of the host.");
    } else {
      const was = h.compromised;
      h.compromised = false;
      h.persisted = false;
      h.isolated = false;
      h.up = true;
      if (s.redPos === target) {
        s.redPos = null;
        s.redProgress = Math.max(0, s.redProgress - 1);
      }
      reward += was ? 4 : -1.5;
      s.push("blue", "restore", target, "Host rebuilt from known-good image.");
    }
    const nComp = HOSTS.filter((n) => s.hosts[n]!.compromised).length;
    const nIso = HOSTS.filter((n) => s.hosts[n]!.isolated).length;
    const nDown = HOSTS.filter((n) => !s.hosts[n]!.up).length;
    reward -= 1.4 * nComp + 0.35 * nIso + 2.5 * nDown;
    if (SUBNETS.ops.some((n) => s.hosts[n]!.compromised)) reward -= 4;
    if (nComp === 0 && nDown === 0) {
      reward += 1.2;
      if (s.step > 6) {
        s.done = true;
        s.outcome = "contained";
      }
    }
    return Math.round(reward * 1000) / 1000;
  }
}

function pick<T>(arr: T[], rng: () => number): T | undefined {
  if (!arr.length) return undefined;
  return arr[Math.floor(rng() * arr.length)];
}

function towardOps(pos: string, blocked: (n: string) => boolean): string {
  const goals = [...CRITICAL].filter((n) => !blocked(n));
  const q = [pos];
  const parent = new Map<string, string | null>([[pos, null]]);
  let found: string | null = null;
  for (let i = 0; i < q.length; i++) {
    const cur = q[i]!;
    if (goals.includes(cur) && cur !== pos) {
      found = cur;
      break;
    }
    for (const n of EDGES[cur] || []) {
      if (parent.has(n) || blocked(n)) continue;
      parent.set(n, cur);
      q.push(n);
    }
  }
  if (!found) {
    const nbrs = (EDGES[pos] || []).filter((n) => !blocked(n));
    return nbrs[0] || pos;
  }
  let cur = found;
  while (parent.get(cur) && parent.get(cur) !== pos) cur = parent.get(cur)!;
  return cur;
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
