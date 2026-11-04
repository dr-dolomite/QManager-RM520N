"""ADB transport: bundled adb.exe, addressed by serial."""

from __future__ import annotations

import re
import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .base import (
    DEFAULT_EXEC_STREAM_TIMEOUT,
    DeviceGoneError,
    Result,
    Transport,
    TransportCancelled,
    TransportError,
    parse_rc,
    strip_ansi,
    wrap_command,
)

# Windows: keep the console window from flashing on every adb call.
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

# Bound on waiting for the process to actually exit after terminate() was
# sent (cancel or deadline) — SIGTERM/TerminateProcess is not instantaneous.
_TERMINATE_GRACE = 5

_DEVICE_GONE_RE = re.compile(r"device .* not found")


@dataclass(frozen=True)
class AdbDevice:
    serial: str
    state: str          # "device" | "unauthorized" | "offline"
    model: str | None = None

    @property
    def usable(self) -> bool:
        return self.state == "device"


def _run(argv, runner, timeout):
    return runner(
        argv,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        creationflags=_NO_WINDOW,
    )


def list_devices(adb_path: Path, runner: Callable = subprocess.run, timeout: int = 20) -> list[AdbDevice]:
    proc = _run([str(adb_path), "devices", "-l"], runner, timeout)
    devices: list[AdbDevice] = []
    for line in (proc.stdout or "").splitlines():
        line = line.strip()
        if not line or line.startswith("List of devices"):
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        model = None
        for token in parts[2:]:
            if token.startswith("model:"):
                model = token.split(":", 1)[1]
        devices.append(AdbDevice(serial=parts[0], state=parts[1], model=model))
    return devices


class AdbTransport(Transport):
    def __init__(
        self,
        adb_path: Path,
        serial: str,
        runner: Callable = subprocess.run,
        popen: Callable = subprocess.Popen,
    ) -> None:
        self._adb = Path(adb_path)
        self._serial = serial
        self._runner = runner
        self._popen = popen
        self._lock = threading.Lock()
        self._proc = None
        self._cancel_requested = False
        self._deadline_hit = False

    def describe(self) -> str:
        return f"ADB {self._serial}"

    def _argv(self, *args: str) -> list[str]:
        return [str(self._adb), "-s", self._serial, *args]

    def push(self, local: Path, remote: str) -> None:
        proc = _run(self._argv("push", str(local), remote), self._runner, timeout=600)
        if proc.returncode != 0:
            raise TransportError((proc.stderr or proc.stdout or "adb push failed").strip())

    def exec(self, cmd: str, timeout: int = 60) -> Result:
        proc = _run(self._argv("shell", wrap_command(cmd)), self._runner, timeout)
        if proc.returncode != 0 and _DEVICE_GONE_RE.search(proc.stderr or ""):
            raise DeviceGoneError((proc.stderr or "").strip())
        body, rc = parse_rc(strip_ansi(proc.stdout or ""))
        return Result(exit_code=rc, stdout=body.strip(), stderr=strip_ansi(proc.stderr or "").strip())

    def exec_stream(self, cmd: str, on_line, timeout: int = DEFAULT_EXEC_STREAM_TIMEOUT) -> int:
        # adb merges the remote stderr into stdout; keep them merged so the log
        # pane shows interleaved output in the order it was produced.
        proc = self._popen(
            self._argv("shell", wrap_command(cmd)),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            creationflags=_NO_WINDOW,
        )
        with self._lock:
            self._proc = proc
            self._cancel_requested = False
            self._deadline_hit = False

        # A watchdog timer is what makes `timeout` a REAL bound on the read
        # loop below, instead of a number only consulted after the loop has
        # already drained to EOF. If the remote command never closes stdout,
        # this fires on its own thread and terminates the same process
        # cancel() would — the `for raw in proc.stdout` loop unblocks the
        # instant the pipe closes, exactly like a genuine cancel.
        watchdog = threading.Timer(timeout, self._on_deadline, args=(proc,))
        watchdog.daemon = True
        watchdog.start()

        tail = ""
        try:
            assert proc.stdout is not None
            for raw in proc.stdout:
                line = strip_ansi(raw.rstrip("\r\n"))
                if line.startswith("__QM_RC="):
                    tail = line
                    continue
                on_line(line)
        finally:
            watchdog.cancel()
            with self._lock:
                cancelled = self._cancel_requested
                deadline_hit = self._deadline_hit
                self._proc = None
            # After an abort, terminate() was already sent — bound the wait
            # so a slow-to-die process can't re-introduce the hang this
            # feature exists to close. On normal completion the process has
            # already exited, so this returns immediately either way.
            wait_timeout = _TERMINATE_GRACE if (cancelled or deadline_hit) else timeout
            try:
                proc.wait(timeout=wait_timeout)
            except subprocess.TimeoutExpired:
                pass

        if cancelled:
            raise TransportCancelled("cancelled")
        if deadline_hit:
            raise TransportCancelled("deadline")
        _, rc = parse_rc(tail if tail else "")
        return rc

    def _on_deadline(self, proc) -> None:
        with self._lock:
            if self._proc is not proc:
                return  # exec_stream already finished; nothing to abort
            self._deadline_hit = True
        proc.terminate()

    def cancel(self) -> None:
        with self._lock:
            proc = self._proc
            if proc is None:
                return
            self._cancel_requested = True
        proc.terminate()

    def close(self) -> None:
        return None
