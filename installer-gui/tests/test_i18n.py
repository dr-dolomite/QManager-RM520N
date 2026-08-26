import json
from pathlib import Path

from qmanager_installer.i18n import (
    DEFAULT_LOCALE,
    Translator,
    available_locales,
    load_translator,
)

LOCALES = Path(__file__).resolve().parents[1] / "locales"


def test_lookup_returns_the_string():
    t = Translator("en", {"app.title": "QManager Installer"}, {})
    assert t.t("app.title") == "QManager Installer"


def test_interpolates_named_params():
    t = Translator("en", {"x": "Upgrade {old} to {new}"}, {})
    assert t.t("x", old="v0.1.13", new="v0.1.14") == "Upgrade v0.1.13 to v0.1.14"


def test_missing_key_falls_back_to_english_and_is_recorded():
    t = Translator("zh-CN", {}, {"a.b": "English text"})
    assert t.t("a.b") == "English text"
    assert "a.b" in t.missing_keys


def test_key_missing_everywhere_returns_the_key_itself():
    t = Translator("zh-CN", {}, {})
    assert t.t("nope.nope") == "nope.nope"


def test_empty_string_counts_as_missing():
    # An untranslated blank must not render as a blank label.
    t = Translator("zh-CN", {"a.b": ""}, {"a.b": "English"})
    assert t.t("a.b") == "English"
    assert "a.b" in t.missing_keys


def test_shipped_locales_are_discovered():
    assert set(available_locales(LOCALES)) >= {"en", "zh-CN"}


def test_shipped_locales_have_identical_key_sets():
    en = json.loads((LOCALES / "en.json").read_text(encoding="utf-8"))
    zh = json.loads((LOCALES / "zh-CN.json").read_text(encoding="utf-8"))
    assert set(en) == set(zh), (
        f"only in en: {sorted(set(en) - set(zh))}; only in zh-CN: {sorted(set(zh) - set(en))}"
    )


def test_shipped_locales_have_no_empty_values():
    for name in ("en.json", "zh-CN.json"):
        data = json.loads((LOCALES / name).read_text(encoding="utf-8"))
        blank = [k for k, v in data.items() if not str(v).strip()]
        assert not blank, f"{name} has blank values: {blank}"


def test_load_translator_falls_back_to_english_for_an_unknown_locale():
    t = load_translator("fr", LOCALES)
    assert t.locale == DEFAULT_LOCALE
