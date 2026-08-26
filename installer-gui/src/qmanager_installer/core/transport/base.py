"""Transport abstraction and the exit-code sentinel.

`adb shell` does not propagate the remote command's exit status — it returns
adb's own. On this platform a failure produces NO parseable stdout (`ERROR`
never reaches it), so trusting adb's status would report a failed install as a
success. Every command is therefore wrapped to echo its real status, and a
MISSING sentinel is treated as failure.
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

RC_SENTINEL = "__QM_RC="
MISSING_SENTINEL_RC = 255

_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")


class TransportError(RuntimeError):
    """The transport itself failed (not the remote command)."""


class DeviceGoneError(TransportError):
    """The device disappeared mid-operation — unplugged, or rebooting."""


@dataclass(frozen=True)
class Result:
    exit_code: int
    stdout: str
    stderr: str

    @property
    def ok(self) -> bool:
        return self.exit_code == 0


def strip_ansi(text: str) -> str:
    return _ANSI_RE.sub("", text)


def wrap_command(cmd: str) -> str:
    # Brace-grouped: a bare `{cmd}; echo ...` is a shell syntax error whenever
    # `cmd` ends in `&` (a backgrounded compound command, e.g. the reboot
    # step) — the parser sees `& ;` and rejects the whole line before
    # anything runs. `{ cmd; }; echo ...` parses in every POSIX shell
    # (verified against dash and BusyBox ash on the live RM520N-GL) because
    # `&` legally closes a compound command inside a brace group — but ONLY
    # if nothing sits between the `&` and the closing `}` except whitespace.
    # A command already ending in `&` must NOT also get the `;` separator:
    # `& ;` is the exact same syntax error we are fixing. Every other command
    # needs the `;` — `{ cmd }` with no terminator is itself a syntax error.
    sep = "" if cmd.rstrip().endswith("&") else ";"
    return f"{{ {cmd}{sep} }}; echo {RC_SENTINEL}$?"


def parse_rc(raw: str) -> tuple[str, int]:
    """Split a wrapped command's output into (body, exit_code).

    Scans from the END so a log line quoting the sentinel cannot shadow the
    real one. A missing or non-numeric sentinel yields MISSING_SENTINEL_RC and
    the untouched raw text, so the caller still sees whatever was produced.
    """
    lines = raw.splitlines()
    for i in range(len(lines) - 1, -1, -1):
        line = lines[i].strip()
        if not line:
            continue
        if line.startswith(RC_SENTINEL):
            digits = line[len(RC_SENTINEL) :].strip()
            if digits.isdigit():
                return "\n".join(lines[:i]), int(digits)
            return raw, MISSING_SENTINEL_RC
        # First non-blank line from the end is not the sentinel — it is missing.
        break
    return raw, MISSING_SENTINEL_RC


class Transport(ABC):
    """One device, one connection. Implementations: AdbTransport, SshTransport."""

    @abstractmethod
    def describe(self) -> str:
        """Short human label, e.g. 'ADB 61368cd2' or 'SSH 192.168.225.1'."""

    @abstractmethod
    def push(self, local: Path, remote: str) -> None:
        """Copy a local file to the device. Raises TransportError on failure."""

    @abstractmethod
    def exec(self, cmd: str, timeout: int = 60) -> Result:
        """Run a shell command, returning its REAL exit code."""

    @abstractmethod
    def exec_stream(self, cmd: str, on_line: Callable[[str], None], timeout: int = 1800) -> int:
        """Run a command, delivering ANSI-stripped lines live. Returns exit code."""

    @abstractmethod
    def close(self) -> None: ...
