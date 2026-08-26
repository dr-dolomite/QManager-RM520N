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


def app_icon() -> str | None:
    """Path to the QManager mark .ico, or None if the asset isn't bundled.

    PyInstaller onedir mode reads --add-data through sys._MEIPASS; the icon
    is added the same way as ui/ (see build_installer.py), so it resolves
    identically frozen and unfrozen.
    """
    if getattr(sys, "frozen", False):
        icon = Path(sys._MEIPASS) / "qmanager_installer" / "assets" / "app.ico"  # type: ignore[attr-defined]
    else:
        icon = Path(__file__).resolve().parent.parent.parent / "assets" / "app.ico"
    return str(icon) if icon.is_file() else None


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
    webview.start(icon=app_icon())
    return 0
