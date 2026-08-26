"""pywebview window bootstrap.

Deliberately the ONLY module that imports `webview`. `bridge.py` and
`core/` stay importable (and therefore testable) without pywebview
installed — the test suite imports `bridge` alone and never this module.
"""

from __future__ import annotations

import sys
from pathlib import Path

import webview

from .bridge import Bridge


def ui_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "qmanager_installer" / "ui"  # type: ignore[attr-defined]
    return Path(__file__).resolve().parent / "ui"


def run() -> int:
    bridge = Bridge()
    webview.create_window(
        "QManager Installer",
        str(ui_dir() / "index.html"),
        js_api=bridge,
        width=900,
        height=680,
        min_size=(760, 560),
    )
    webview.start()
    return 0
