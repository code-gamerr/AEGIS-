"""Public NIDS rows + advanced synthetic campaigns mapped into AEGIS features.

Isolation Forest stays unsupervised. `labeled_attack` is scoring-only.
Red labels are abstract (recon / access / pivot / persist / degrade) — no payloads.
"""

from __future__ import annotations

import csv
import random
import urllib.request
from pathlib import Path

from app.gym import SUBNETS, subnet_of
from app.paths import data_dir
from app.sim import attack_event, benign_event

NSL_KDD_URLS = {
    "KDDTrain+.txt": "https://raw.githubusercontent.com/defcom17/NSL_KDD/master/KDDTrain%2B.txt",
    "KDDTest+.txt": "https://raw.githubusercontent.com/defcom17/NSL_KDD/master/KDDTest%2B.txt",
}
OPS_SERVICES = {"klogin", "kshell", "sql_net", "sunrpc", "domain", "domain_u", "eco_i", "ecr_i"}
SAMPLE_NSL = (
    "0,tcp,ftp_data,SF,491,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,"
    "0.00,0.00,0.00,0.00,1.00,0.00,0.00,150,25,0.17,0.03,0.17,0.00,0.00,0.00,0.05,0.00,normal,20"
)


def _f(v: str, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def map_nslkdd_row(parts: list[str]) -> dict | None:
    if len(parts) < 42:
        return None
    service = parts[2]
    src_bytes = _f(parts[4])
    failed = _f(parts[10])
    logged_in = _f(parts[11])
    root_shell = _f(parts[13])
    su_attempted = _f(parts[14])
    shells = _f(parts[17])
    files_created = _f(parts[16])
    guest = _f(parts[21])
    conn_count = _f(parts[22])
    same_srv = _f(parts[28])
    rerror = _f(parts[26])
    label = parts[41].strip().strip(".").lower()
    dest_ops = 1 if service in OPS_SERVICES else 0
    if dest_ops:
        asset = random.choice(SUBNETS["ops"])
    elif service in {"http", "smtp", "ftp", "ftp_data", "ssh"}:
        asset = random.choice(SUBNETS["ent"])
    else:
        asset = random.choice(SUBNETS["user"])
    return {
        "asset_id": asset,
        "hour": int(_f(parts[0]) / 3600) % 24,
        "bytes_out": src_bytes,
        "failed_auth": int(failed),
        "privilege_change": int(root_shell > 0 or su_attempted > 0),
        "unusual_proc": int(shells > 0 or files_created > 2),
        "east_west": int(same_srv < 0.45 and subnet_of(asset) != "ops"),
        "dest_ops": dest_ops,
        "identity_anom": int(guest > 0 or (logged_in == 0 and failed > 0)),
        "dns_entropy": 4.6 if service.startswith("domain") else round(1.6 + 2.4 * rerror, 3),
        "conn_burst": int(min(conn_count, 40)),
        "labeled_attack": label != "normal",
        "nsl_label": label,
        "source": "nsl-kdd",
    }


def fetch_nslkdd(name: str, cache: Path) -> Path | None:
    dest = cache / name
    if dest.exists() and dest.stat().st_size > 10_000:
        return dest
    url = NSL_KDD_URLS.get(name)
    if not url:
        return None
    try:
        cache.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url, timeout=45) as resp, dest.open("wb") as fh:
            fh.write(resp.read())
        return dest if dest.stat().st_size > 10_000 else None
    except Exception:
        if dest.exists():
            dest.unlink()
        return None


