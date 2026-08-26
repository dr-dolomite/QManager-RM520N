"""Build the Windows GUI installer.

Three jobs, in order:
  1. Extract design tokens from ../app/globals.css so the installer cannot
     drift from DESIGN.md canon.
  2. Stage the payload from ../qmanager-build/ — the artifact build.sh
     already produced, never a re-roll — and verify it is not stale.
  3. Drive PyInstaller in onedir mode (locale files and adb must stay
     editable/replaceable on disk beside the exe, not buried under
     PyInstaller 6's dist/<name>/_internal/).

Run `bun run package` in the repo root first.

Corrections to the original Task 10 plan (adversarial review, applied
before implementation — see tests/test_build_tokens.py docstring):

  1. Token extraction is THREE blocks, not two. app/globals.css puts the
     shape scale (--radius-*) and --ease-standard inside `@theme inline
     { ... }` (lines 84-232), which CLOSES before the first `:root` block
     OPENS (line 235). Extracting only the first :root + first .dark — as
     the plan did — silently drops --radius-card, --radius-field and
     --ease-standard: the shipped installer gets square cards and a
     transition shorthand with a missing ease term, which CSS drops
     entirely (no transitions at all). An explicit allow-list assertion
     (REQUIRED_TOKENS) pins every token the UI actually references so a
     future reshuffle of globals.css fails the build loudly.

  2. PyInstaller 6 onedir mode places everything from --add-binary /
     --add-data under dist/<name>/_internal/, leaving only the launcher
     exe beside it. The runtime adb resolver
     (Path(sys.executable).parent / "vendor" / "adb" / "adb.exe") looks
     BESIDE the exe. --add-binary for adb would silently ship a binary the
     app can never find. adb is therefore staged with shutil.copytree(),
     same as locales/ and payload/ already are.

  3. stage_payload() does not trust package.json's version blindly. It
     reads the VERSION= line baked into the tarball's own
     qmanager_install/install_rm520n.sh (the value the device will
     actually report after install) and fails the build if it disagrees
     with package.json — catching a stale qmanager-build/ artifact instead
     of silently shipping a payload the GUI mislabels.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
UI_DIR = HERE / "src" / "qmanager_installer" / "ui"
ASSETS_DIR = HERE / "assets"
APP_ICON = ASSETS_DIR / "app.ico"
PAYLOAD_DIR = HERE / "payload"
VENDOR_ADB = HERE / "vendor" / "adb"
LOCALES_DIR = HERE / "locales"

REQUIRED_ADB_FILES = ("adb.exe", "AdbWinApi.dll", "AdbWinUsbApi.dll")
FORBIDDEN_AT_RULES = ("@variant", "@apply", "@theme")

# Every custom property ui/styles.css (Task 11) actually references. Task 11
# has not landed yet as of this task, so this list is transcribed from the
# plan's Task 11 CSS listing (docs/superpowers/plans/2026-08-26-gui-installer.md
# lines ~3140-3201: .card, .btn, .btn-primary, .badge[data-state=...], .log).
# When ui/styles.css exists, prefer scanning it directly for `var(--...)`
# references over hand-maintaining this list — see assert_required_tokens().
REQUIRED_TOKENS = (
    "--background",
    "--foreground",
    "--card",
    "--card-foreground",
    "--radius-card",
    "--secondary",
    "--secondary-foreground",
    "--duration-standard",
    "--ease-standard",
    "--primary",
    "--primary-foreground",
    "--success-container",
    "--on-success-container",
    "--warning-container",
    "--on-warning-container",
    "--destructive-container",
    "--on-destructive-container",
    "--primary-container",
    "--on-primary-container",
    "--muted",
    "--radius-field",
)


class TokenExtractionError(RuntimeError):
    """globals.css did not yield a usable set of token blocks."""


class BuildError(RuntimeError):
    """A build precondition is not satisfied."""


def _first_block(css: str, selector: str) -> str | None:
    """Return the first TOP-LEVEL `<selector> { ... }` block, braces balanced."""
    pattern = re.compile(rf"(?m)^{re.escape(selector)}\s*\{{")
    match = pattern.search(css)
    if not match:
        return None
    start = match.start()
    depth = 0
    for i in range(match.end() - 1, len(css)):
        if css[i] == "{":
            depth += 1
        elif css[i] == "}":
            depth -= 1
            if depth == 0:
                return css[start : i + 1]
    return None


_THEME_HEADER_RE = re.compile(r"^@theme\s+inline\s*\{")


def extract_token_blocks(css: str) -> str:
    """First `@theme inline`, first `:root`, first `.dark` — guarded.

    globals.css holds the shape scale (--radius-*) and --ease-standard
    inside `@theme inline { ... }`, which closes BEFORE the first `:root`
    opens. Taking only :root + .dark (the original plan) silently drops
    them. This extracts all three top-level blocks and rewrites the
    `@theme inline {` header to `:root {` — its body is plain custom
    properties, so the rewrite is safe and the result is valid, plain CSS a
    browser can parse.

    globals.css also holds FOUR LATER top-level :root blocks carrying
    `@variant` at-rules a plain browser cannot parse. Only the FIRST :root
    is the token block; the guard below makes a future reordering (or a
    token migrating out of @theme inline without this extractor being
    updated) a loud build failure rather than a silently broken installer.
    """
    theme = _first_block(css, "@theme inline")
    if theme is None:
        raise TokenExtractionError(
            "no top-level @theme inline block found in globals.css — the "
            "shape scale (--radius-*) and --ease-standard live there"
        )
    theme = _THEME_HEADER_RE.sub(":root {", theme, count=1)

    root = _first_block(css, ":root")
    if root is None:
        raise TokenExtractionError("no top-level :root block found in globals.css")
    dark = _first_block(css, ".dark")
    if dark is None:
        raise TokenExtractionError("no top-level .dark block found in globals.css")

    out = (
        "/* GENERATED from app/globals.css — do not edit. */\n\n"
        f"{theme}\n\n{root}\n\n{dark}\n"
    )
    for rule in FORBIDDEN_AT_RULES:
        if rule in out:
            raise TokenExtractionError(
                f"{rule} reached the extracted tokens — globals.css was reordered; "
                "check which @theme inline / :root block comes first"
            )
    return out


def assert_required_tokens(tokens_css: str, required: tuple[str, ...] = REQUIRED_TOKENS) -> None:
    """Fail loudly if a token the UI depends on didn't survive extraction.

    Without this, a token moving between blocks in a future globals.css
    refactor ships a UI with a missing border-radius or a dropped
    transition and nobody finds out until it's on a user's screen.
    """
    missing = [name for name in required if not re.search(rf"(?m)^\s*{re.escape(name)}\s*:", tokens_css)]
    if missing:
        raise TokenExtractionError(
            "tokens.css is missing properties the UI depends on: "
            f"{', '.join(missing)} — check which globals.css block they now live in"
        )


def _read_package_version(repo_root: Path) -> str:
    package_json = (repo_root / "package.json").read_text(encoding="utf-8")
    match = re.search(r'"version"\s*:\s*"([^"]+)"', package_json)
    if not match:
        raise BuildError("Could not read version from package.json")
    version = match.group(1)
    if not version.startswith("v"):
        version = f"v{version}"
    return version


def _read_tarball_version(tarball: Path) -> str:
    """Read VERSION= out of the tarball's own install_rm520n.sh.

    This is the value the device will actually report after install — the
    same string build.sh stamps into the script before archiving it. Reading
    it back is cheap (no shelling out, no full extraction) and exact.
    """
    try:
        with tarfile.open(tarball, "r:gz") as tf:
            member = tf.extractfile("qmanager_install/install_rm520n.sh")
            if member is None:
                raise BuildError(
                    f"{tarball} has no qmanager_install/install_rm520n.sh — "
                    "cannot verify the payload version"
                )
            data = member.read().decode("utf-8", errors="replace")
    except KeyError as exc:
        raise BuildError(
            f"{tarball} has no qmanager_install/install_rm520n.sh — "
            "cannot verify the payload version"
        ) from exc
    except tarfile.TarError as exc:
        raise BuildError(f"{tarball} is not a readable tar.gz: {exc}") from exc

    for line in data.splitlines():
        line = line.strip()
        if line.startswith("VERSION="):
            value = line.split("=", 1)[1].strip().strip('"').strip("'")
            return value if value.startswith("v") else f"v{value}"
    raise BuildError(
        f"{tarball}'s qmanager_install/install_rm520n.sh has no VERSION= line"
    )


def stage_payload(repo_root: Path, out: Path) -> str:
    """Copy the pre-built payload into place, stamped with a VERIFIED version.

    The build fails if qmanager-build/ is stale or absent rather than
    shipping a mismatched payload: the version is read from the tarball's
    own install script (the truth the device will report) and checked
    against package.json, not typed by hand or trusted from package.json
    alone.
    """
    source = repo_root / "qmanager-build"
    tarball = source / "qmanager.tar.gz"
    checksum = source / "sha256sum.txt"
    if not tarball.is_file() or not checksum.is_file():
        raise BuildError(
            f"Missing {tarball} or {checksum} — run `bun run package` in the repo root first."
        )

    package_version = _read_package_version(repo_root)
    tarball_version = _read_tarball_version(tarball)
    if package_version != tarball_version:
        raise BuildError(
            f"qmanager-build/qmanager.tar.gz is stale: it was built with "
            f"VERSION={tarball_version!r} but package.json now says "
            f"{package_version!r}. Run `bun run package` in the repo root "
            "to rebuild it before packaging the installer."
        )

    out.mkdir(parents=True, exist_ok=True)
    shutil.copy2(tarball, out / "qmanager.tar.gz")
    shutil.copy2(checksum, out / "sha256sum.txt")
    (out / "VERSION").write_text(f"{package_version}\n", encoding="utf-8")
    return package_version


def check_vendor_adb(vendor_adb: Path = VENDOR_ADB) -> None:
    missing = [f for f in REQUIRED_ADB_FILES if not (vendor_adb / f).is_file()]
    if missing:
        raise BuildError(
            f"{vendor_adb} is missing {missing}. All three files are required — "
            "adb fails at runtime without the DLLs. See README.md."
        )


def build_pyinstaller_argv(
    here: Path = HERE,
    ui_dir: Path = UI_DIR,
    assets_dir: Path = ASSETS_DIR,
    dist_dir: Path | None = None,
    build_dir: Path | None = None,
) -> list[str]:
    """The PyInstaller invocation. Deliberately has NO --add-binary for adb.

    PyInstaller 6 onedir mode puts --add-binary / --add-data payloads under
    dist/<name>/_internal/. --add-data for ui/ and assets/ is still correct
    here: both are read at runtime via sys._MEIPASS, which resolves into
    _internal correctly (see app.app_icon()). adb is NOT read via
    sys._MEIPASS (the runtime resolver looks beside the exe, matching
    locales/ and payload/), so it must never be passed to --add-binary —
    see stage_runtime_assets().

    --icon bakes the QManager mark into the .exe itself (Explorer icon,
    taskbar pin, Alt-Tab); app.app_icon() separately hands the same file to
    webview.start(icon=...) for the live window/taskbar icon, since
    PyInstaller's --icon only affects the executable's file-level icon
    resource, not what a WebView2-backed window shows at runtime.
    """
    dist_dir = dist_dir if dist_dir is not None else here / "dist"
    build_dir = build_dir if build_dir is not None else here / "build"
    argv = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm", "--clean", "--windowed",
        "--name", "QManagerInstaller",
        "--distpath", str(dist_dir),
        "--workpath", str(build_dir),
        "--specpath", str(build_dir),
        "--add-data", f"{ui_dir};qmanager_installer/ui",
        "--add-data", f"{assets_dir};qmanager_installer/assets",
    ]
    if APP_ICON.is_file():
        argv += ["--icon", str(APP_ICON)]
    argv.append(str(here / "src" / "qmanager_installer" / "__main__.py"))
    return argv


def stage_runtime_assets(
    bundle: Path,
    locales_dir: Path = LOCALES_DIR,
    payload_dir: Path = PAYLOAD_DIR,
    vendor_adb: Path = VENDOR_ADB,
) -> None:
    """Copy locales/, payload/ and vendor/adb/ BESIDE the exe.

    All three are editable/replaceable on disk after the build, and all
    three must land at exactly the paths their runtime resolvers compute
    from Path(sys.executable).parent — never under _internal/.
    """
    shutil.copytree(locales_dir, bundle / "locales", dirs_exist_ok=True)
    shutil.copytree(payload_dir, bundle / "payload", dirs_exist_ok=True)
    shutil.copytree(vendor_adb, bundle / "vendor" / "adb", dirs_exist_ok=True)


def main(
    repo_root: Path = REPO_ROOT,
    ui_dir: Path = UI_DIR,
    vendor_adb: Path = VENDOR_ADB,
    payload_dir: Path = PAYLOAD_DIR,
    locales_dir: Path = LOCALES_DIR,
    here: Path = HERE,
    run_pyinstaller: bool = True,
) -> int:
    try:
        check_vendor_adb(vendor_adb)
        version = stage_payload(repo_root, payload_dir)
        tokens = extract_token_blocks((repo_root / "app" / "globals.css").read_text(encoding="utf-8"))
        assert_required_tokens(tokens)
        ui_dir.mkdir(parents=True, exist_ok=True)
        (ui_dir / "tokens.css").write_text(tokens, encoding="utf-8", newline="\n")
    except (BuildError, TokenExtractionError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print(f"Staged payload {version}; extracted {len(tokens.splitlines())} lines of tokens")

    if not run_pyinstaller:
        return 0

    argv = build_pyinstaller_argv(here=here, ui_dir=ui_dir)
    result = subprocess.run(argv, cwd=here)
    if result.returncode != 0:
        return result.returncode

    bundle = here / "dist" / "QManagerInstaller"
    stage_runtime_assets(bundle, locales_dir=locales_dir, payload_dir=payload_dir, vendor_adb=vendor_adb)
    print(f"Built {bundle}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
