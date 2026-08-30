"""The real Windows cipher.

DPAPI is per-user and per-machine by design: the blob in settings.json is
inert on any other account or PC. That is the whole security argument for
saving a root password at all, so it is worth a test that actually calls
crypt32 rather than a mock agreeing with itself.
"""

import os

import pytest

from qmanager_installer.core import dpapi

windows_only = pytest.mark.skipif(os.name != "nt", reason="DPAPI is Windows-only")


@windows_only
def test_protect_unprotect_round_trips_through_crypt32():
    blob = dpapi.protect("hunter2")
    assert dpapi.unprotect(blob) == "hunter2"


@windows_only
def test_the_blob_does_not_contain_the_plaintext():
    blob = dpapi.protect("hunter2")
    assert "hunter2" not in blob


@windows_only
def test_non_ascii_passwords_survive():
    assert dpapi.unprotect(dpapi.protect("pässwörd-密码")) == "pässwörd-密码"


@windows_only
def test_garbage_returns_none_rather_than_raising():
    assert dpapi.unprotect("not base64 at all !!") is None
    assert dpapi.unprotect("aGVsbG8=") is None  # valid base64, not a DPAPI blob
    assert dpapi.unprotect("") is None


@windows_only
def test_a_blob_made_with_different_entropy_will_not_decrypt():
    # Pins that the app entropy is actually passed to CryptProtectData: a
    # blob another process produced without it must not open here.
    foreign = dpapi.protect("hunter2", entropy=b"some-other-app")
    assert dpapi.unprotect(foreign) is None