def load_nslkdd(path: Path, limit: int, rng: random.Random) -> list[dict]:
    rows: list[dict] = []
    with path.open(encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            mapped = map_nslkdd_row(next(csv.reader([line.strip()])))
            if mapped:
                rows.append(mapped)
            if len(rows) >= limit * 4:
                break
    if len(rows) > limit:
        rows = rng.sample(rows, limit)
    return rows


def campaign_events(n_campaigns: int = 400, rng: random.Random | None = None) -> list[dict]:
    """Multi-stage abstract campaigns: recon → access → pivot → persist → degrade telemetry."""
    rng = rng or random.Random(7)
    rows: list[dict] = []
    stages = [
        {"failed_auth": 6, "conn_burst": 8, "event_type": "auth.fail_burst", "mitre": "T1110"},
        {"east_west": 1, "dest_ops": 1, "conn_burst": 9, "event_type": "net.east_west", "mitre": "T1021"},
        {"unusual_proc": 1, "privilege_change": 1, "event_type": "host.unusual_proc", "mitre": "T1548"},
        {"bytes_out": 3_200_000, "dns_entropy": 4.8, "event_type": "net.exfil_volume", "mitre": "T1048"},
        {"identity_anom": 1, "dest_ops": 1, "event_type": "idp.impossible_travel", "mitre": "T1078"},
    ]
    for i in range(n_campaigns):
        chain = rng.sample(stages, k=rng.randint(3, 5))
        hour = rng.choice([2, 3, 4, 22, 23])
        asset = rng.choice(SUBNETS["user"] + SUBNETS["ent"])
        for j, stage in enumerate(chain):
            ev = attack_event(asset if j < 2 else rng.choice(SUBNETS["ent"] + SUBNETS["ops"]))
            ev.update(stage)
            ev["hour"] = (hour + j) % 24
            ev["labeled_attack"] = True
            ev["source"] = "synthetic-campaign"
            ev["campaign_id"] = f"c{i}"
            rows.append(ev)
        for _ in range(rng.randint(2, 5)):
            b = benign_event()
            b["hour"] = rng.randint(8, 18)
            b["source"] = "synthetic-campaign"
            rows.append(b)
    return rows


def rare_benign_spikes(n: int = 200, rng: random.Random | None = None) -> list[dict]:
    rng = rng or random.Random(11)
    rows = []
    for _ in range(n):
        ev = benign_event()
        ev["bytes_out"] = rng.uniform(80_000, 180_000)
        ev["conn_burst"] = rng.randint(3, 5)
        ev["dns_entropy"] = rng.uniform(3.0, 3.8)
        ev["labeled_attack"] = False
        ev["source"] = "synthetic-benign-spike"
        rows.append(ev)
    return rows


def score_detector(detector, rows: list[dict], threshold: float = 0.62) -> dict:
    y = [1 if r.get("labeled_attack") else 0 for r in rows]
    p = [1 if detector.score(r) >= threshold else 0 for r in rows]
    tp = sum(a and b for a, b in zip(y, p))
    fp = sum((not a) and b for a, b in zip(y, p))
    fn = sum(a and (not b) for a, b in zip(y, p))
    tn = sum((not a) and (not b) for a, b in zip(y, p))
    prec = tp / max(tp + fp, 1)
    rec = tp / max(tp + fn, 1)
    return {
        "threshold": threshold,
        "n": len(rows),
        "positives": int(sum(y)),
        "predicted_pos": int(sum(p)),
        "precision": round(prec, 4),
        "recall": round(rec, 4),
        "f1": round(2 * prec * rec / max(prec + rec, 1e-9), 4),
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
    }


def build_corpus(allow_download: bool = True, rng: random.Random | None = None) -> dict:
    rng = rng or random.Random(7)
    cache = data_dir() / "cache"
    public: list[dict] = []
    holdout: list[dict] = []
    sources = []
    if allow_download:
        train_p = fetch_nslkdd("KDDTrain+.txt", cache)
        test_p = fetch_nslkdd("KDDTest+.txt", cache)
        if train_p:
            public = load_nslkdd(train_p, 6000, rng)
            sources.append("nsl-kdd-train")
        if test_p:
            holdout = load_nslkdd(test_p, 3000, rng)
            sources.append("nsl-kdd-test")
    synthetic = campaign_events(500, rng) + rare_benign_spikes(250, rng)
    sources.append("synthetic-campaigns")
    if not public:
        public = [benign_event() for _ in range(800)] + [attack_event() for _ in range(200)]
        sources.append("sim-fallback")
    if not holdout:
        holdout = synthetic[::5]
    fit_rows = public + synthetic
    rng.shuffle(fit_rows)
    return {
        "fit_rows": fit_rows,
        "holdout": holdout,
        "sources": sources,
        "n_fit": len(fit_rows),
        "n_holdout": len(holdout),
        "n_public": len(public),
        "n_synthetic": len(synthetic),
        "n_attack_fit": sum(1 for r in fit_rows if r.get("labeled_attack")),
    }
