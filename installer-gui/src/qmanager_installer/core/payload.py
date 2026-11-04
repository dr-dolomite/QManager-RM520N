"""Access to the QManager release artifact embedded at build time.

`build_installer.py` copies `qmanager-build/{qmanager.tar.gz,sha256sum.txt}` and
a stamped VERSION file into `payload/`. Nothing here re-rolls the tarball: the
artifact `build.sh` produced is the one that ships, byte for byte.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class PayloadError(RuntimeError):
    """The embedded payload is missing or malformed."""


@dataclass(frozen=True)
class Payload:
    tarball: Path
    sha256: str
    version: str


def payload_root() -> Path:
    """Directory holding the payload, both frozen and running from source."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).resolve().parents[3]


def load_payload(root: Path | None = None) -> Payload:
    base = (root or payload_root()) / "payload"

    tarball = base / "qmanager.tar.gz"
    if not tarball.is_file():
        raise PayloadError(f"Missing qmanager.tar.gz at {tarball}")

    sha_file = base / "sha256sum.txt"
    if not sha_file.is_file():
        raise PayloadError(f"Missing sha256sum.txt at {sha_file}")
    # Format is `<hash>  <filename>` — take the first field only.
    fields = sha_file.read_text(encoding="utf-8").strip().split()
    sha = fields[0].lower() if fields else ""
    if not SHA256_RE.match(sha):
        raise PayloadError(f"Malformed sha256 in {sha_file}: {sha!r}")

    version_file = base / "VERSION"
    if not version_file.is_file():
        raise PayloadError(f"Missing VERSION at {version_file}")
    version = version_file.read_text(encoding="utf-8").strip()
    if not version:
        raise PayloadError(f"Empty VERSION at {version_file}")

    return Payload(tarball=tarball, sha256=sha, version=version)
