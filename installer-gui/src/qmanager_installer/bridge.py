"""The single seam between the UI and core.

start() runs on a worker thread and returns immediately; the UI polls. A
synchronous start() would freeze the WebView for the whole install.

Every method here is JS-callable through pywebview's js_api. A raised
exception on that boundary becomes a rejected JS promise with no message the
UI ever sees, so every public method catches broadly and returns a
structured dict instead of letting an exception cross.
"""

from __future__ import annotations

import subprocess
import sys
import threading
import webbrowser
from dataclasses import asdict
from pathlib import Path

from .core.installer import InstallCancelled, InstallError, InstallOptions, InstallRunner, Progress
from .core.payload import Payload, load_payload
from .core.preflight import PreflightReport, run_preflight
from .core.prefs import Cipher, Prefs, load_prefs, save_prefs
from .core import dpapi
from .core.session_log import open_session_log
from .core.transport.adb import AdbTransport, list_devices
from .core.transport.base import Transport
from .core.transport.ssh import SshTransport
from .core.uninstall import UninstallRunner
from .i18n import DEFAULT_LOCALE, load_translator


def adb_path() -> Path:
    base = Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[2]
    return base / "vendor" / "adb" / "adb.exe"


class Bridge:
    def __init__(
        self,
        payload: Payload | None = None,
        log_root: Path | None = None,
        prefs_root: Path | None = None,
        cipher: Cipher | None = None,
    ) -> None:
        self._payload = payload or load_payload()
        self._log_root = log_root
        # Both seams exist so the test suite never reads or writes the real
        # %LOCALAPPDATA% file and never needs DPAPI to be reachable.
        self._prefs_root = prefs_root
        self._cipher: Cipher = cipher or dpapi
        self._prefs: Prefs = load_prefs(root=prefs_root)
        self._transport: Transport | None = None
        self._transport_kind: str | None = None  # "adb" | "ssh" — never a hardcoded default
        self._host: str | None = None  # only set for SSH; there is no device-side IP for ADB
        self._report: PreflightReport | None = None
        self._translator = load_translator(self._prefs.locale or DEFAULT_LOCALE)

        self._lock = threading.Lock()
        self._lines: list[str] = []
        self._progress: dict | None = None
        self._state = "idle"
        self._error: dict | None = None
        self._log_path: Path | None = None
        self._cancel_event: threading.Event | None = None

    # --- locale -----------------------------------------------------------

    def set_locale(self, locale: str) -> dict:
        self._translator = load_translator(locale)
        # Remembered so the Chinese audience this tool exists for does not
        # re-pick their language on every launch.
        self._prefs.locale = self._translator.locale
        self._save_prefs()
        return {"locale": self._translator.locale}

    def strings(self) -> dict:
        merged = dict(self._translator.fallback)
        merged.update({k: v for k, v in self._translator.strings.items() if str(v).strip()})
        return merged

    def missing_keys(self) -> list[str]:
        """Keys the active locale had no usable value for — fell back to en.

        Surfaced separately from strings() so a partial translation is a
        visible, diagnosable list rather than silently swallowed by the
        English fallback.
        """
        return list(self._translator.missing_keys)

    # --- saved connection -------------------------------------------------

    def saved_connection(self) -> dict:
        """What the connect screen should prefill.

        `has_password` is a bool and the password itself is deliberately
        absent: it is decrypted in Python at connect time, so it never
        enters the WebView's DOM or JS heap. A blob this Windows account
        cannot open reports has_password=False — the copied-settings-file
        case, which must look exactly like a fresh install rather than an
        error.
        """
        try:
            prefs = self._prefs
            return {
                "transport": prefs.transport,
                "locale": prefs.locale,
                "ssh": {
                    "host": prefs.ssh_host,
                    "user": prefs.ssh_user,
                    "remember": bool(prefs.remember_password),
                    "has_password": self._saved_password() is not None,
                },
            }
        except Exception:
            fresh = Prefs()
            return {
                "transport": fresh.transport,
                "locale": fresh.locale,
                "ssh": {
                    "host": fresh.ssh_host,
                    "user": fresh.ssh_user,
                    "remember": False,
                    "has_password": False,
                },
            }

    def forget(self) -> dict:
        """Drop the saved password immediately, keeping host and username.

        Bound to un-ticking the checkbox, so the secret leaves the disk at
        that moment rather than at the next successful connect. A no-op —
        never an error — when nothing was saved.
        """
        self._prefs.clear_password()
        self._save_prefs()
        return {"forgotten": True}

    def _saved_password(self) -> str | None:
        return self._prefs.get_password(cipher=self._cipher)

    def _save_prefs(self) -> bool:
        try:
            return save_prefs(self._prefs, root=self._prefs_root)
        except Exception:
            return False

    # --- connection ---------------------------------------------------------

    def toolchain(self) -> dict:
        """Spec check #1 — adb.exe present. Without it nothing else can run."""
        path = adb_path()
        return {"ok": path.is_file(), "path": str(path)}

    def shutdown(self) -> None:
        """Best-effort teardown, wired to the window's `closing` event.

        `adb devices` implicitly starts a detached background server the
        first time it runs — a second, independent process backed by the
        same vendor/adb/adb.exe binary, which keeps running (and keeps
        Windows' handle on that file open) long after this window closes.
        Left alive, it is exactly what makes the NEXT PyInstaller build fail
        with `PermissionError: Access is denied` trying to replace that exe.
        `kill-server` is a safe no-op if no server is running, so this is
        unconditional rather than gated on whether ADB was ever used.
        """
        path = adb_path()
        if not path.is_file():
            return
        try:
            subprocess.run(
                [str(path), "kill-server"],
                capture_output=True,
                timeout=5,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except Exception:
            pass

    def open_url(self, url: str) -> dict:
        """Open the modem's address in the user's real default browser.

        Scoped to http(s) — the result screen's only caller ever passes its
        own `http://{host}` string, never anything sourced from outside this
        session, but the check stays here as the boundary itself.
        """
        if not (url.startswith("http://") or url.startswith("https://")):
            return {"opened": False}
        try:
            webbrowser.open(url)
            return {"opened": True}
        except Exception:
            return {"opened": False}

    def list_devices(self) -> list[dict]:
        path = adb_path()
        if not path.is_file():
            return []
        try:
            return [asdict(d) for d in list_devices(path)]
        except Exception:
            # A transient adb hiccup must not crash the connect screen — an
            # empty list just means "rescan and try again".
            return []

    def connect_adb(self, serial: str) -> dict:
        try:
            self._transport = AdbTransport(adb_path(), serial)
            self._transport_kind = "adb"
            self._host = None
            self._prefs.transport = "adb"
            self._save_prefs()
            return {"connected": True, "describe": self._transport.describe(), "host": None}
        except Exception as exc:
            return self._connect_error(exc)

    def connect_ssh(self, host: str, user: str, password: str, remember: bool = False) -> dict:
        """An empty password field means "use the saved one".

        That is what lets the UI show a placeholder instead of fake dots and
        keep the secret out of the DOM entirely. Consequence: a genuinely
        empty SSH password is unexpressible once a blob is saved — not a
        real case for root on these modems.
        """
        effective = password or self._saved_password() or ""
        try:
            self._transport = SshTransport(host, user, effective)
            self._transport_kind = "ssh"
            # The SSH host is the only honest source for the "open the modem
            # at http://..." message on the result screen — it is never
            # hardcoded here. ADB connections have no equivalent; self._host
            # stays None and the UI must handle that case itself.
            self._host = host
            # Persist only after the credentials have actually worked. A
            # remembered wrong password would be retried on every launch,
            # against an account that may lock out.
            self._prefs.transport = "ssh"
            self._prefs.ssh_host = host
            self._prefs.ssh_user = user
            self._prefs.remember_password = bool(remember)
            if remember:
                self._prefs.set_password(effective, cipher=self._cipher)
            else:
                self._prefs.clear_password()
            self._save_prefs()
            return {"connected": True, "describe": self._transport.describe(), "host": host}
        except Exception as exc:
            return self._connect_error(exc)

    def _connect_error(self, exc: Exception) -> dict:
        return {
            "connected": False,
            "error": {
                "code": "connect_failed",
                "message": self._translator.t("error.connect_failed", detail=str(exc)),
            },
        }

    # --- preflight ------------------------------------------------------------

    def preflight(self) -> dict:
        if self._transport is None:
            return {"error": {"code": "not_connected", "message": self._translator.t("error.not_connected")}}
        try:
            self._report = run_preflight(self._transport, self._payload)
        except Exception as exc:
            # A rejected promise here has no message on the JS side (the
            # spec's connect-screen freeze) — better a structured error the
            # UI can render than an unguarded raise across the bridge.
            return {
                "error": {
                    "code": "preflight_failed",
                    "message": self._translator.t("error.preflight_failed", detail=str(exc)),
                }
            }

        report = self._report
        device = report.device
        device_dict = None
        if device is not None:
            # asdict() leaves `tier` as the Tier enum instance, which is not
            # JSON-serialisable — overwrite it with the plain string value.
            # `identity_read_ok` is a plain bool already and survives as-is,
            # which is what lets the UI branch on "couldn't read the
            # identity file" vs. "read it, model just isn't recognised".
            device_dict = asdict(device) | {"tier": device.tier.value}

        return {
            "action": report.action.value,
            "blocked": report.blocked,
            "installed_version": report.installed_version,
            "payload_version": self._payload.version,
            "device": device_dict,
            "checks": [
                {"id": c.id, "state": c.state.value, "detail": c.detail, "data": c.data}
                for c in report.checks
            ],
            # Honest replacement for a hardcoded device IP: only ever the
            # SSH host the user actually typed, or None over ADB.
            "host": self._host,
        }

    # --- run --------------------------------------------------------------

    def start(self, action: str, reboot: bool = True, skip_packages: bool = False) -> dict:
        if self._transport is None or self._state == "running":
            return {"started": False}
        serial = self._report.device.serial if self._report and self._report.device else "unknown"
        log = open_session_log(serial, self._log_root)
        self._log_path = log.path
        cancel_event = threading.Event()
        with self._lock:
            self._lines, self._progress, self._error = [], None, None
            self._state = "running"
            self._cancel_event = cancel_event

        runner_cls = UninstallRunner if action == "uninstall" else InstallRunner
        runner = runner_cls(
            self._transport,
            self._payload,
            on_line=self._push_line,
            on_progress=self._push_progress,
            log=log,
            cancel_event=cancel_event,
        )

        def work() -> None:
            try:
                runner.run(InstallOptions(reboot=reboot, skip_packages=skip_packages))
                state, error = "done", None
            except InstallCancelled:
                # A third outcome, deliberately not ok=False wearing a
                # failure message — see poll()'s "cancelled" state. The
                # device may be left partially modified; the run view is
                # responsible for saying so (run.cancelled.detail).
                state, error = "cancelled", None
            except InstallError as exc:
                state = "failed"
                error = {
                    "step": exc.step,
                    "command": exc.command,
                    "exit_code": exc.exit_code,
                    # exc.stderr is untruncated; str(exc) truncates to 400
                    # chars for the exception message, which is not what a
                    # user trying to diagnose a failure needs to see.
                    "stderr": exc.stderr,
                }
            except Exception as exc:  # never let a raw traceback reach the user
                state = "failed"
                error = {"step": "unexpected", "command": "", "exit_code": -1, "stderr": str(exc)}
            finally:
                log.close()
            with self._lock:
                self._state, self._error = state, error

        threading.Thread(target=work, daemon=True).start()
        return {"started": True}

    def cancel(self) -> dict:
        """Abort an in-flight run. JS-callable from the run view's Cancel
        button (bound to the existing `run.cancel` string — no new label
        needed, it already reads "Cancel"/"取消").

        Sets the cancel_event InstallRunner checks between steps AND calls
        Transport.cancel() so a worker thread currently blocked inside
        exec_stream unblocks immediately — that second half is what makes
        this actually useful, since the opkg stall this exists for happens
        mid-stream during the ~3-minute install, not at a step boundary.

        A no-op — never an error — when nothing is running, and safe to call
        more than once or after the run has already finished.
        """
        with self._lock:
            event = self._cancel_event
            running = self._state == "running"
        if event is not None:
            event.set()
        if running and self._transport is not None:
            self._transport.cancel()
        return {"cancelling": running}

    def _push_line(self, line: str) -> None:
        with self._lock:
            self._lines.append(line)

    def _push_progress(self, progress: Progress) -> None:
        with self._lock:
            self._progress = {"step": progress.step, "total": progress.total}

    def poll(self) -> dict:
        with self._lock:
            lines, self._lines = self._lines, []
            return {
                "lines": lines,
                "progress": self._progress,
                "state": self._state,
                "error": self._error,
                "log_path": str(self._log_path) if self._log_path else None,
                "host": self._host,
            }
