#!/usr/bin/env python3
"""Embed screenshots into a redesign-review artifact and lint it before publishing.

Usage:
    python finalize.py <src.html> <out.html> --shot __SHOT__=<path.png> [--shot __SHOT_PHONE__=<path.png>]
    python finalize.py <file.html> --check [--template]

Each --shot replaces every occurrence of its placeholder with a base64 data URI (PNG, JPEG or WebP,
typed from the file's magic bytes). Afterwards the output is linted for the artifact's hard rules.
Exit code 1 means the page is not ready to publish. Fix the source and run it again. Never hand-edit
the output: it is regenerated from the source on every run.

--check lints without writing anything (use it on assets/exemplar-*.html). --template also accepts
unfilled placeholders, which is how assets/template.html itself is checked after a token update.
"""
import argparse
import base64
import re
import sys
from pathlib import Path

MAX_BYTES = 16 * 1024 * 1024  # Artifact page limit, data URIs included
ALLOWED_HOSTS = ("fonts.googleapis.com", "fonts.gstatic.com", "cdnjs.cloudflare.com", "cdn.jsdelivr.net/npm/")
BANNED_WORDS = re.compile(r"\blorem\b|\bipsum\b|\bTODO\b|\bTBD\b|\bFIXME\b", re.I)
# The Two-Voice Rule: Rethink Sans + JetBrains Mono, plus the icon font. Any other family is a third voice.
ALLOWED_FAMILIES = {"Rethink Sans", "JetBrains Mono", "Material Symbols Rounded"}
SECTIONS = ("Where it reads rough today", "Proposed layout", "Before and after", "What changes", "Kept as is", "Your call before build")


def mime_for(data: bytes) -> str:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    raise SystemExit("unsupported image type (need PNG, JPEG or WebP)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out", nargs="?")
    ap.add_argument("--shot", action="append", default=[], help="PLACEHOLDER=path")
    ap.add_argument("--check", action="store_true", help="lint only, write nothing")
    ap.add_argument("--template", action="store_true", help="with --check: placeholders are expected")
    args = ap.parse_args()
    if not args.check and not args.out:
        raise SystemExit("an output path is required unless --check is given")

    html = Path(args.src).read_text(encoding="utf-8")
    for spec in args.shot:
        if "=" not in spec:
            raise SystemExit(f"--shot needs PLACEHOLDER=path, got {spec!r}")
        key, path = spec.split("=", 1)
        data = Path(path).read_bytes()
        if key not in html:
            print(f"WARN  placeholder {key} not found in source")
        html = html.replace(key, f"data:{mime_for(data)};base64,{base64.b64encode(data).decode('ascii')}")
        print(f"ok    embedded {path} as {key} ({len(data) // 1024} KB)")

    problems, warnings = [], []
    left = sorted(set(re.findall(r"__[A-Z][A-Z0-9_]*__", html)))
    if left and args.template:
        print(f"ok    template placeholders: {len(left)}")
    elif left:
        problems.append("unfilled placeholders: " + ", ".join(left))
    if not re.search(r"<title>[^<]{3,}</title>", html):
        problems.append("missing <title>")
    if not re.search(r"@media\s*\(prefers-color-scheme:\s*dark\)\s*{\s*:root:not\(\[data-theme=\"light\"\]\)", html):
        problems.append('dark tokens must sit under @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) … }')
    if ':root[data-theme="dark"]' not in html:
        problems.append(':root[data-theme="dark"] block missing')
    if 'name="viewport"' not in html:
        problems.append('missing <meta name="viewport" content="width=device-width, initial-scale=1"> (phones lay out at 980px without it)')
    if not re.search(r"body\s*{[^}]*background", html):
        problems.append("body needs an explicit background")
    for m in re.finditer(r"""(?:src|href)\s*=\s*["'](https?://[^"']+)""", html):
        url = m.group(1)
        if not any(h in url for h in ALLOWED_HOSTS):
            problems.append(f"external resource from a disallowed host: {url}")
    if "container:" not in html and "container-type" not in html:
        problems.append("no container query context: the Wide / Phone toggle cannot recompose the mock")
    if 'data-w="phone"' not in html:
        problems.append("no Phone width toggle")
    if "data-state" not in html and "data-demo" not in html:
        problems.append("no state switcher")
    if "prefers-reduced-motion" not in html:
        problems.append("no prefers-reduced-motion handling")
    for fam in re.findall(r"family=([^:&\"']+)", html):
        name = fam.replace("+", " ")
        if name not in ALLOWED_FAMILIES:
            problems.append(f"font family {name!r} is a third voice (Two-Voice Rule: Rethink Sans + JetBrains Mono only)")
    for heading in SECTIONS:
        if heading not in html:
            problems.append(f"missing section: {heading}")
    pins = len(re.findall(r'class="pin"', html))
    finds = len(re.findall(r'<li><span class="n">', html))
    if pins != finds:
        problems.append(f"{pins} pins but {finds} findings; they must match one to one")
    if not 3 <= finds <= 8:
        warnings.append(f"{finds} findings; aim for 4-7")
    text_only = re.sub(r"<script.*?</script>|<style.*?</style>|data:[^\"']+", " ", html, flags=re.S)
    if BANNED_WORDS.search(text_only):
        problems.append("filler text found (lorem/ipsum/TODO/TBD/FIXME)")
    if "tabular-nums" not in html:
        warnings.append("no tabular-nums anywhere; every figure takes it (Tabular-Number Rule)")
    if re.search(r"[—]", text_only):
        warnings.append("em dash in visible copy; the user asked for none")

    size = len(html.encode("utf-8"))
    if size > MAX_BYTES:
        problems.append(f"page is {size / 1048576:.1f} MB, over the 16 MB limit (downscale the screenshot)")

    if args.check:
        print(f"ok    checked {args.src} ({size // 1024} KB), nothing written")
    else:
        Path(args.out).write_text(html, encoding="utf-8")
        print(f"ok    wrote {args.out} ({size // 1024} KB)")
    for w in warnings:
        print("WARN ", w)
    for p in problems:
        print("FAIL ", p)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
