"""Push → verify → extract → run → stream.

The installer is ALWAYS invoked with --no-reboot so its exit code reaches us;
the reboot, if requested, is a separate command. Letting the installer reboot
would make a genuine mid-install failure indistinguishable from a normal one,
because the exit code would never come back.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .payload import Payload
from .session_log import SessionLog
from .transport.base import Transport, TransportError

REMOTE_TARBALL = "/tmp/qmanager.tar.gz"
REMOTE_DIR = "/tmp/qmanager_install"

# install_rm520n.sh:271 — printf "  [Step %d/%d]"
_PROGRESS_RE = re.compile(r"\[Step (\d+)/(\d+)\]")


@dataclass(frozen=True)
class Progress:
    step: int
    total: int


@dataclass(frozen=True)
class InstallOptions:
    reboot: bool = True


@dataclass(frozen=True)
class InstallOutcome:
    ok: bool
    exit_code: int
    rebooted: bool
    log_path: Path | None = None


class InstallError(RuntimeError):
    def __init__(self, step: str, command: str, exit_code: int, stderr: str) -> None:
        super().__init__(f"[{step}] exit {exit_code}: {stderr.strip()[:400]}")
        self.step = step
        self.command = command
        self.exit_code = exit_code
        self.stderr = stderr


def parse_progress(line: str) -> Progress | None:
    match = _PROGRESS_RE.search(line)
    if not match:
        return None
    return Progress(step=int(match.group(1)), total=int(match.group(2)))


class InstallRunner:
    def __init__(
        self,
        transport: Transport,
        payload: Payload,
        on_line: Callable[[str], None],
        on_progress: Callable[[Progress], None],
        log: SessionLog | None = None,
        script: str = "install_rm520n.sh",
    ) -> None:
        self._t = transport
        self._payload = payload
        self._on_line = on_line
        self._on_progress = on_progress
        self._log = log
        self._script = script

    def _emit(self, line: str) -> None:
        if self._log is not None:
            self._log.write(line)
        progress = parse_progress(line)
        if progress is not None:
            self._on_progress(progress)
        self._on_line(line)

    def _exec_or_raise(self, step: str, cmd: str, timeout: int = 120) -> None:
        self._emit(f"$ {cmd}")
        result = self._t.exec(cmd, timeout=timeout)
        if not result.ok:
            raise InstallError(step, cmd, result.exit_code, result.stderr or result.stdout)

    def run(self, options: InstallOptions) -> InstallOutcome:
        # 1. push
        self._emit(f"push {self._payload.tarball.name} -> {REMOTE_TARBALL}")
        try:
            self._t.push(self._payload.tarball, REMOTE_TARBALL)
        except TransportError as exc:
            raise InstallError("push", "push", 1, str(exc)) from exc

        # 2. verify on device — a truncated push is otherwise invisible
        verify_cmd = f"sha256sum {REMOTE_TARBALL} | awk '{{print $1}}'"
        self._emit(f"$ {verify_cmd}")
        verify = self._t.exec(verify_cmd, timeout=120)
        remote_sha = verify.stdout.strip().lower()
        if not verify.ok or remote_sha != self._payload.sha256:
            raise InstallError(
                "verify", verify_cmd, verify.exit_code or 1,
                f"expected {self._payload.sha256}, device reported {remote_sha or 'nothing'}",
            )
        self._emit(f"sha256 verified: {remote_sha}")

        # 3. extract
        self._exec_or_raise("extract", f"rm -rf {REMOTE_DIR} && tar xzf {REMOTE_TARBALL} -C /tmp", 180)

        # 4. run — always --no-reboot so the exit code reaches us
        cmd = f"bash {REMOTE_DIR}/{self._script} --force --no-reboot"
        self._emit(f"$ {cmd}")
        exit_code = self._t.exec_stream(cmd, self._emit, timeout=1800)
        if exit_code != 0:
            raise InstallError("install", cmd, exit_code, "installer exited non-zero")

        # 5. reboot, separately. A dead transport here is the expected outcome
        # (a rebooting device is supposed to stop answering) — but a Result
        # that comes back with a non-zero exit code is a REAL failure (e.g. a
        # shell syntax error means `sync` never even ran) and must not be
        # reported as a successful reboot.
        rebooted = False
        if options.reboot:
            reboot_cmd = "sync; (sleep 1; reboot) >/dev/null 2>&1 &"
            self._emit(f"$ {reboot_cmd}")
            try:
                result = self._t.exec(reboot_cmd, timeout=30)
            except TransportError:
                rebooted = True  # a rebooting device is supposed to stop answering
            else:
                if not result.ok:
                    raise InstallError(
                        "reboot", reboot_cmd, result.exit_code, result.stderr or result.stdout
                    )
                rebooted = True

        return InstallOutcome(
            ok=True,
            exit_code=0,
            rebooted=rebooted,
            log_path=self._log.path if self._log else None,
        )
