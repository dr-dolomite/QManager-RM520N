import pytest

from qmanager_installer.core.payload import Payload, PayloadError, load_payload

HASH = "a" * 64


def _write_payload(root, *, sha=HASH, version="v0.1.14", body=b"tar-bytes"):
    d = root / "payload"
    d.mkdir()
    (d / "qmanager.tar.gz").write_bytes(body)
    (d / "sha256sum.txt").write_text(f"{sha}  qmanager.tar.gz\n", encoding="utf-8")
    (d / "VERSION").write_text(f"{version}\n", encoding="utf-8")
    return d


def test_loads_tarball_sha_and_version(tmp_path):
    _write_payload(tmp_path)
    p = load_payload(tmp_path)
    assert isinstance(p, Payload)
    assert p.sha256 == HASH
    assert p.version == "v0.1.14"
    assert p.tarball.read_bytes() == b"tar-bytes"


def test_sha_is_lowercased_and_stripped_of_filename(tmp_path):
    _write_payload(tmp_path, sha=HASH.upper())
    assert load_payload(tmp_path).sha256 == HASH


def test_missing_tarball_raises(tmp_path):
    d = _write_payload(tmp_path)
    (d / "qmanager.tar.gz").unlink()
    with pytest.raises(PayloadError, match="qmanager.tar.gz"):
        load_payload(tmp_path)


def test_malformed_sha_raises(tmp_path):
    d = _write_payload(tmp_path)
    (d / "sha256sum.txt").write_text("not-a-hash\n", encoding="utf-8")
    with pytest.raises(PayloadError, match="sha256"):
        load_payload(tmp_path)


def test_empty_version_raises(tmp_path):
    d = _write_payload(tmp_path)
    (d / "VERSION").write_text("\n", encoding="utf-8")
    with pytest.raises(PayloadError, match="VERSION"):
        load_payload(tmp_path)
