#!/usr/bin/env bash
# Downloads every static third-party pin in install_rm520n.sh and compares its
# SHA-256 with the value in source. Run before cutting a release.
set -u
cd "$(dirname "$0")/.." || exit 2
SRC=scripts/install_rm520n.sh

pin() { sed -n "s/.*$1=\"\([0-9a-f]\{64\}\)\".*/\1/p" "$SRC" | head -n1; }
src_val() { sed -n "s/.*$1=\"\([^\"]*\)\".*/\1/p" "$SRC" | head -n1; }

entware="https://bin.entware.net/$(src_val ENTWARE_ARCH)/installer"
checks="
ENTWARE_OPKG_SHA256 $entware/opkg
ENTWARE_CONF_SHA256 $entware/opkg.conf
speedtest_sha256 $(src_val speedtest_url)
"

tmp=$(mktemp -d) || exit 2
trap 'rm -rf "$tmp"' EXIT
fail=0
while read -r var url; do
    [ -n "$var" ] || continue
    want=$(pin "$var")
    if [ -z "$want" ] || ! curl -fsSL --max-time 120 -o "$tmp/f" "$url"; then
        echo "FAIL $var: no pin in source or download failed ($url)"; fail=1; continue
    fi
    got=$(sha256sum "$tmp/f" | awk '{ print $1 }')
    if [ "$got" = "$want" ]; then echo "OK   $var"
    else echo "FAIL $var: source $want, served $got ($url)"; fail=1; fi
done <<EOF
$checks
EOF
exit "$fail"
