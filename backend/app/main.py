from __future__ import annotations

import hashlib
import hmac
import json
import math
import os
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import (
    ActionRecord,
    Asset,
    AuditLog,
    Detection,
    Governance,
    GymEpisode,
    Incident,
    PolicySnapshot,
    SessionLocal,
    SessionToken,
    TelemetryEvent,
    User,
    init_db,
    utcnow,
)
from app.gym import CRITICAL, NetworkGym, SUBNETS, subnet_of, train_policy
from app.ml import HIGH_IMPACT, AnomalyDetector, QPolicy, discretize, rule_hits
from app.paths import data_dir, detect_platform, gcs_uri
from app.sim import attack_event, benign_event, burst

detector = AnomalyDetector()
policy = QPolicy()
live_gym = NetworkGym()
login_hits: dict[str, list[datetime]] = {}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def hash_pw(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(8)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000).hex()
    return f"{salt}${digest}"


def check_pw(password: str, stored: str) -> bool:
    salt, digest = stored.split("$", 1)
    got = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000).hex()
    return hmac.compare_digest(got, digest)


def audit(db: Session, actor: str, action: str, resource: str = "", detail: str = "", purpose: str = "ops") -> None:
    db.add(AuditLog(actor=actor, action=action, resource=resource, detail=detail, purpose=purpose))


def _frozen(db: Session) -> None:
    gov = db.scalar(select(Governance).limit(1))
    if gov and gov.kill_switch:
        raise HTTPException(423, "Kill switch is on. Policy and gym mutations are frozen.")


def _q_json() -> str:
    return json.dumps(dict(policy.q))


def current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Sign in required")
    token = authorization.split(" ", 1)[1]
    row = db.get(SessionToken, token)
    if not row:
        raise HTTPException(401, "Session expired")
    user = db.get(User, row.user_id)
    if not user:
        raise HTTPException(401, "Unknown user")
    return user


