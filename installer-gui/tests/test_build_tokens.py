"""Tests for build_installer.py.

Covers three corrections to the plan's Task 10, verified against a live
adversarial review before implementation:

  1. The plan's extractor takes only the first `:root` and first `.dark`
     block from app/globals.css. The shape scale (--radius-*) and
     --ease-standard live in `@theme inline { ... }`, which closes BEFORE
     the first `:root` opens — so the plan's own extractor never captures
     them. The fix extracts three blocks (@theme inline, :root, .dark),
     rewriting the `@theme inline {` header to `:root {` on the way out.
     An explicit allow-list assertion pins every token the UI actually
     references (see REQUIRED_TOKENS below).

  2. PyInstaller 6 onedir mode puts --add-binary payloads under
     dist/<name>/_internal/, not beside the launcher exe. The runtime
     resolver for adb looks beside the exe (matching how locales/ and
     payload/ are staged). The fix drops --add-binary for adb and
     shutil.copytree()s vendor/adb next to the exe instead.

  3. stage_payload() must not trust package.json's version blindly — it
     must read the version baked into the tarball's own
     qmanager_install/install_rm520n.sh and fail the build if it disagrees
     with package.json, since that's the value the device will actually
     report after install.
"""
from __future__ import annotations

import sys
import tarfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build_installer import (  # noqa: E402
    REQUIRED_TOKENS,
    BuildError,
    TokenExtractionError,
    build_pyinstaller_argv,
    check_vendor_adb,
    extract_token_blocks,
    stage_payload,
    stage_runtime_assets,
)

REPO_CSS = Path(__file__).resolve().parents[2] / "app" / "globals.css"

# A minimal but structurally faithful stand-in for app/globals.css: an
# @theme inline block (shape + ease tokens, like the real file), a first
# :root (colors + duration), a first .dark, and a LATER :root that is
# Tailwind-only — mirroring the four real @variant-only :root blocks that
# come after the first one.
SAMPLE = """
@theme inline {
  --color-primary: var(--primary);
  --radius-card: 2.25rem;
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
}

:root {
  --background: oklch(0.99 0 0);
  --duration-standard: 600ms;
}

.dark {
  --background: oklch(0.12 0.008 258);
}

:root {
  @variant motion-reduce {
    & .nav-indicator { transition: none; }
  }
}
"""


# ---------------------------------------------------------------------------
# Correction 1: three-block extraction (@theme inline + :root + .dark)
# ---------------------------------------------------------------------------


def test_extracts_theme_root_and_dark():
    out = extract_token_blocks(SAMPLE)
    assert "--radius-card: 2.25rem" in out
    assert "--ease-standard: cubic-bezier(0.2, 0, 0, 1)" in out
    assert "--duration-standard: 600ms" in out
    assert "oklch(0.12 0.008 258)" in out
    # Exactly the theme block (rewritten to :root) + the first real :root
    # block == two ":root" occurrences, plus one ".dark".
    assert out.count(":root") == 2
    assert out.count(".dark") == 1


def test_theme_header_rewritten_to_root_not_left_as_at_theme():
    out = extract_token_blocks(SAMPLE)
    assert "@theme" not in out
    # The rewritten header must still open a real block (braces balance).
    assert out.count("{") == out.count("}")


def test_tailwind_at_rules_never_reach_the_output():
    out = extract_token_blocks(SAMPLE)
    assert "@variant" not in out
    assert "@theme" not in out
    assert "@apply" not in out


def test_raises_when_no_theme_inline_block_exists():
    bad = ":root {\n  --a: 1;\n}\n.dark {\n  --a: 2;\n}\n"
    with pytest.raises(TokenExtractionError, match="theme"):
        extract_token_blocks(bad)


def test_raises_when_the_first_root_block_is_tailwind_only():
    bad = (
        "@theme inline {\n  --radius-card: 2.25rem;\n}\n"
        ":root {\n  @variant motion-reduce { & .x { color: red; } }\n}\n"
        ".dark { --a: 1; }\n"
    )
    with pytest.raises(TokenExtractionError, match="@variant"):
        extract_token_blocks(bad)


def test_raises_when_no_dark_block_exists():
    bad = "@theme inline {\n  --radius-card: 2.25rem;\n}\n:root { --a: 1; }\n"
    with pytest.raises(TokenExtractionError, match="dark"):
        extract_token_blocks(bad)


