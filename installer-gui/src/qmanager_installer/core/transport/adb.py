"""ADB transport: bundled adb.exe, addressed by serial."""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .base import (
    DeviceGoneError,
    Result,
    Transport,
    TransportError,
    parse_rc,
    strip_ansi,
    wrap_command,
)

# Windows: keep the console window from flashing on every adb call.
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

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

    def exec_stream(self, cmd: str, on_line, timeout: int = 1800) -> int:
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
        tail = ""
        assert proc.stdout is not None
        for raw in proc.stdout:
            line = strip_ansi(raw.rstrip("\r\n"))
            if line.startswith("__QM_RC="):
                tail = line
                continue
            on_line(line)
        proc.wait(timeout=timeout)
        _, rc = parse_rc(tail if tail else "")
        return rc

    def close(self) -> None:
        return None
