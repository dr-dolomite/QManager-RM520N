"""Per-run session log written beside the executable.

When a user in China hits a failure nobody local can see, they send one file.
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path


class SessionLog:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._fh = path.open("a", encoding="utf-8", newline="\n")

    def write(self, line: str) -> None:
        stamp = datetime.now().strftime("%H:%M:%S")
        self._fh.write(f"{stamp}  {line}\n")
        self._fh.flush()

    def close(self) -> None:
        if not self._fh.closed:
            self._fh.close()


def open_session_log(serial: str, root: Path | None = None) -> SessionLog:
    base = root or (Path(sys.executable).parent if getattr(sys, "frozen", False) else Path.cwd())
    logs_dir = base / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    safe_serial = "".join(ch for ch in (serial or "unknown") if ch.isalnum() or ch in "-_")
    return SessionLog(logs_dir / f"qmanager-install-{safe_serial}-{stamp}.log")
