"""Windows DPAPI, reached through ctypes — no third-party dependency.

DPAPI ("Data Protection API") is the OS service Windows uses to encrypt a
secret to the *logged-in account on this machine*. The key never leaves the
OS; we only ever hand it plaintext and get a blob back. That is the entire
security argument for letting the installer remember a root password at all:
the blob in settings.json is inert on any other Windows account and on any
other PC, so a copied or emailed settings file leaks nothing.

Two deliberate properties:

- **Fail closed, never raise.** `unprotect` returns None for a blob written
  by another account, a truncated file, garbage base64, or a non-Windows
  host. Callers render that as "no saved password" — the same thing a fresh
  install looks like. An exception here would cross the pywebview bridge as
  a rejected JS promise with no message the user ever sees.
- **App entropy.** CryptProtectData takes an optional second secret that
  must be supplied again to decrypt. Passing a fixed app-specific value
  means another process on the same account cannot open our blob just by
  calling CryptUnprotectData on the file.
"""

from __future__ import annotations

import base64
import ctypes
import os
from ctypes import wintypes

APP_ENTROPY = b"QManagerInstaller/ssh/v1"

CRYPTPROTECT_UI_FORBIDDEN = 0x01


class DpapiUnavailable(RuntimeError):
    """crypt32 could not be reached — a non-Windows host, or a call that
    failed outright. Callers degrade to not remembering the password."""


class _Blob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _blob(data: bytes) -> _Blob:
    buf = ctypes.create_string_buffer(data, len(data))
    return _Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))


def _read(blob: _Blob) -> bytes:
    return ctypes.string_at(blob.pbData, blob.cbData)


def _crypt32():
    if os.name != "nt":
        raise DpapiUnavailable("DPAPI is only available on Windows")
    try:
        return ctypes.WinDLL("crypt32.dll"), ctypes.WinDLL("kernel32.dll")
    except OSError as exc:  # pragma: no cover — a broken Windows install
        raise DpapiUnavailable(str(exc)) from exc


def protect(plaintext: str, entropy: bytes = APP_ENTROPY) -> str:
    """Encrypt to the current Windows account. Returns base64 for JSON.

    Raises DpapiUnavailable if the OS declines; the caller decides whether
    that means "do not remember" (it always does) rather than "crash".
    """
    crypt32, kernel32 = _crypt32()
    data_in, entropy_in, data_out = _blob(plaintext.encode("utf-8")), _blob(entropy), _Blob()
    ok = crypt32.CryptProtectData(
        ctypes.byref(data_in),
        None,
        ctypes.byref(entropy_in),
        None,
        None,
        CRYPTPROTECT_UI_FORBIDDEN,
        ctypes.byref(data_out),
    )
    if not ok:
        raise DpapiUnavailable(f"CryptProtectData failed (0x{ctypes.GetLastError():08X})")
    try:
        return base64.b64encode(_read(data_out)).decode("ascii")
    finally:
        kernel32.LocalFree(data_out.pbData)


def unprotect(blob_b64: str, entropy: bytes = APP_ENTROPY) -> str | None:
    """Decrypt, or None for anything this account/machine cannot open.

    None is not an error path — it is the ordinary answer for a settings
    file that travelled to a different PC.
    """
    if not blob_b64:
        return None
    try:
        raw = base64.b64decode(blob_b64, validate=True)
    except (ValueError, TypeError):
        return None
    try:
        crypt32, kernel32 = _crypt32()
    except DpapiUnavailable:
        return None

    data_in, entropy_in, data_out = _blob(raw), _blob(entropy), _Blob()
    ok = crypt32.CryptUnprotectData(
        ctypes.byref(data_in),
        None,
        ctypes.byref(entropy_in),
        None,
        None,
        CRYPTPROTECT_UI_FORBIDDEN,
        ctypes.byref(data_out),
    )
    if not ok:
        return None
    try:
        return _read(data_out).decode("utf-8")
    except UnicodeDecodeError:  # pragma: no cover — not something DPAPI produces
        return None
    finally:
        kernel32.LocalFree(data_out.pbData)
