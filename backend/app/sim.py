from __future__ import annotations

import random
from datetime import datetime, timezone

from app.gym import SUBNETS, subnet_of

SOURCES = ["k8s-audit", "vpc-flow", "idp", "host-agent", "dns"]
BENIGN_TYPES = [
    "auth.success",
    "net.flow",
    "k8s.deploy",
    "dns.query",
    "host.cron",
    "idp.token_refresh",
]
ATTACK_PLAYS = [
    {
        "event_type": "auth.fail_burst",
        "mitre": "T1110",
        "failed_auth": 6,
        "identity_anom": 1,
        "severity": 2,
        "summary": "Burst of failed authentications on a user host.",
    },
    {
        "event_type": "net.east_west",
        "mitre": "T1021",
        "east_west": 1,
        "dest_ops": 1,
        "conn_burst": 8,
        "severity": 3,
        "summary": "East-west flow toward an operations subnet.",
    },
    {
        "event_type": "host.unusual_proc",
        "mitre": "T1548",
        "unusual_proc": 1,
        "privilege_change": 1,
        "severity": 3,
        "summary": "Unusual process after a privilege change.",
    },
    {
        "event_type": "net.exfil_volume",
        "mitre": "T1048",
        "bytes_out": 3_200_000,
        "dns_entropy": 4.8,
        "severity": 3,
        "summary": "High outbound volume with noisy DNS.",
    },
    {
        "event_type": "idp.impossible_travel",
        "mitre": "T1078",
        "identity_anom": 1,
        "dest_ops": 1,
        "severity": 2,
        "summary": "Identity used from an anomalous path into ops.",
    },
]


def _asset_ids() -> list[str]:
    return [n for nodes in SUBNETS.values() for n in nodes]


def benign_event(asset_id: str | None = None) -> dict:
    asset_id = asset_id or random.choice(_asset_ids())
    hour = random.choice(list(range(8, 19)) + [random.randint(0, 23)])
    return {
        "ts": datetime.now(timezone.utc),
        "asset_id": asset_id,
        "source": random.choice(SOURCES),
        "event_type": random.choice(BENIGN_TYPES),
        "severity": 1,
        "bytes_out": max(200.0, random.gauss(45_000, 18_000)),
        "failed_auth": int(random.random() < 0.05),
        "privilege_change": 0,
        "unusual_proc": 0,
        "east_west": int(subnet_of(asset_id) != "ops" and random.random() < 0.18),
        "dest_ops": 0,
        "identity_anom": 0,
        "dns_entropy": random.uniform(1.4, 3.1),
        "conn_burst": random.randint(0, 3),
        "mitre": "",
        "summary": "Routine control-plane or user activity.",
        "pii_tag": "none",
        "labeled_attack": False,
        "hour": hour,
    }


def attack_event(asset_id: str | None = None) -> dict:
    play = dict(random.choice(ATTACK_PLAYS))
    if play["mitre"] in {"T1021", "T1048", "T1078"}:
        asset_id = asset_id or random.choice(SUBNETS["ent"] + SUBNETS["ops"])
    else:
        asset_id = asset_id or random.choice(SUBNETS["user"] + SUBNETS["ent"])
    base = benign_event(asset_id)
    base.update(play)
    base["labeled_attack"] = True
    base["source"] = random.choice(SOURCES)
    base["pii_tag"] = "identity" if "auth" in play["event_type"] or "idp" in play["event_type"] else "none"
    return base


def burst(n: int = 8, attack_p: float = 0.18) -> list[dict]:
    rows = []
    for _ in range(n):
        rows.append(attack_event() if random.random() < attack_p else benign_event())
    return rows
