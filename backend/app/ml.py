from __future__ import annotations

import json
import math
import random
from collections import defaultdict
from pathlib import Path

import numpy as np
import joblib
from sklearn.ensemble import IsolationForest

from app.paths import data_dir

FEATURE_NAMES = [
    "hour",
    "bytes_out_log",
    "failed_auth",
    "privilege_change",
    "unusual_proc",
    "east_west",
    "dest_ops",
    "identity_anom",
    "dns_entropy",
    "conn_burst",
]

BLUE_ACTIONS = ["monitor", "decoy", "isolate", "restore", "contain"]
HIGH_IMPACT = {"isolate", "restore", "contain"}


def event_vector(ev: dict, hour: int | None = None) -> list[float]:
    bout = float(ev.get("bytes_out") or 0)
    return [
        float(hour if hour is not None else ev.get("hour", 12)),
        math.log1p(max(bout, 0.0)),
        float(ev.get("failed_auth") or 0),
        float(ev.get("privilege_change") or 0),
        float(ev.get("unusual_proc") or 0),
        float(ev.get("east_west") or 0),
        float(ev.get("dest_ops") or 0),
        float(ev.get("identity_anom") or 0),
        float(ev.get("dns_entropy") or 0),
        float(ev.get("conn_burst") or 0),
    ]


class AnomalyDetector:
    def __init__(self) -> None:
        self.model = IsolationForest(
            n_estimators=80,
            contamination=0.08,
            random_state=7,
        )
        self.fitted = False

    def fit(self, rows: list[dict]) -> None:
        if len(rows) < 16:
            rows = rows + [_benign_row() for _ in range(32)]
        X = np.array([event_vector(r) for r in rows], dtype=float)
        self.model.fit(X)
        self.fitted = True

    def save(self, path=None) -> None:
        path = path or (data_dir() / "iforest.joblib")
        joblib.dump({"model": self.model, "fitted": self.fitted}, path)

    def load(self, path=None) -> bool:
        path = path or (data_dir() / "iforest.joblib")
        if not Path(path).exists():
            return False
        payload = joblib.load(path)
        self.model = payload["model"]
        self.fitted = bool(payload.get("fitted", True))
        return True

    def score(self, ev: dict) -> float:
        if not self.fitted:
            return 0.0
        x = np.array([event_vector(ev)], dtype=float)
        raw = -float(self.model.score_samples(x)[0])
        return round(min(1.0, max(0.0, (raw - 0.35) / 0.5)), 4)


def _benign_row() -> dict:
    return {
        "hour": random.randint(8, 18),
        "bytes_out": random.expovariate(1 / 40_000),
        "failed_auth": int(random.random() < 0.04),
        "privilege_change": 0,
        "unusual_proc": 0,
        "east_west": int(random.random() < 0.2),
        "dest_ops": 0,
        "identity_anom": 0,
        "dns_entropy": random.uniform(1.5, 3.2),
        "conn_burst": random.randint(0, 2),
    }


def rule_hits(ev: dict) -> list[tuple[str, str, str]]:
    """Blue-team overlay. Returns (mitre, title, rationale)."""
    hits = []
    if int(ev.get("failed_auth") or 0) >= 4:
        hits.append(("T1110", "Auth brute pattern", "Repeated failed authentications on this asset."))
    if int(ev.get("east_west") or 0) and int(ev.get("dest_ops") or 0):
        hits.append(("T1021", "East-west toward ops", "Lateral movement signal into the operations subnet."))
    if int(ev.get("unusual_proc") or 0) and int(ev.get("privilege_change") or 0):
        hits.append(("T1548", "Priv + unusual process", "Privilege change paired with an unusual process."))
    if float(ev.get("bytes_out") or 0) > 2_000_000 and float(ev.get("dns_entropy") or 0) > 4.2:
        hits.append(("T1048", "Possible exfil volume", "High outbound bytes with high DNS entropy."))
    if int(ev.get("identity_anom") or 0) >= 1 and int(ev.get("dest_ops") or 0):
        hits.append(("T1078", "Identity anomaly in ops", "Abnormal identity use touching an operations asset."))
    if int(ev.get("unusual_proc") or 0) >= 1:
        hits.append(("T1059", "Unusual process", "An unusual process was observed on this asset."))
    if int(ev.get("conn_burst") or 0) >= 6:
        hits.append(("T1046", "Conn burst recon", "Connection burst consistent with network reconnaissance."))
    if float(ev.get("dns_entropy") or 0) > 4.2 and float(ev.get("bytes_out") or 0) <= 2_000_000:
        hits.append(("T1071", "High-entropy DNS", "High-entropy DNS with modest outbound volume."))
    return hits


