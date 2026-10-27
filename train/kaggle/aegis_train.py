"""Kaggle script kernel for AEGIS Blue-policy training."""

from __future__ import annotations

import os
import sys
import tarfile
import zipfile
from pathlib import Path

os.environ.setdefault("AEGIS_PLATFORM", "kaggle")
os.environ.setdefault("AEGIS_DATA", "/kaggle/working")
os.environ.setdefault("AEGIS_EPISODES", "4000")

incoming = Path("/kaggle/input/aegis-src")
dest = Path("/kaggle/working/src")
dest.mkdir(parents=True, exist_ok=True)
print("dataset files", sorted(p.name for p in incoming.glob("*")) if incoming.exists() else "MISSING")

if incoming.exists():
    for archive in incoming.iterdir():
        if archive.suffix == ".zip":
            zipfile.ZipFile(archive).extractall(dest)
        elif archive.suffix in {".tar", ".tgz"} or archive.name.endswith(".tar.gz"):
            tarfile.open(archive).extractall(dest)

hits = list(Path("/kaggle").rglob("train_job.py"))
print("train_job hits", [str(h) for h in hits])
if not hits:
    raise SystemExit("Could not find app/train_job.py in aegis-src. Re-attach the dataset and rerun.")

pkg_root = hits[0].resolve().parent.parent
sys.path.insert(0, str(pkg_root))
from app.train_job import run  # noqa: E402

run(int(os.environ["AEGIS_EPISODES"]))