def require_role(*roles: str):
    def inner(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(403, "Insufficient role")
        return user

    return inner


def seed(db: Session) -> None:
    if db.scalar(select(func.count(User.id))) == 0:
        demo = [
            ("admin", "aegis-admin", "admin"),
            ("operator", "aegis-ops", "operator"),
            ("analyst", "aegis-view", "analyst"),
        ]
        for name, pw, role in demo:
            db.add(User(username=name, password_hash=hash_pw(pw), role=role))
    if db.scalar(select(func.count(Asset.id))) == 0:
        kinds = {
            "ws": "workstation",
            "vpn": "edge",
            "app": "service",
            "id": "identity",
            "ci": "pipeline",
            "db": "data",
            "k8s": "k8s",
            "pay": "service",
            "tel": "service",
            "vault": "data",
        }
        for subnet, nodes in SUBNETS.items():
            for node in nodes:
                prefix = node.split("-")[0]
                db.add(
                    Asset(
                        id=node,
                        name=node,
                        kind=kinds.get(prefix, "service"),
                        subnet=subnet,
                        criticality=3 if node in CRITICAL else (2 if subnet == "ent" else 1),
                        pii_tag="restricted" if node in {"id-svc", "vault", "pay-proc"} else "none",
                    )
                )
    if db.scalar(select(func.count(Governance.id))) == 0:
        db.add(Governance())
    db.commit()

    loaded_forest = detector.load()
    if db.scalar(select(func.count(TelemetryEvent.id))) == 0:
        rows = [benign_event() for _ in range(140)] + [attack_event() for _ in range(24)]
        if not loaded_forest:
            detector.fit(rows)
        persist_events(db, rows, actor="system")
        db.commit()
    elif not loaded_forest:
        fit_detector(db)
    n = int(os.environ.get("AEGIS_BOOTSTRAP_EPISODES", "80"))
    if not policy.q and n > 0:
        stats = train_policy(policy, episodes=n)
        db.add(
            PolicySnapshot(
                episodes=stats["episodes"],
                avg_reward=stats["avg_reward"],
                epsilon=stats["epsilon"],
                q_json=_q_json(),
                notes="bootstrap",
            )
        )
        db.commit()


def fit_detector(db: Session) -> None:
    rows = db.execute(select(TelemetryEvent).limit(400)).scalars().all()
    payload = [
        {
            "hour": (e.ts.hour if e.ts else 12),
            "bytes_out": e.bytes_out,
            "failed_auth": e.failed_auth,
            "privilege_change": e.privilege_change,
            "unusual_proc": e.unusual_proc,
            "east_west": e.east_west,
            "dest_ops": e.dest_ops,
            "identity_anom": e.identity_anom,
            "dns_entropy": e.dns_entropy,
            "conn_burst": e.conn_burst,
        }
        for e in rows
    ]
    detector.fit(payload)


def persist_events(db: Session, rows: list[dict], actor: str) -> list[TelemetryEvent]:
    stored = []
    open_on_asset: dict[str, Incident] = {}
    for row in rows:
        hour = row.pop("hour", None)
        cols = {c.name for c in TelemetryEvent.__table__.columns} - {"id", "anomaly_score"}
        ev = TelemetryEvent(**{k: v for k, v in row.items() if k in cols})
        ev.anomaly_score = detector.score(row | {"hour": hour})
        db.add(ev)
        db.flush()
        hits = rule_hits(row)
        ml_hit = ev.anomaly_score >= 0.62
        if hits or ml_hit:
            title = hits[0][1] if hits else "Isolation Forest anomaly"
            mitre = hits[0][0] if hits else "TA0000"
            rationale = hits[0][2] if hits else f"Anomaly score {ev.anomaly_score:.2f} vs local baseline."
            det = Detection(
                event_id=ev.id,
                asset_id=ev.asset_id,
                detector="rules+iforest",
                score=max(ev.anomaly_score, 0.7 if hits else ev.anomaly_score),
                mitre=mitre,
                title=title,
                rationale=rationale,
            )
            db.add(det)
            db.flush()
            inc = open_on_asset.get(ev.asset_id)
            if not inc:
                rec, conf = policy.recommend(
                    {
                        "red_progress": 2 if ev.dest_ops else 1,
                        "compromised": 1,
                        "isolated": 0,
                        "last_sev": ev.severity,
                        "decoy": False,
                    }
                )
                inc = Incident(
                    asset_id=ev.asset_id,
                    title=title,
                    severity=max(ev.severity, 3 if ev.dest_ops else 2),
                    mitre=mitre,
                    recommended=rec,
                    confidence=conf,
                )
                db.add(inc)
                db.flush()
                open_on_asset[ev.asset_id] = inc
            det.incident_id = inc.id
        stored.append(ev)
    if stored:
        audit(db, actor, "ingest", "telemetry", f"{len(stored)} events")
    return stored


def apply_action(db: Session, user: User, incident: Incident, action: str, auto: bool) -> str:
    if action not in {"monitor", "decoy", "isolate", "restore", "contain"}:
        raise HTTPException(400, "Unknown action")
    gov = db.scalar(select(Governance).limit(1))
    if gov and gov.kill_switch:
        raise HTTPException(423, "Kill switch is on. All autonomous and high-impact actions are frozen.")
    if action in HIGH_IMPACT:
        if auto and (not gov or not gov.autonomy_enabled or not gov.auto_isolate):
            raise HTTPException(403, "High-impact action needs an operator.")
        if user.role == "analyst":
            raise HTTPException(403, "Analysts cannot execute isolate/restore/contain.")
    asset = db.get(Asset, incident.asset_id)
    detail = f"{action} on {incident.asset_id}"
    if asset:
        if action == "isolate":
            asset.isolated = True
        elif action == "restore":
            asset.compromised = False
            asset.isolated = False
            asset.service_up = True
        elif action == "decoy":
            asset.decoy = True
        elif action == "contain":
            sibs = db.execute(select(Asset).where(Asset.subnet == asset.subnet)).scalars()
            for sib in sibs:
                sib.isolated = True
            detail = f"contain subnet {asset.subnet}"
        if action in {"isolate", "restore", "contain"}:
            incident.status = "contained"
            incident.closed_at = utcnow()
            incident.approved_by = user.username
        else:
            incident.status = "watching"
            incident.approved_by = user.username
    db.add(
        ActionRecord(
            incident_id=incident.id,
            actor=user.username,
            action=action,
            asset_id=incident.asset_id,
            auto=auto,
            detail=detail,
        )
    )
    audit(db, user.username, action, incident.asset_id, detail, purpose="response")
    return detail


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    db = SessionLocal()
    try:
        seed(db)
    finally:
        db.close()
    yield


app = FastAPI(title="AEGIS", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class LoginIn(BaseModel):
    username: str
    password: str


class TelemetryIn(BaseModel):
    asset_id: str
    source: str = "host-agent"
    event_type: str
    severity: int = 1
    bytes_out: float = 0
    failed_auth: int = 0
    privilege_change: int = 0
    unusual_proc: int = 0
    east_west: int = 0
    dest_ops: int = 0
    identity_anom: int = 0
    dns_entropy: float = 0
    conn_burst: int = 0
    mitre: str = ""
    summary: str = ""
    pii_tag: str = "none"


class ActIn(BaseModel):
    action: str
    note: str = ""


class TrainIn(BaseModel):
    episodes: int = Field(default=120, ge=20, le=600)


class PolicyImport(BaseModel):
    q: dict[str, list[float]]
    epsilon: float = 0.05
    notes: str = "imported"
    platform: str = "remote"
    episodes: int = 0
    avg_reward: float = 0

    @field_validator("epsilon")
    @classmethod
    def _epsilon_range(cls, value: float) -> float:
        if not math.isfinite(value) or not 0.0 <= value <= 1.0:
            raise ValueError("epsilon must be in [0, 1]")
        return value

    @field_validator("q")
    @classmethod
    def _q_rows(cls, value: dict[str, list[float]]) -> dict[str, list[float]]:
        for vals in value.values():
            if len(vals) != 5 or any(not math.isfinite(float(x)) for x in vals):
                raise ValueError("each q value list must be 5 finite floats")
        return value


class PolicyPull(BaseModel):
    uri: str | None = None


class GovIn(BaseModel):
    autonomy_enabled: bool | None = None
    auto_isolate: bool | None = None
    retention_days: int | None = Field(default=None, ge=1, le=365)
    kill_switch: bool | None = None


class GymStepIn(BaseModel):
    action: str | None = None


class GymRunIn(BaseModel):
    max_steps: int = 40


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "aegis", "detector": detector.fitted, "policy_states": len(policy.q)}


@app.post("/api/auth/login")
def login(body: LoginIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    now = utcnow()
    bucket = login_hits.setdefault(body.username, [])
    bucket[:] = [t for t in bucket if now - t < timedelta(minutes=10)]
    if len(bucket) >= 12:
        raise HTTPException(429, "Too many login attempts")
    bucket.append(now)
    user = db.scalar(select(User).where(User.username == body.username))
    if not user or not check_pw(body.password, user.password_hash):
        raise HTTPException(401, "Invalid credentials")
    token = secrets.token_urlsafe(24)
    db.add(SessionToken(token=token, user_id=user.id))
    audit(db, user.username, "login", "session")
    db.commit()
    return {"token": token, "username": user.username, "role": user.role}


@app.get("/api/me")
def me(user: User = Depends(current_user)) -> dict[str, str]:
    return {"username": user.username, "role": user.role}


@app.get("/api/command")
def command(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    assets = db.execute(select(Asset)).scalars().all()
    events = db.execute(select(TelemetryEvent).order_by(TelemetryEvent.id.desc()).limit(18)).scalars().all()
    incidents = db.execute(
        select(Incident).where(Incident.status.in_(["open", "watching"])).order_by(Incident.id.desc()).limit(12)
    ).scalars().all()
    gov = db.scalar(select(Governance).limit(1))
    n_events = db.scalar(select(func.count(TelemetryEvent.id))) or 0
    n_det = db.scalar(select(func.count(Detection.id))) or 0
    n_open = db.scalar(select(func.count(Incident.id)).where(Incident.status == "open")) or 0
    closed = db.execute(select(Incident).where(Incident.status == "contained")).scalars().all()
    mttr = 0.0
    if closed:
        secs = []
        for inc in closed:
            if inc.closed_at and inc.ts:
                a, b = inc.closed_at, inc.ts
                if a.tzinfo is None:
                    a = a.replace(tzinfo=timezone.utc)
                if b.tzinfo is None:
                    b = b.replace(tzinfo=timezone.utc)
                secs.append((a - b).total_seconds())
        mttr = sum(secs) / max(len(secs), 1) / 60
    labeled = db.scalar(select(func.count(TelemetryEvent.id)).where(TelemetryEvent.labeled_attack.is_(True))) or 0
    latest_policy = db.scalar(select(PolicySnapshot).order_by(PolicySnapshot.id.desc()).limit(1))
    return {
        "user": {"username": user.username, "role": user.role},
        "kpis": {
            "assets": len(assets),
            "events": n_events,
            "detections": n_det,
            "open_incidents": n_open,
            "mttr_min": round(mttr, 2),
            "labeled_attacks": labeled,
            "policy_states": len(policy.q),
            "policy_source": (latest_policy.notes if latest_policy and latest_policy.notes else "bootstrap"),
        },
        "assets": [
            {
                "id": a.id,
                "kind": a.kind,
                "subnet": a.subnet,
                "criticality": a.criticality,
                "compromised": a.compromised,
                "isolated": a.isolated,
                "decoy": a.decoy,
                "up": a.service_up,
                "pii_tag": a.pii_tag,
            }
            for a in assets
        ],
        "events": [_event_out(e) for e in events],
        "incidents": [_incident_out(i) for i in incidents],
        "governance": _gov_out(gov),
        "subnets": SUBNETS,
        "gym": live_gym.state.snapshot(),
    }


@app.post("/api/telemetry/ingest")
def ingest(
    body: TelemetryIn,
    user: User = Depends(require_role("admin", "operator")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if not db.get(Asset, body.asset_id):
        raise HTTPException(404, "Unknown asset")
    stored = persist_events(db, [body.model_dump() | {"labeled_attack": False, "hour": utcnow().hour}], user.username)
    db.commit()
    return {"id": stored[0].id, "anomaly_score": stored[0].anomaly_score}


@app.post("/api/sim/tick")
def sim_tick(
    user: User = Depends(require_role("admin", "operator")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    rows = burst(n=6, attack_p=0.35)
    stored = persist_events(db, rows, user.username)
    db.commit()
    return {"ingested": len(stored), "anomalous": sum(1 for e in stored if e.anomaly_score >= 0.62)}


@app.get("/api/detections")
def detections(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.execute(select(Detection).order_by(Detection.id.desc()).limit(80)).scalars().all()
    return [
        {
            "id": d.id,
            "ts": d.ts.isoformat() if d.ts else None,
            "asset_id": d.asset_id,
            "detector": d.detector,
            "score": d.score,
            "mitre": d.mitre,
            "title": d.title,
            "rationale": d.rationale,
            "incident_id": d.incident_id,
        }
        for d in rows
    ]


@app.get("/api/incidents")
def incidents(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.execute(select(Incident).order_by(Incident.id.desc()).limit(80)).scalars().all()
    return [_incident_out(i) for i in rows]


@app.post("/api/incidents/{incident_id}/act")
def act(
    incident_id: int,
    body: ActIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    inc = db.get(Incident, incident_id)
    if not inc:
        raise HTTPException(404, "Incident not found")
    detail = apply_action(db, user, inc, body.action, auto=False)
    if body.note:
        inc.notes = body.note
    db.commit()
    return {"ok": True, "detail": detail, "status": inc.status}


@app.get("/api/gym")
def gym_get(user: User = Depends(current_user)) -> dict[str, Any]:
    return live_gym.state.snapshot()


@app.post("/api/gym/reset")
def gym_reset(
    user: User = Depends(require_role("admin", "operator")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    _frozen(db)
    live_gym.reset()
    return live_gym.state.snapshot()


@app.post("/api/gym/step")
def gym_step(
    body: GymStepIn,
    user: User = Depends(require_role("admin", "operator")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    _frozen(db)
    action = body.action or policy.act(discretize(live_gym.state.obs()), greedy=True)
    snap = live_gym.step(action)
    if "prev_state" in snap:
        policy.learn(snap["prev_state"], action, snap["reward"], snap["next_state"], snap["done"])
    return snap


@app.post("/api/gym/run")
def gym_run(
    body: GymRunIn,
    user: User = Depends(require_role("admin", "operator")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    _frozen(db)
    snap: dict[str, Any] = live_gym.state.snapshot()
    total_reward = 0.0
    for _ in range(max(body.max_steps, 0)):
        if live_gym.state.done:
            break
        action = policy.act(discretize(live_gym.state.obs()), greedy=True)
        snap = live_gym.step(action)
        if "prev_state" in snap:
            policy.learn(snap["prev_state"], action, snap["reward"], snap["next_state"], snap["done"])
            total_reward += float(snap["reward"])
    return {**snap, "total_reward": round(total_reward, 3)}


@app.post("/api/policy/train")
def train(
    body: TrainIn,
    user: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    _frozen(db)
    stats = train_policy(policy, episodes=body.episodes)
    db.add(
        PolicySnapshot(
            episodes=stats["episodes"],
            avg_reward=stats["avg_reward"],
            epsilon=stats["epsilon"],
            q_json=_q_json(),
            notes=f"trained by {user.username}",
        )
    )
    db.add(
        GymEpisode(
            steps=0,
            reward=stats["avg_reward"],
            outcome="train",
        )
    )
    audit(db, user.username, "train", "policy", f"{body.episodes} episodes")
    db.commit()
    return stats


@app.get("/api/policy")
def policy_get(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    snaps = db.execute(select(PolicySnapshot).order_by(PolicySnapshot.id.desc()).limit(8)).scalars().all()
    return {
        "epsilon": policy.epsilon,
        "states": len(policy.q),
        "prefs": policy.action_prefs(),
        "actions": ["monitor", "decoy", "isolate", "restore", "contain"],
        "platform": detect_platform(),
        "gcs_uri": gcs_uri(),
        "history": [
            {
                "ts": s.ts.isoformat() if s.ts else None,
                "episodes": s.episodes,
                "avg_reward": s.avg_reward,
                "epsilon": s.epsilon,
                "notes": s.notes,
            }
            for s in snaps
        ],
    }


@app.get("/api/policy/export")
def policy_export(user: User = Depends(current_user)) -> dict[str, Any]:
    return {"epsilon": policy.epsilon, "q": dict(policy.q), "platform": detect_platform()}


@app.post("/api/policy/import")
def policy_import(
    body: PolicyImport,
    user: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    _frozen(db)
    policy.replace(body.q, body.epsilon)
    detector.load()
    db.add(
        PolicySnapshot(
            episodes=body.episodes,
            avg_reward=body.avg_reward,
            epsilon=body.epsilon,
            q_json=_q_json(),
            notes=f"{body.platform}:{body.notes}",
        )
    )
    audit(db, user.username, "policy.import", "policy", body.platform, "ml")
    db.commit()
    return {"ok": True, "states": len(policy.q), "epsilon": policy.epsilon, "platform": body.platform}


@app.post("/api/policy/pull")
def policy_pull(
    body: PolicyPull,
    user: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    _frozen(db)
    from app.train_job import pull_gcs

    uri = body.uri or gcs_uri()
    if not uri:
        raise HTTPException(400, "Pass uri or set AEGIS_GCS_URI")
    if not uri.startswith("gs://"):
        raise HTTPException(400, "Only gs:// URIs are pulled")
    pull_gcs(uri, data_dir())
    policy.path = data_dir() / "q_policy.json"
    policy.load()
    detector.load()
    db.add(
        PolicySnapshot(
            episodes=0,
            avg_reward=0,
            epsilon=policy.epsilon,
            q_json=_q_json(),
            notes=f"gcs-pull:{uri}",
        )
    )
    audit(db, user.username, "policy.pull", "policy", uri, "ml")
    db.commit()
    return {"ok": True, "states": len(policy.q), "uri": uri}


@app.get("/api/governance")
def gov_get(
    purpose: str | None = None,
    limit: int = Query(40, le=500),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    gov = db.scalar(select(Governance).limit(1))
    q = select(AuditLog).order_by(AuditLog.id.desc())
    if purpose:
        q = q.where(AuditLog.purpose == purpose)
    logs = db.execute(q.limit(limit)).scalars().all()
    return {
        "settings": _gov_out(gov),
        "audit": [
            {
                "id": a.id,
                "ts": a.ts.isoformat() if a.ts else None,
                "actor": a.actor,
                "action": a.action,
                "resource": a.resource,
                "detail": a.detail,
                "purpose": a.purpose,
            }
            for a in logs
        ],
    }


@app.post("/api/governance")
def gov_set(
    body: GovIn,
    user: User = Depends(require_role("admin")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    gov = db.scalar(select(Governance).limit(1))
    if not gov:
        gov = Governance()
        db.add(gov)
    for field, val in body.model_dump(exclude_none=True).items():
        setattr(gov, field, val)
    audit(db, user.username, "governance.update", "governance", str(body.model_dump(exclude_none=True)), "governance")
    db.commit()
    return _gov_out(gov)


@app.post("/api/governance/purge")
def purge(user: User = Depends(require_role("admin")), db: Session = Depends(get_db)) -> dict[str, int]:
    gov = db.scalar(select(Governance).limit(1))
    days = gov.retention_days if gov else 30
    cutoff = utcnow() - timedelta(days=days)
    q = db.execute(select(TelemetryEvent).where(TelemetryEvent.ts < cutoff)).scalars().all()
    n = len(q)
    for row in q:
        db.delete(row)
    audit(db, user.username, "retention.purge", "telemetry", f"deleted {n} older than {days}d", "governance")
    db.commit()
    return {"deleted": n, "retention_days": days}


@app.get("/api/analytics")
def analytics(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    by_mitre = db.execute(
        select(Detection.mitre, func.count(Detection.id)).group_by(Detection.mitre)
    ).all()
    by_subnet: dict[str, int] = {}
    for asset_id, n in db.execute(select(Incident.asset_id, func.count(Incident.id)).group_by(Incident.asset_id)):
        by_subnet[subnet_of(asset_id)] = by_subnet.get(subnet_of(asset_id), 0) + n
    scores = db.execute(select(TelemetryEvent.anomaly_score).order_by(TelemetryEvent.id.desc()).limit(80)).scalars().all()
    actions = db.execute(select(ActionRecord.action, func.count(ActionRecord.id)).group_by(ActionRecord.action)).all()
    return {
        "mitre": {m or "untagged": n for m, n in by_mitre},
        "incidents_by_subnet": by_subnet,
        "score_spark": [round(s, 3) for s in reversed(list(scores))],
        "actions": {a: n for a, n in actions},
        "prefs": policy.action_prefs(),
        "iforest_threshold": 0.62,
    }


def _event_out(e: TelemetryEvent) -> dict[str, Any]:
    return {
        "id": e.id,
        "ts": e.ts.isoformat() if e.ts else None,
        "asset_id": e.asset_id,
        "source": e.source,
        "event_type": e.event_type,
        "severity": e.severity,
        "mitre": e.mitre,
        "summary": e.summary,
        "anomaly_score": e.anomaly_score,
        "pii_tag": e.pii_tag,
        "labeled_attack": e.labeled_attack,
    }


def _incident_out(i: Incident) -> dict[str, Any]:
    return {
        "id": i.id,
        "ts": i.ts.isoformat() if i.ts else None,
        "asset_id": i.asset_id,
        "title": i.title,
        "severity": i.severity,
        "status": i.status,
        "mitre": i.mitre,
        "recommended": i.recommended,
        "confidence": i.confidence,
        "approved_by": i.approved_by,
        "notes": i.notes,
    }


def _gov_out(gov: Governance | None) -> dict[str, Any]:
    if not gov:
        return {
            "autonomy_enabled": False,
            "auto_isolate": False,
            "retention_days": 30,
            "kill_switch": False,
            "purpose": "infrastructure-defense",
        }
    return {
        "autonomy_enabled": gov.autonomy_enabled,
        "auto_isolate": gov.auto_isolate,
        "retention_days": gov.retention_days,
        "kill_switch": gov.kill_switch,
        "purpose": gov.purpose,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.environ.get("PORT", 8000)), reload=True)
