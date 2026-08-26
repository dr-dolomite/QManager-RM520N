import io
from pathlib import Path

import pytest

from qmanager_installer.core.transport.base import MISSING_SENTINEL_RC, TransportError
from qmanager_installer.core.transport.ssh import SshTransport


class FakeChannel:
    def __init__(self, rc):
        self._rc = rc

    def recv_exit_status(self):
        return self._rc


class FakeStdout(io.StringIO):
    def __init__(self, text, rc):
        super().__init__(text)
        self.channel = FakeChannel(rc)


class FakeSftp:
    def __init__(self):
        self.puts = []
        self.fail = False

    def put(self, local, remote):
        if self.fail:
            raise OSError("permission denied")
        self.puts.append((local, remote))

    def close(self):
        pass


class FakeClient:
    def __init__(self, stdout_text="__QM_RC=0\n", channel_rc=0):
        self.stdout_text = stdout_text
        self.channel_rc = channel_rc
        self.connected = None
        self.commands = []
        self.sftp = FakeSftp()

    def set_missing_host_key_policy(self, policy):
        pass

    def connect(self, **kwargs):
        self.connected = kwargs

    def exec_command(self, cmd, timeout=None, get_pty=False):
        self.commands.append(cmd)
        return io.StringIO(""), FakeStdout(self.stdout_text, self.channel_rc), io.StringIO("")

    def open_sftp(self):
        return self.sftp

    def close(self):
        pass


def make(client):
    return SshTransport("10.0.0.1", "root", "pw", client_factory=lambda: client)


def test_connect_uses_password_auth_only():
    client = FakeClient()
    make(client).exec("true")
    assert client.connected["password"] == "pw"
    assert client.connected["look_for_keys"] is False
    assert client.connected["allow_agent"] is False


def test_exec_returns_remote_exit_code():
    client = FakeClient("out\n__QM_RC=4\n", channel_rc=4)
    assert make(client).exec("x").exit_code == 4


def test_channel_status_is_ignored_sentinel_is_authoritative():
    # After wrapping, `echo` is always the last command in the string, and
    # `echo` always succeeds — so the SSH channel's own exit status is 0 for
    # EVERY wrapped command, success or failure. It carries no information
    # once wrapping is in play, so a divergence from the sentinel must not
    # raise; only the sentinel is trusted.
    client = FakeClient("out\n__QM_RC=0\n", channel_rc=7)
    assert make(client).exec("x").exit_code == 0


def test_failing_command_returns_sentinel_rc_without_raising():
    # This is the real shape a failure takes on the wire: the remote command
    # failed (sentinel=1) but the channel status is 0, because `echo` was the
    # last thing that ran. This exact pairing was reproduced on the live
    # RM520N-GL. Raising here made `run_preflight`'s `cat VERSION` on a fresh
    # device (which MUST fail) blow up SSH before the installer could do
    # anything.
    client = FakeClient("boom\n__QM_RC=1\n", channel_rc=0)
    result = make(client).exec("false")
    assert result.exit_code == 1
    assert result.stdout == "boom"


def test_missing_sentinel_is_failure_even_when_channel_says_zero():
    client = FakeClient("no sentinel here\n", channel_rc=0)
    assert make(client).exec("x").exit_code == MISSING_SENTINEL_RC


def test_exec_stream_redirects_stderr_for_the_whole_wrapped_command():
    # `2>&1` binds to the single simple command it trails. Appending it AFTER
    # wrap_command's output means it only redirects the trailing `echo`, not
    # the user's command — so every diagnostic the remote command writes to
    # stderr (opkg/tar/systemctl/curl failures) silently vanishes from the
    # streamed log. Reproduced locally: `{ cmd; }; echo __QM_RC=$? 2>&1`
    # loses a stderr line the whole-group form `{ { cmd; }; echo ...; } 2>&1`
    # keeps. This test pins the exact built string — a fake transport can't
    # parse shell syntax, so the string itself is the only thing to assert.
    client = FakeClient("OUT\nERRLINE\n__QM_RC=3\n", channel_rc=0)
    made = make(client)
    lines = []
    rc = made.exec_stream("sh -c 'echo OUT; echo ERRLINE >&2; exit 3'", lines.append)
    assert client.commands[0] == (
        "{ { sh -c 'echo OUT; echo ERRLINE >&2; exit 3'; }; echo __QM_RC=$?; } 2>&1"
    )
    assert rc == 3
    assert "ERRLINE" in lines


def test_push_uses_sftp():
    client = FakeClient()
    make(client).push(Path("a.tar.gz"), "/tmp/a.tar.gz")
    assert client.sftp.puts == [("a.tar.gz", "/tmp/a.tar.gz")]


def test_push_failure_raises_transport_error():
    client = FakeClient()
    client.sftp.fail = True
    with pytest.raises(TransportError, match="permission denied"):
        make(client).push(Path("a.tar.gz"), "/tmp/a.tar.gz")
