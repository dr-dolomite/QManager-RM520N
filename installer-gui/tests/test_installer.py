from pathlib import Path

import pytest

from qmanager_installer.core.installer import (
    InstallError,
    InstallOptions,
    InstallRunner,
    parse_progress,
)
from qmanager_installer.core.payload import Payload
from qmanager_installer.core.transport.base import Result, TransportError

SHA = "a" * 64


def make_payload(tmp_path):
    tarball = tmp_path / "qmanager.tar.gz"
    tarball.write_bytes(b"x")
    return Payload(tarball=tarball, sha256=SHA, version="v0.1.14")


class FakeTransport:
    def __init__(self, sha=SHA, stream_lines=(), stream_rc=0):
        self.sha = sha
        self.stream_lines = list(stream_lines)
        self.stream_rc = stream_rc
        self.pushed = []
        self.commands = []
        self.stream_commands = []
        self.push_error = None
        self.reboot_raises = False
        self.reboot_rc = 0

    def push(self, local, remote):
        if self.push_error:
            raise TransportError(self.push_error)
        self.pushed.append((Path(local).name, remote))

    def exec(self, cmd, timeout=60):
        self.commands.append(cmd)
        if "sha256sum" in cmd:
            return Result(0, self.sha, "")
        if "reboot" in cmd:
            if self.reboot_raises:
                raise TransportError("device offline")
            if self.reboot_rc != 0:
                return Result(self.reboot_rc, "", "sh: syntax error: unexpected \";\"")
            return Result(0, "", "")
        return Result(0, "", "")

    def exec_stream(self, cmd, on_line, timeout=1800):
        self.stream_commands.append(cmd)
        for line in self.stream_lines:
            on_line(line)
        return self.stream_rc

    def describe(self):
        return "FAKE"


def run(tmp_path, transport, **opts):
    lines, progress = [], []
    runner = InstallRunner(
        transport,
        make_payload(tmp_path),
        on_line=lines.append,
        on_progress=progress.append,
    )
    outcome = runner.run(InstallOptions(**opts))
    return outcome, lines, progress


# --- progress parsing ---------------------------------------------------------

def test_parse_progress_matches_installer_format():
    p = parse_progress("  [Step 3/12]")
    assert (p.step, p.total) == (3, 12)


def test_parse_progress_ignores_other_lines():
    assert parse_progress("    *  jq is already installed") is None


def test_parse_progress_finds_the_marker_even_with_leftover_ansi():
    # The transport strips ANSI before this runs, but the regex searches
    # rather than matches, so a stray escape must not hide the marker.
    p = parse_progress("  [2m[Step 1/9][0m")
    assert (p.step, p.total) == (1, 9)


# --- happy path ---------------------------------------------------------------

def test_successful_install_pushes_verifies_extracts_and_runs(tmp_path):
    t = FakeTransport(stream_lines=["  [Step 1/9]", "    *  done"])
    outcome, lines, progress = run(tmp_path, t, reboot=False)
    assert outcome.ok
    assert t.pushed == [("qmanager.tar.gz", "/tmp/qmanager.tar.gz")]
    assert any("sha256sum" in c for c in t.commands)
    assert any("tar xzf" in c for c in t.commands)
    assert any("install_rm520n.sh" in c for c in t.stream_commands)
    assert (progress[0].step, progress[0].total) == (1, 9)
    assert "    *  done" in lines


def test_installer_is_always_invoked_with_no_reboot(tmp_path):
    # Its exit code must always reach us; the reboot is issued separately.
    t = FakeTransport()
    run(tmp_path, t, reboot=True)
    cmd = next(c for c in t.stream_commands if "install_rm520n.sh" in c)
    assert "--force" in cmd
    assert "--no-reboot" in cmd


def test_reboot_requested_issues_a_separate_reboot(tmp_path):
    t = FakeTransport()
    outcome, _, _ = run(tmp_path, t, reboot=True)
    assert outcome.rebooted
    assert any("reboot" in c for c in t.commands)


def test_reboot_not_requested_issues_no_reboot(tmp_path):
    t = FakeTransport()
    outcome, _, _ = run(tmp_path, t, reboot=False)
    assert not outcome.rebooted
    assert not any("reboot" in c for c in t.commands)


def test_transport_dying_during_reboot_is_success_not_failure(tmp_path):
    # A rebooting device is supposed to stop answering.
    t = FakeTransport()
    t.reboot_raises = True
    outcome, _, _ = run(tmp_path, t, reboot=True)
    assert outcome.ok
    assert outcome.rebooted


def test_reboot_command_failing_without_raising_is_not_reported_as_rebooted(tmp_path):
    # This is exactly what the unbraced reboot command did before the
    # brace-grouping fix: the shell rejects it as a syntax error (exit 2),
    # `sync` never runs, and the device never reboots. That is a real,
    # observable failure — not a "device went away" transport death — so it
    # must not be swallowed and reported as ok=True/rebooted=True the way the
    # old bare `except TransportError: pass` did (it didn't even catch this
    # case, since a non-zero Result is not an exception at all).
    t = FakeTransport()
    t.reboot_rc = 2
    with pytest.raises(InstallError) as exc:
        run(tmp_path, t, reboot=True)
    assert exc.value.step == "reboot"
    assert exc.value.exit_code == 2


# --- failure paths ------------------------------------------------------------

def test_sha_mismatch_refuses_to_extract(tmp_path):
    t = FakeTransport(sha="b" * 64)
    with pytest.raises(InstallError) as exc:
        run(tmp_path, t, reboot=False)
    assert exc.value.step == "verify"
    assert not any("tar xzf" in c for c in t.commands)


def test_push_failure_is_reported_as_the_push_step(tmp_path):
    t = FakeTransport()
    t.push_error = "no space left on device"
    with pytest.raises(InstallError) as exc:
        run(tmp_path, t, reboot=False)
    assert exc.value.step == "push"
    assert "no space left" in exc.value.stderr


def test_nonzero_installer_exit_is_a_failure(tmp_path):
    t = FakeTransport(stream_rc=1)
    with pytest.raises(InstallError) as exc:
        run(tmp_path, t, reboot=False)
    assert exc.value.step == "install"
    assert exc.value.exit_code == 1


def test_missing_sentinel_exit_code_is_a_failure(tmp_path):
    t = FakeTransport(stream_rc=255)
    with pytest.raises(InstallError):
        run(tmp_path, t, reboot=False)
