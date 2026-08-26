# QManager GUI Installer

Windows GUI that installs QManager onto a Quectel modem over ADB or SSH,
without any GitHub access. Design: `docs/superpowers/specs/2026-08-26-gui-installer-design.md`.

## One-time setup

1. `py -3.12 -m venv .venv && .venv\Scripts\pip install -e ".[dev]"`
2. **adb** — download Google platform-tools for Windows and copy exactly three
   files into `vendor/adb/`: `adb.exe`, `AdbWinApi.dll`, `AdbWinUsbApi.dll`.
   All three are required; adb fails at runtime without the DLLs.
3. **Fonts** — place `RethinkSans-Variable.woff2` and `JetBrainsMono-Regular.woff2`
   in `src/qmanager_installer/ui/fonts/`. Google Fonts is blocked in China, so
   these must be bundled locally; the UI falls back to system sans/mono if absent.

Both directories are gitignored — they are binary redistributables, not source.

## Build

    bun run package          # in the repo root, produces qmanager-build/qmanager.tar.gz
    .venv\Scripts\python build_installer.py

Output: `dist/QManagerInstaller/` — ship the whole folder, not just the .exe.

## Test

    .venv\Scripts\pytest
