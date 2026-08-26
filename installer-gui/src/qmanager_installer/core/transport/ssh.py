"""SSH transport. Password authentication only (spec §10, settled 2026-08-26)."""

from __future__ import annotations

from pathlib import Path
from typing import Callable

from .base import (
    Result,
    Transport,
    TransportError,
    parse_rc,
    strip_ansi,
    wrap_command,
)


def _default_client_factory():
    import paramiko

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    return client


class SshTransport(Transport):
    def __init__(
        self,
        host: str,
        username: str,
        password: str,
        port: int = 22,
        client_factory: Callable = _default_client_factory,
    ) -> None:
        self._host = host
        self._port = port
        self._username = username
        self._password = password
        self._client_factory = client_factory
        self._client = None

    def describe(self) -> str:
        return f"SSH {self._host}"

    def _connected(self):
        if self._client is None:
            client = self._client_factory()
            try:
                client.connect(
                    hostname=self._host,
                    port=self._port,
                    username=self._username,
                    password=self._password,
                    look_for_keys=False,
                    allow_agent=False,
                    timeout=15,
                )
            except Exception as exc:  # paramiko raises a wide family
                raise TransportError(f"SSH connection failed: {exc}") from exc
            self._client = client
        return self._client

    def push(self, local: Path, remote: str) -> None:
        sftp = self._connected().open_sftp()
        try:
            sftp.put(str(local), remote)
        except Exception as exc:
            raise TransportError(f"SFTP put failed: {exc}") from exc
        finally:
            sftp.close()

    def exec(self, cmd: str, timeout: int = 60) -> Result:
        # NOTE: we deliberately do NOT consult stdout.channel.recv_exit_status()
        # here. Once a command is wrapped, `echo` is always the last command
        # in the string, and `echo` always succeeds — so the SSH channel's
        # exit status is 0 for every wrapped command, success or failure. It
        # carries no information post-wrapping; only the sentinel is
        # authoritative. (An earlier version cross-checked the two and raised
        # on disagreement, which made every failing command over SSH raise
        # TransportError instead of returning its real exit code — including
        # `run_preflight`'s version probe on a fresh device, whose whole job
        # is to fail.)
        _, stdout, stderr = self._connected().exec_command(wrap_command(cmd), timeout=timeout)
        out = stdout.read() if hasattr(stdout, "read") else ""
        out = out.decode("utf-8", "replace") if isinstance(out, bytes) else out
        err = stderr.read() if hasattr(stderr, "read") else ""
        err = err.decode("utf-8", "replace") if isinstance(err, bytes) else err

        body, rc = parse_rc(strip_ansi(out))
        return Result(exit_code=rc, stdout=body.strip(), stderr=strip_ansi(err).strip())

    def exec_stream(self, cmd: str, on_line, timeout: int = 1800) -> int:
        # `2>&1` binds to the single simple command it trails. Appending it
        # after wrap_command's output would redirect only the trailing
        # `echo`, not the user's command — silently dropping every stderr
        # line the remote command writes (the opkg/tar/systemctl/curl
        # diagnostics this method exists to stream). Wrapping the whole
        # wrapped string in one more brace group makes `2>&1` apply to
        # everything inside it.
        full_cmd = "{ " + wrap_command(cmd) + "; } 2>&1"
        _, stdout, _ = self._connected().exec_command(full_cmd, timeout=timeout, get_pty=False)
        tail = ""
        for raw in iter(stdout.readline, ""):
            line = strip_ansi(raw.rstrip("\r\n"))
            if line.startswith("__QM_RC="):
                tail = line
                continue
            on_line(line)
        _, rc = parse_rc(tail)
        return rc

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None
