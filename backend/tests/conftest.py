import os
import tempfile
from pathlib import Path

tmp = Path(tempfile.mkdtemp())
os.environ["AEGIS_DATA"] = str(tmp)
os.environ["AEGIS_DB"] = str(tmp / "test.db")
os.environ["AEGIS_BOOTSTRAP_EPISODES"] = "24"
os.environ["AEGIS_OFFLINE"] = "1"
