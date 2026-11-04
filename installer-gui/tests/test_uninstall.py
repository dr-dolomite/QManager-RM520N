from pathlib import Path

from qmanager_installer.core.installer import InstallOptions
from qmanager_installer.core.payload import Payload
from qmanager_installer.core.uninstall import UninstallRunner
from qmanager_installer.core.transport.base import Result

SHA = "a" * 64


class FakeTransport:
    def __init__(self):
        self.commands = []
        self.stream_commands = []

    def push(self, local, remote):
        pass

    def exec(self, cmd, timeout=60):
        self.commands.append(cmd)
        if "sha256sum" in cmd:
            return Result(0, SHA, "")
        return Result(0, "", "")

    def exec_stream(self, cmd, on_line, timeout=1800):
        self.stream_commands.append(cmd)
        return 0

    def describe(self):
        return "FAKE"


def test_uninstall_runs_the_uninstall_script(tmp_path):
    tarball = tmp_path / "qmanager.tar.gz"
    tarball.write_bytes(b"x")
    t = FakeTransport()
    UninstallRunner(
        t,
        Payload(tarball=tarball, sha256=SHA, version="v0.1.14"),
        on_line=lambda _: None,
        on_progress=lambda _: None,
    ).run(InstallOptions(reboot=False))
    cmd = next(c for c in t.stream_commands if "uninstall_rm520n.sh" in c)
    assert "--force" in cmd
    assert "--no-reboot" in cmd


def test_uninstall_never_passes_skip_packages(tmp_path):
    # uninstall_rm520n.sh has no --skip-packages option and would die on
    # "Unknown option" — InstallRunner.run() must not leak the flag into
    # UninstallRunner's shared run() even if the UI happened to send it.
    tarball = tmp_path / "qmanager.tar.gz"
    tarball.write_bytes(b"x")
    t = FakeTransport()
    UninstallRunner(
        t,
        Payload(tarball=tarball, sha256=SHA, version="v0.1.14"),
        on_line=lambda _: None,
        on_progress=lambda _: None,
    ).run(InstallOptions(reboot=False, skip_packages=True))
    assert not any("--skip-packages" in c for c in t.stream_commands)


def test_uninstall_never_passes_purge(tmp_path):
    # --purge destroys user configuration; the GUI does not decide that.
    tarball = tmp_path / "qmanager.tar.gz"
    tarball.write_bytes(b"x")
    t = FakeTransport()
    UninstallRunner(
        t,
        Payload(tarball=tarball, sha256=SHA, version="v0.1.14"),
        on_line=lambda _: None,
        on_progress=lambda _: None,
    ).run(InstallOptions(reboot=False))
    assert not any("--purge" in c for c in t.stream_commands)
