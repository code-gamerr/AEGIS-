from __future__ import annotations

import os
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
    event,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from app.paths import data_dir
from pathlib import Path

DATA_DIR = data_dir()
DB_PATH = Path(os.environ.get("AEGIS_DB", DATA_DIR / "aegis.db"))

engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_conn, _connection_record) -> None:
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute("PRAGMA journal_mode=WAL")
    cur.close()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    role: Mapped[str] = mapped_column(String(24))  # admin, operator, analyst
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class SessionToken(Base):
    __tablename__ = "sessions"
    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Asset(Base):
    __tablename__ = "assets"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    kind: Mapped[str] = mapped_column(String(32))  # workstation, service, k8s, identity
    subnet: Mapped[str] = mapped_column(String(32))
    criticality: Mapped[int] = mapped_column(Integer, default=1)
    compromised: Mapped[bool] = mapped_column(Boolean, default=False)
    isolated: Mapped[bool] = mapped_column(Boolean, default=False)
    decoy: Mapped[bool] = mapped_column(Boolean, default=False)
    service_up: Mapped[bool] = mapped_column(Boolean, default=True)
    owner: Mapped[str] = mapped_column(String(64), default="platform")
    pii_tag: Mapped[str] = mapped_column(String(32), default="none")


class TelemetryEvent(Base):
    __tablename__ = "telemetry"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    asset_id: Mapped[str] = mapped_column(ForeignKey("assets.id"))
    source: Mapped[str] = mapped_column(String(32))
    event_type: Mapped[str] = mapped_column(String(48))
    severity: Mapped[int] = mapped_column(Integer, default=1)
    bytes_out: Mapped[float] = mapped_column(Float, default=0)
    failed_auth: Mapped[int] = mapped_column(Integer, default=0)
    privilege_change: Mapped[int] = mapped_column(Integer, default=0)
    unusual_proc: Mapped[int] = mapped_column(Integer, default=0)
    east_west: Mapped[int] = mapped_column(Integer, default=0)
    dest_ops: Mapped[int] = mapped_column(Integer, default=0)
    identity_anom: Mapped[int] = mapped_column(Integer, default=0)
    dns_entropy: Mapped[float] = mapped_column(Float, default=0)
    conn_burst: Mapped[int] = mapped_column(Integer, default=0)
    mitre: Mapped[str] = mapped_column(String(16), default="")
    summary: Mapped[str] = mapped_column(Text, default="")
    pii_tag: Mapped[str] = mapped_column(String(32), default="none")
    anomaly_score: Mapped[float] = mapped_column(Float, default=0)
    labeled_attack: Mapped[bool] = mapped_column(Boolean, default=False)


class Detection(Base):
    __tablename__ = "detections"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("telemetry.id"))
    asset_id: Mapped[str] = mapped_column(String(64))
    detector: Mapped[str] = mapped_column(String(32))
    score: Mapped[float] = mapped_column(Float)
    mitre: Mapped[str] = mapped_column(String(16))
    title: Mapped[str] = mapped_column(String(160))
    rationale: Mapped[str] = mapped_column(Text, default="")
    incident_id: Mapped[int | None] = mapped_column(Integer, nullable=True)


class Incident(Base):
    __tablename__ = "incidents"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    asset_id: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(160))
    severity: Mapped[int] = mapped_column(Integer, default=2)
    status: Mapped[str] = mapped_column(String(24), default="open")
    mitre: Mapped[str] = mapped_column(String(16), default="")
    recommended: Mapped[str] = mapped_column(String(24), default="monitor")
    confidence: Mapped[float] = mapped_column(Float, default=0.5)
    approved_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")


class ActionRecord(Base):
    __tablename__ = "actions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    incident_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    actor: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(24))
    asset_id: Mapped[str] = mapped_column(String(64), default="")
    auto: Mapped[bool] = mapped_column(Boolean, default=False)
    result: Mapped[str] = mapped_column(String(32), default="ok")
    detail: Mapped[str] = mapped_column(Text, default="")


class AuditLog(Base):
    __tablename__ = "audit"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    actor: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(64))
    resource: Mapped[str] = mapped_column(String(80), default="")
    detail: Mapped[str] = mapped_column(Text, default="")
    purpose: Mapped[str] = mapped_column(String(48), default="ops")


class PolicySnapshot(Base):
    __tablename__ = "policy"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    episodes: Mapped[int] = mapped_column(Integer, default=0)
    avg_reward: Mapped[float] = mapped_column(Float, default=0)
    epsilon: Mapped[float] = mapped_column(Float, default=0.1)
    q_json: Mapped[str] = mapped_column(Text, default="{}")
    notes: Mapped[str] = mapped_column(Text, default="")


class GymEpisode(Base):
    __tablename__ = "gym_episodes"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    steps: Mapped[int] = mapped_column(Integer, default=0)
    reward: Mapped[float] = mapped_column(Float, default=0)
    red_progress: Mapped[int] = mapped_column(Integer, default=0)
    compromised: Mapped[int] = mapped_column(Integer, default=0)
    isolated: Mapped[int] = mapped_column(Integer, default=0)
    outcome: Mapped[str] = mapped_column(String(24), default="ongoing")


class Governance(Base):
    __tablename__ = "governance"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    autonomy_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    auto_isolate: Mapped[bool] = mapped_column(Boolean, default=False)
    retention_days: Mapped[int] = mapped_column(Integer, default=30)
    kill_switch: Mapped[bool] = mapped_column(Boolean, default=False)
    purpose: Mapped[str] = mapped_column(String(80), default="infrastructure-defense")
    max_auto_criticality: Mapped[int] = mapped_column(Integer, default=1)


def _migrate() -> None:
    with engine.begin() as conn:
        cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(governance)")}
        if cols and "max_auto_criticality" not in cols:
            conn.exec_driver_sql(
                "ALTER TABLE governance ADD COLUMN max_auto_criticality INTEGER DEFAULT 1"
            )


def init_db() -> None:
    Base.metadata.create_all(engine)
    _migrate()
