"""The frozen entry point must not use relative imports.

build_installer.py hands `src/qmanager_installer/__main__.py` to PyInstaller as
the entry SCRIPT. PyInstaller runs an entry script as `__main__` with no parent
package, so a relative import there raises

    ImportError: attempted relative import with no known parent package

...at launch. It resolves fine under `python -m qmanager_installer`, which is
why nothing in the suite caught it: the defect exists only in the shipped
artifact, the one thing a user in China actually runs.

Verified against the real build before this test was written.
"""

import ast
import re
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src" / "qmanager_installer"


def _relative_imports(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and (node.level or 0) > 0:
            found.append("%s%s" % ("." * node.level, node.module or ""))
    return found


def test_frozen_entry_point_has_no_relative_imports():
    entry = SRC / "__main__.py"
    assert entry.is_file()
    assert _relative_imports(entry) == [], (
        "__main__.py is the PyInstaller entry script and is executed with no "
        "parent package; relative imports there fail only in the frozen build."
    )


def test_build_still_points_at_that_entry_script():
    # If the entry script ever moves, the guarantee above must move with it.
    build = (SRC.parents[1] / "build_installer.py").read_text(encoding="utf-8")
    assert re.search(r'"__main__\.py"', build), (
        "build_installer.py no longer names __main__.py as the entry script; "
        "re-point test_frozen_entry_point_has_no_relative_imports at the new one."
    )
