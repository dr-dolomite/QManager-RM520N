"""Per-user settings, written to %LOCALAPPDATA%\\QManagerInstaller.

The first thing this sub-project persists. It lives under LOCALAPPDATA rather
than beside the exe on purpose: the session logs sit beside the exe and are
exactly what a user zips up and emails when an install fails, and a folder
that carries both a support log and a saved root password is a hazard.

Nothing here raises. Every failure — a missing file, corrupt JSON, a
read-only profile, DPAPI declining — degrades to "the defaults" or "not
remembered". This module sits directly behind the pywebview bridge, where an
exception becomes a rejected JS promise with no message the user ever sees.

The password is the only field that is not stored as itself: `set_password`
encrypts through the cipher (DPAPI by default) and only the base64 blob is
written. See dpapi.py for why that blob is worthless off this machine.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, fields
from pathlib import Path
from typing import Protocol

from . import dpapi

APP_DIR_NAME = "QManagerInstaller"
PREFS_FILENAME = "settings.json"

# The connect screen's shipped defaults, which is also what a missing or
# unreadable settings file must produce — the UI has no other source for them.
DEFAULT_HOST = "192.168.225.1"
DEFAULT_USER = "root"
DEFAULT_TRANSPORT = "adb"
DEFAULT_LOCALE = "en"


class Cipher(Protocol):
    def protect(self, plaintext: str) -> str: ...

    def unprotect(self, blob: str) -> str | None: ...


@dataclass
class Prefs:
    transport: str = DEFAULT_TRANSPORT
    locale: str = DEFAULT_LOCALE
    ssh_host: str = DEFAULT_HOST
    ssh_user: str = DEFAULT_USER
    remember_password: bool = False
    # Base64 DPAPI ciphertext. Never the password itself, and never handed
    # across the bridge — see Bridge.saved_connection().
    ssh_password_blob: str = ""

    def set_password(self, plaintext: str, cipher: Cipher = dpapi) -> None:
        """Encrypt and hold. A cipher that declines leaves the blob empty,
        which the UI reads back as "not remembered" — the honest outcome,
        and better than a connect screen that crashes on a locked-down
        profile."""
        if not plaintext:
            self.ssh_password_blob = ""
            return
        try:
            self.ssh_password_blob = cipher.protect(plaintext)
        except Exception:
            self.ssh_password_blob = ""

    def get_password(self, cipher: Cipher = dpapi) -> str | None:
        """The saved password, or None when there isn't a usable one.

        None covers a blob this Windows account cannot open — the settings
        file copied to another PC. That is a normal state, not a fault.
        """
        if not self.ssh_password_blob:
            return None
        try:
            return cipher.unprotect(self.ssh_password_blob) or None
        except Exception:
            return None

    def clear_password(self) -> None:
        self.ssh_password_blob = ""
        self.remember_password = False


def prefs_dir(root: Path | None = None) -> Path:
    if root is not None:
        return root
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
    if base:
        return Path(base) / APP_DIR_NAME
    return Path.home() / f".{APP_DIR_NAME.lower()}"


def prefs_path(root: Path | None = None) -> Path:
    return prefs_dir(root) / PREFS_FILENAME


def load_prefs(root: Path | None = None, path: Path | None = None) -> Prefs:
    target = path or prefs_path(root)
    try:
        raw = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return Prefs()
    if not isinstance(raw, dict):
        return Prefs()
    # Unknown keys are dropped rather than passed to the constructor: a
    # settings file written by a future version must not break an older one.
    known = {f.name for f in fields(Prefs)}
    return Prefs(**{k: v for k, v in raw.items() if k in known})


def save_prefs(prefs: Prefs, root: Path | None = None, path: Path | None = None) -> bool:
    """Write, reporting success as a bool. False means "not remembered",
    never an exception — a roaming or read-only profile must not take the
    connect screen down with it."""
    target = path or prefs_path(root)
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            json.dumps(asdict(prefs), indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        return True
    except OSError:
        return False