def test_runs_against_the_real_globals_css():
    # The real file is the contract; a refactor there must break this test,
    # not the shipped installer. This is the exact assertion set the plan's
    # own extractor CANNOT satisfy (see plan_verbatim_extractor.py RED
    # evidence in the task report) because --radius-card, --radius-field and
    # --ease-standard all live in @theme inline, which closes before the
    # first :root opens.
    out = extract_token_blocks(REPO_CSS.read_text(encoding="utf-8"))
    assert "--primary-container" in out
    assert "--on-primary-container" in out
    assert "--success-container" in out
    assert "--on-success-container" in out
    assert "--warning-container" in out
    assert "--on-warning-container" in out
    assert "--destructive-container" in out
    assert "--on-destructive-container" in out
    assert "--radius-card" in out
    assert "--radius-field" in out
    assert "--ease-standard" in out
    assert "--duration-standard" in out
    assert "@variant" not in out
    assert "@theme" not in out
    assert "@apply" not in out


def test_required_tokens_allow_list_all_present_in_real_css():
    # Every token ui/styles.css (Task 11) actually references — see
    # REQUIRED_TOKENS docstring — must survive extraction from the real
    # file. This is the "loud build failure" guard: if a future refactor
    # moves one of these between blocks, this fails instead of shipping a
    # page with a silently-dropped border-radius or transition.
    out = extract_token_blocks(REPO_CSS.read_text(encoding="utf-8"))
    for token in REQUIRED_TOKENS:
        assert f"{token}:" in out, f"{token} missing from extracted tokens"


def test_assert_required_tokens_raises_on_missing_token():
    from build_installer import assert_required_tokens

    css_missing_radius_card = SAMPLE.replace("--radius-card: 2.25rem;", "")
    out = extract_token_blocks(css_missing_radius_card)
    with pytest.raises(TokenExtractionError, match="radius-card"):
        assert_required_tokens(out, required=("--radius-card",))


# ---------------------------------------------------------------------------
# Correction 2: adb ships beside the exe, not via --add-binary
# ---------------------------------------------------------------------------


def test_pyinstaller_argv_has_no_add_binary_for_adb():
    here = Path("C:/fake/installer-gui")
    ui_dir = here / "src" / "qmanager_installer" / "ui"
    argv = build_pyinstaller_argv(here=here, ui_dir=ui_dir)
    assert "--add-binary" not in argv, (
        "PyInstaller 6 onedir puts --add-binary payloads under "
        "dist/<name>/_internal/, not beside the exe where the runtime "
        "adb resolver looks — adb must be copied beside the exe instead"
    )
    # --add-data for the ui/ dir is fine: it's read via sys._MEIPASS, which
    # DOES resolve to _internal correctly.
    assert "--add-data" in argv


def test_stage_runtime_assets_places_adb_beside_exe(tmp_path: Path):
    # Simulate a completed PyInstaller onedir build: dist/QManagerInstaller/
    # with just the launcher exe, as PyInstaller 6 actually produces it.
    bundle = tmp_path / "dist" / "QManagerInstaller"
    bundle.mkdir(parents=True)
    (bundle / "QManagerInstaller.exe").write_bytes(b"fake-exe")

    locales_dir = tmp_path / "locales"
    locales_dir.mkdir()
    (locales_dir / "en.json").write_text("{}", encoding="utf-8")

    payload_dir = tmp_path / "payload"
    payload_dir.mkdir()
    (payload_dir / "qmanager.tar.gz").write_bytes(b"fake-tarball")

    vendor_adb = tmp_path / "vendor" / "adb"
    vendor_adb.mkdir(parents=True)
    for name in ("adb.exe", "AdbWinApi.dll", "AdbWinUsbApi.dll"):
        (vendor_adb / name).write_bytes(b"fake-binary")

    stage_runtime_assets(
        bundle, locales_dir=locales_dir, payload_dir=payload_dir, vendor_adb=vendor_adb
    )

    # This is exactly where the runtime resolver
    # (Path(sys.executable).parent / "vendor" / "adb" / "adb.exe") looks.
    resolved_adb = bundle / "vendor" / "adb" / "adb.exe"
    assert resolved_adb.is_file()
    assert (bundle / "vendor" / "adb" / "AdbWinApi.dll").is_file()
    assert (bundle / "vendor" / "adb" / "AdbWinUsbApi.dll").is_file()
    # And NOT under _internal, which is where --add-binary would have put it.
    assert not (bundle / "_internal" / "vendor" / "adb" / "adb.exe").exists()
    assert (bundle / "locales" / "en.json").is_file()
    assert (bundle / "payload" / "qmanager.tar.gz").is_file()


