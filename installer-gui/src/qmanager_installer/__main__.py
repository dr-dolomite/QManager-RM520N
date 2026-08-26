# Absolute, not relative. PyInstaller runs this file as the entry SCRIPT, so
# it executes as `__main__` with no parent package and `from .app import run`
# raises ImportError at launch — in the frozen build only. See
# tests/test_entrypoint.py.
from qmanager_installer.app import run

if __name__ == "__main__":
    raise SystemExit(run())
