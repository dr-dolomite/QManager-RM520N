"""Locale loading with English fallback.

Locale files sit BESIDE the executable as plain JSON (which is why the build is
onedir, not onefile) so a native speaker can correct one and send it back.
Missing keys fall back to English and are recorded, so a partial translation
still ships and the gaps are one diff away.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_LOCALE = "en"


def locales_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent / "locales"
    return Path(__file__).resolve().parents[2] / "locales"


@dataclass
class Translator:
    locale: str
    strings: dict[str, str]
    fallback: dict[str, str]
    missing_keys: list[str] = field(default_factory=list)

    def t(self, key: str, **params: object) -> str:
        value = self.strings.get(key)
        if not (value and str(value).strip()):
            if key not in self.missing_keys:
                self.missing_keys.append(key)
            value = self.fallback.get(key)
        if not (value and str(value).strip()):
            return key
        try:
            return str(value).format(**params)
        except (KeyError, IndexError):
            # A translator typo in a placeholder must not crash the installer.
            return str(value)


def available_locales(root: Path | None = None) -> list[str]:
    base = root or locales_root()
    return sorted(p.stem for p in base.glob("*.json"))


def load_translator(locale: str, root: Path | None = None) -> Translator:
    base = root or locales_root()

    def read(name: str) -> dict[str, str]:
        path = base / f"{name}.json"
        if not path.is_file():
            return {}
        return json.loads(path.read_text(encoding="utf-8"))

    fallback = read(DEFAULT_LOCALE)
    if locale == DEFAULT_LOCALE or not (base / f"{locale}.json").is_file():
        return Translator(DEFAULT_LOCALE, fallback, {})
    return Translator(locale, read(locale), fallback)