def test_check_vendor_adb_raises_when_incomplete(tmp_path: Path):
    vendor_adb = tmp_path / "vendor" / "adb"
    vendor_adb.mkdir(parents=True)
    (vendor_adb / "adb.exe").write_bytes(b"fake")
    # AdbWinApi.dll and AdbWinUsbApi.dll missing.
    with pytest.raises(BuildError, match="AdbWinApi.dll"):
        check_vendor_adb(vendor_adb)


def test_check_vendor_adb_passes_when_complete(tmp_path: Path):
    vendor_adb = tmp_path / "vendor" / "adb"
    vendor_adb.mkdir(parents=True)
    for name in ("adb.exe", "AdbWinApi.dll", "AdbWinUsbApi.dll"):
        (vendor_adb / name).write_bytes(b"fake")
    check_vendor_adb(vendor_adb)  # must not raise


# ---------------------------------------------------------------------------
# Correction 3: stage_payload verifies the tarball against package.json
# ---------------------------------------------------------------------------


def _make_fake_repo(tmp_path: Path, pkg_version: str, tarball_version: str) -> Path:
    repo = tmp_path / "repo"
    (repo / "qmanager-build").mkdir(parents=True)
    (repo / "qmanager-build" / "sha256sum.txt").write_text("deadbeef  qmanager.tar.gz\n", encoding="utf-8")

    tarball_path = repo / "qmanager-build" / "qmanager.tar.gz"
    with tarfile.open(tarball_path, "w:gz") as tf:
        script = f'#!/bin/sh\nVERSION="{tarball_version}"\necho "$VERSION"\n'.encode("utf-8")
        import io

        info = tarfile.TarInfo(name="qmanager_install/install_rm520n.sh")
        info.size = len(script)
        tf.addfile(info, io.BytesIO(script))

    (repo / "package.json").write_text(
        f'{{\n  "name": "qmanager",\n  "version": "{pkg_version}"\n}}\n', encoding="utf-8"
    )
    return repo


def test_stage_payload_succeeds_when_versions_agree(tmp_path: Path):
    repo = _make_fake_repo(tmp_path, pkg_version="v0.2.0", tarball_version="v0.2.0")
    out = tmp_path / "payload"
    version = stage_payload(repo, out)
    assert version == "v0.2.0"
    assert (out / "VERSION").read_text(encoding="utf-8").strip() == "v0.2.0"
    assert (out / "qmanager.tar.gz").is_file()


def test_stage_payload_fails_when_tarball_version_disagrees_with_package_json(tmp_path: Path):
    # This is the exact live bug: qmanager-build/qmanager.tar.gz can predate
    # HEAD's build.sh/package.json. A version stamped purely from
    # package.json (the plan's approach) would silently ship a mismatched
    # payload; reading the version baked into the tarball itself catches it.
    repo = _make_fake_repo(tmp_path, pkg_version="v0.2.0", tarball_version="v0.1.9")
    out = tmp_path / "payload"
    with pytest.raises(BuildError, match="v0.1.9"):
        stage_payload(repo, out)


def test_stage_payload_fails_when_tarball_has_no_install_script(tmp_path: Path):
    repo = tmp_path / "repo"
    (repo / "qmanager-build").mkdir(parents=True)
    (repo / "qmanager-build" / "sha256sum.txt").write_text("x  y\n", encoding="utf-8")
    with tarfile.open(repo / "qmanager-build" / "qmanager.tar.gz", "w:gz") as tf:
        import io

        info = tarfile.TarInfo(name="qmanager_install/uninstall_rm520n.sh")
        info.size = 4
        tf.addfile(info, io.BytesIO(b"noop"))
    (repo / "package.json").write_text('{"version": "v0.2.0"}\n', encoding="utf-8")
    with pytest.raises(BuildError, match="install_rm520n.sh"):
        stage_payload(repo, tmp_path / "payload")


def test_stage_payload_fails_when_tarball_missing(tmp_path: Path):
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "package.json").write_text('{"version": "v0.2.0"}\n', encoding="utf-8")
    with pytest.raises(BuildError):
        stage_payload(repo, tmp_path / "payload")
