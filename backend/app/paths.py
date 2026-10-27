from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def detect_platform() -> str:
    forced = os.environ.get("AEGIS_PLATFORM", "").strip().lower()
    if forced in {"kaggle", "gcp", "local"}:
        return forced
    if os.environ.get("KAGGLE_KERNEL_RUN_TYPE") or os.environ.get("KAGGLE_CONTAINER"):
        return "kaggle"
    if os.environ.get("AIP_MODEL_DIR") or os.environ.get("CLOUD_ML_PROJECT_ID") or os.environ.get("VERTEX_AI"):
        return "gcp"
    return "local"


def data_dir() -> Path:
    env = os.environ.get("AEGIS_DATA")
    if env:
        p = Path(env)
    elif detect_platform() == "kaggle":
        p = Path("/kaggle/working")
    else:
        p = ROOT / "data"
    p.mkdir(parents=True, exist_ok=True)
    return p


def gcs_uri() -> str | None:
    for key in ("AEGIS_GCS_URI", "AIP_MODEL_DIR", "AIP_CHECKPOINT_DIR"):
        val = (os.environ.get(key) or "").strip().rstrip("/")
        if val.startswith("gs://"):
            return val
    return None