def discretize(obs: dict) -> tuple[int, int, int, int, int]:
    progress = min(4, int(obs.get("red_progress") or 0))
    compromised = min(3, int(obs.get("compromised") or 0))
    isolated = min(2, int(obs.get("isolated") or 0))
    sev = min(3, int(obs.get("last_sev") or 0))
    decoy = 1 if obs.get("decoy") else 0
    return progress, compromised, isolated, sev, decoy


class QPolicy:
    def __init__(self) -> None:
        self.q: dict[str, list[float]] = defaultdict(lambda: [0.0] * len(BLUE_ACTIONS))
        self.epsilon = 0.2
        self.alpha = 0.18
        self.gamma = 0.93
        self.path = data_dir() / "q_policy.json"
        self.load()

    def _key(self, state: tuple) -> str:
        return ",".join(str(x) for x in state)

    def act(self, state: tuple, greedy: bool = False) -> str:
        key = self._key(state)
        if (not greedy) and random.random() < self.epsilon:
            return random.choice(BLUE_ACTIONS)
        vals = self.q[key]
        return BLUE_ACTIONS[int(np.argmax(vals))]

    def learn(self, state: tuple, action: str, reward: float, nxt: tuple, done: bool) -> None:
        a = BLUE_ACTIONS.index(action)
        key = self._key(state)
        nkey = self._key(nxt)
        qsa = self.q[key][a]
        target = reward if done else reward + self.gamma * max(self.q[nkey])
        self.q[key][a] = qsa + self.alpha * (target - qsa)

    def recommend(self, obs: dict) -> tuple[str, float]:
        state = discretize(obs)
        key = self._key(state)
        vals = self.q[key]
        idx = int(np.argmax(vals))
        mx, mn = max(vals), min(vals)
        conf = 0.5 if mx == mn else min(0.99, 0.45 + (mx - mn) / (abs(mx) + abs(mn) + 1.0))
        return BLUE_ACTIONS[idx], round(float(conf), 3)

    def action_prefs(self) -> dict[str, float]:
        totals = [0.0] * len(BLUE_ACTIONS)
        if not self.q:
            return {a: 0.0 for a in BLUE_ACTIONS}
        for vals in self.q.values():
            for i, v in enumerate(vals):
                totals[i] += v
        n = max(len(self.q), 1)
        return {BLUE_ACTIONS[i]: round(totals[i] / n, 4) for i in range(len(BLUE_ACTIONS))}

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"epsilon": self.epsilon, "q": dict(self.q)}
        self.path.write_text(json.dumps(payload), encoding="utf-8")

    def load(self) -> None:
        if not self.path.exists():
            return
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
            self.replace(payload.get("q") or {}, float(payload.get("epsilon", 0.2)), persist=False)
        except json.JSONDecodeError:
            return

    def replace(self, q: dict, epsilon: float, persist: bool = True) -> None:
        self.epsilon = float(epsilon)
        self.q = defaultdict(
            lambda: [0.0] * len(BLUE_ACTIONS),
            {str(k): [float(x) for x in v] for k, v in q.items()},
        )
        if persist:
            self.save()
