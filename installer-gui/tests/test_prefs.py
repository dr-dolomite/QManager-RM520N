"""Preference persistence, and the one rule that matters: the SSH password
never sits on disk in the clear.

Every test drives the pure functions through the `root=` / `cipher=` seams,
so nothing here touches %LOCALAPPDATA% or real DPAPI. test_dpapi.py covers
the real cipher.
"""

import json

import pytest

from qmanager_installer.core.prefs import (
    DEFAULT_HOST,
    DEFAULT_USER,
    Prefs,
    load_prefs,
    prefs_path,
    save_prefs,
)


class FakeCipher:
    """Reversible stand-in for DPAPI. `unprotect` returns None for anything
    it did not produce, which is exactly how the real one reports a blob
    written by another Windows account."""

    def protect(self, plaintext: str) -> str:
        return "enc:" + plaintext

    def unprotect(self, blob: str) -> str | None:
        return blob[4:] if blob.startswith("enc:") else None


class DeadCipher:
    """DPAPI on a machine that cannot decrypt what it is given — the copied
    settings file case. Must degrade, never raise."""

    def protect(self, plaintext: str) -> str:
        return "enc:" + plaintext

    def unprotect(self, blob: str) -> str | None:
        return None


def test_prefs_path_lands_under_localappdata(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    path = prefs_path()
    assert path.parent.name == "QManagerInstaller"
    assert path.parent.parent == tmp_path
    assert path.name == "settings.json"


def test_prefs_path_honours_the_root_seam(tmp_path):
    assert prefs_path(root=tmp_path).parent == tmp_path


def test_missing_file_yields_the_shipped_defaults(tmp_path):
    prefs = load_prefs(root=tmp_path)
    assert prefs.transport == "adb"
    assert prefs.ssh_host == DEFAULT_HOST
    assert prefs.ssh_user == DEFAULT_USER
    assert prefs.remember_password is False
    assert prefs.ssh_password_blob == ""


def test_corrupt_file_yields_defaults_and_does_not_raise(tmp_path):
    prefs_path(root=tmp_path).write_text("{not json at all", encoding="utf-8")
    prefs = load_prefs(root=tmp_path)
    assert prefs.ssh_host == DEFAULT_HOST


def test_unknown_keys_in_the_file_are_ignored(tmp_path):
    # A settings file written by a future version must not crash an older one.
    prefs_path(root=tmp_path).write_text(
        json.dumps({"ssh_host": "10.0.0.1", "invented_later": True}), encoding="utf-8"
    )
    assert load_prefs(root=tmp_path).ssh_host == "10.0.0.1"


def test_the_plaintext_password_never_reaches_the_disk(tmp_path):
    prefs = Prefs(ssh_host="10.0.0.1", ssh_user="root", remember_password=True)
    prefs.set_password("hunter2", cipher=FakeCipher())
    save_prefs(prefs, root=tmp_path)

    raw = prefs_path(root=tmp_path).read_bytes()
    assert b"hunter2" not in raw, "the SSH password was written in the clear"
    assert b"10.0.0.1" in raw  # the non-secret fields did persist


def test_a_saved_password_round_trips(tmp_path):
    cipher = FakeCipher()
    prefs = Prefs(remember_password=True)
    prefs.set_password("hunter2", cipher=cipher)
    save_prefs(prefs, root=tmp_path)

    reloaded = load_prefs(root=tmp_path)
    assert reloaded.remember_password is True
    assert reloaded.get_password(cipher=cipher) == "hunter2"


def test_an_undecryptable_blob_reads_as_no_password(tmp_path):
    prefs = Prefs(remember_password=True)
    prefs.set_password("hunter2", cipher=FakeCipher())
    save_prefs(prefs, root=tmp_path)

    reloaded = load_prefs(root=tmp_path)
    assert reloaded.get_password(cipher=DeadCipher()) is None


def test_clearing_the_password_keeps_the_rest(tmp_path):
    cipher = FakeCipher()
    prefs = Prefs(ssh_host="10.0.0.1", ssh_user="admin", remember_password=True)
    prefs.set_password("hunter2", cipher=cipher)
    save_prefs(prefs, root=tmp_path)

    prefs.clear_password()
    save_prefs(prefs, root=tmp_path)

    reloaded = load_prefs(root=tmp_path)
    assert reloaded.ssh_password_blob == ""
    assert reloaded.remember_password is False
    assert reloaded.get_password(cipher=cipher) is None
    assert reloaded.ssh_host == "10.0.0.1"
    assert reloaded.ssh_user == "admin"


def test_a_cipher_that_raises_does_not_break_saving(tmp_path):
    class ExplodingCipher:
        def protect(self, plaintext: str) -> str:
            raise OSError("CryptProtectData failed")

        def unprotect(self, blob: str) -> str | None:
            raise OSError("CryptUnprotectData failed")

    prefs = Prefs(remember_password=True)
    prefs.set_password("hunter2", cipher=ExplodingCipher())  # must not raise
    assert prefs.ssh_password_blob == ""
    assert prefs.get_password(cipher=ExplodingCipher()) is None


def test_an_unwritable_root_degrades_instead_of_crashing(tmp_path):
    # %LOCALAPPDATA% on a locked-down or roaming profile. "Not remembered" is
    # an acceptable outcome; a traceback on the connect screen is not.
    blocker = tmp_path / "settings"
    blocker.write_text("I am a file, not a directory", encoding="utf-8")
    assert save_prefs(Prefs(), root=blocker) is False


@pytest.mark.parametrize("transport", ["adb", "ssh"])
def test_the_last_transport_round_trips(tmp_path, transport):
    save_prefs(Prefs(transport=transport, locale="zh-CN"), root=tmp_path)
    reloaded = load_prefs(root=tmp_path)
    assert reloaded.transport == transport
    assert reloaded.locale == "zh-CN"
