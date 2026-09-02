#!/bin/bash
# =============================================================================
# poller-defork-forkcount.sh — static fork-site ceiling for the de-fork pass
# =============================================================================
# Run from repo root:  bash scripts/test/poller-defork-forkcount.sh
#
# Workstation-runnable (Git Bash on Windows included). No device, no jq, no
# network. It reads two source files and counts, per function, how many places
# will cause the shell to create a process.
#
# WHY THIS EXISTS
# ---------------
# docs/reference/poller-cpu-profile.md measured qmanager_poller at 85% of all
# busy CPU on the RM520N-GL, and established that almost none of that is
# computation: /bin/true costs 2.40 ms of CPU on the RM520N-GL and 4.95 ms on
# the RG501Q-EU, and the poller forks roughly 220 times per cycle. The cost is
# process creation. Therefore the specification for the de-fork pass is a
# COUNT, not a runtime measurement — and a count is something a static harness
# can pin exactly.
#
# This harness is the RED ANCHOR for the change. It fails against the current
# tree on purpose. Its companion, poller-defork-equivalence.sh, is the
# regression net that proves the rewrite did not change behaviour.
#
# WHAT COUNTS AS AN "EXTERNAL EXEC SITE"
# --------------------------------------
# Three kinds of site are counted, and they are summed:
#
#   1. Command substitution — an active "$(" (arithmetic "$((" excluded) or an
#      active backtick. Each one forks a subshell.
#   2. Pipeline segment — an active "|" that is not "||". Each pipe adds one
#      more process to the pipeline.
#   3. Applet call — a command whose FIRST word resolves to one of the external
#      binaries the poller reaches for:
#         cat grep awk sed cut tr head tail wc find df jq date nproc stat
#      Each one is a fork plus an execve.
#
# The union is deliberate. A single one-awk-pass rewrite of the shape
#   record=$(printf ... | awk '...')
# scores exactly 3: one command substitution, one pipe, one applet. That is the
# approved target for parse_serving_cell, and it is why the ceiling is 3.
#
# "ACTIVE" vs "LITERAL", and the /proc/stat trap
# ----------------------------------------------
# Counting by substring search is wrong in two ways that bite immediately:
#
#   * A path such as /proc/stat contains the applet name "stat", and a naive
#     word match reports a stat(1) call that is not there. This harness anchors
#     on COMMAND POSITION — only the first word of a command is tested against
#     the applet list — so an argument or a redirect target can never match.
#
#   * A pipe character inside a quoted string is not a pipeline. The de-forked
#     parse_serving_cell is specified to emit a pipe-delimited record and walk
#     it with pure-bash suffix trimming, so its source will be full of pipe
#     characters that must NOT be counted. This harness therefore runs a real
#     quoting scanner with a context stack: single quotes, double quotes,
#     dollar-paren substitution, dollar-brace expansion and dollar-double-paren
#     arithmetic all nest correctly, and only characters that are shell syntax
#     at their nesting level ("active" characters) are counted.
#
# Comments are stripped before any of this, using the same scanner: a "#" is a
# comment introducer only when it is active AND starts a word.
#
# KNOWN LIMITATION, stated plainly: this is a lexical scanner, not bash's
# parser. Here-documents are not modelled (none of the three target functions
# uses one). If a rewrite introduces one, extend the scanner rather than
# working around it.
# =============================================================================
set -eu

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
POLLER="$REPO_ROOT/scripts/usr/bin/qmanager_poller"
PARSE_AT="$REPO_ROOT/scripts/usr/lib/qmanager/parse_at.sh"

APPLETS="cat grep awk sed cut tr head tail wc find df jq date nproc stat"

fail=0
pass_count=0
fail_count=0

ok()   { printf '  PASS  %s\n' "$1"; pass_count=$((pass_count + 1)); }
bad()  { printf '  FAIL  %s\n' "$1"; fail_count=$((fail_count + 1)); fail=1; }
section() { printf '\n== %s ==\n' "$1"; }

# ---------------------------------------------------------------------------
# extract_function <file> <name>
# Emits the body of a top-level shell function: everything between the line
# "name() {" and the first following line that is exactly "}".
# ---------------------------------------------------------------------------
extract_function() {
    awk -v fn="$2" '
        !inside && $0 ~ "^" fn "\\(\\) \\{[[:space:]]*$" { inside = 1; next }
        inside && /^\}[[:space:]]*$/ { exit }
        inside { print }
    ' "$1"
}

# ---------------------------------------------------------------------------
# count_sites  (reads the function body on stdin, prints one number)
#
# One awk pass. Maintains a context stack so that quoting nests correctly:
#   ctx 0 = normal shell
#   ctx 1 = inside single quotes   (everything literal until the closing quote)
#   ctx 2 = inside double quotes   (literal, except dollar-paren / dollar-brace
#                                   / backtick, which open a nested context)
#   ctx 3 = inside dollar-paren    (shell again; a ")" at depth 0 closes it)
#   ctx 4 = inside dollar-brace or dollar-double-paren (skipped wholesale)
#   ctx 5 = inside backticks       (shell again)
#
# Output of the scan is a normalised stream in which every ACTIVE command
# separator has become a newline and every LITERAL character has become "_".
# Applet detection then reads the first word of each resulting segment.
# ---------------------------------------------------------------------------
count_sites() {
    awk -v applets="$APPLETS" '
    BEGIN {
        n = split(applets, a, " ")
        for (i = 1; i <= n; i++) is_applet[a[i]] = 1
        depth = 0; ctx[0] = 0; pdepth[0] = 0
        subs = 0; pipes = 0
        out = ""
    }
    function push(c) { depth++; ctx[depth] = c; pdepth[depth] = 0 }
    function pop()   { if (depth > 0) depth-- }
    function emit(s) { out = out s }
    {
        line = $0
        L = length(line)
        i = 1
        while (i <= L) {
            c  = substr(line, i, 1)
            c2 = (i < L) ? substr(line, i + 1, 1) : ""
            c3 = (i + 1 < L) ? substr(line, i + 2, 1) : ""
            cur = ctx[depth]

            # --- single quotes: everything literal until the closing quote ---
            if (cur == 1) {
                if (c == "'"'"'") { pop() } else { emit("_") }
                i++; continue
            }

            # --- brace expansion / arithmetic: skipped wholesale -------------
            if (cur == 4) {
                if (c == "{" || c == "(") pdepth[depth]++
                else if (c == "}" || c == ")") {
                    if (pdepth[depth] == 0) pop(); else pdepth[depth]--
                }
                emit("_"); i++; continue
            }

            # --- backslash escape (not inside single quotes) -----------------
            if (c == "\\") { emit("__"); i += 2; continue }

            # --- constructs that open a nested context ----------------------
            if (c == "$" && c2 == "(" && c3 == "(") {
                push(4); pdepth[depth] = 1   # one inner "(" still to close
                emit("___"); i += 3; continue
            }
            if (c == "$" && c2 == "(") {
                subs++
                push(3)
                emit("\n"); i += 2; continue
            }
            if (c == "$" && c2 == "{") {
                push(4); emit("__"); i += 2; continue
            }
            if (c == "`") {
                if (cur == 5) { pop(); emit("\n") } else { subs++; push(5); emit("\n") }
                i++; continue
            }
            if (c == "\"") {
                if (cur == 2) pop(); else push(2)
                emit("_"); i++; continue
            }
            if (c == "'"'"'" && cur != 2) { push(1); emit("_"); i++; continue }

            # --- inside double quotes: the rest is literal ------------------
            if (cur == 2) { emit("_"); i++; continue }

            # --- comment introducer: active "#" that starts a word ----------
            if (c == "#") {
                prev = (i > 1) ? substr(line, i - 1, 1) : " "
                if (prev == " " || prev == "\t" || i == 1 ||
                    prev == ";" || prev == "|" || prev == "&") break
            }

            # --- closing paren of a dollar-paren substitution ---------------
            if (c == ")" && cur == 3) {
                if (pdepth[depth] == 0) { pop(); emit("\n"); i++; continue }
                pdepth[depth]--; emit("\n"); i++; continue
            }
            if (c == "(" && cur == 3) { pdepth[depth]++; emit("\n"); i++; continue }

            # --- separators -------------------------------------------------
            if (c == "|" && c2 == "|") { emit("\n"); i += 2; continue }
            if (c == "&" && c2 == "&") { emit("\n"); i += 2; continue }
            if (c == "|")  { pipes++; emit("\n"); i++; continue }
            if (c == ";" || c == "&" || c == "(" || c == ")" ||
                c == "{" || c == "}") { emit("\n"); i++; continue }

            emit(c); i++
        }
        emit("\n")
    }
    END {
        # --- applet calls: first word of each normalised segment ------------
        applet_hits = 0
        m = split(out, seg, "\n")
        for (i = 1; i <= m; i++) {
            s = seg[i]
            gsub(/^[ \t]+/, "", s); gsub(/[ \t]+$/, "", s)
            if (s == "") continue
            # strip shell keywords and leading negation that precede a command
            while (s ~ /^(if|then|else|elif|while|until|do|done|case|esac|!|time|in)[ \t]/) {
                sub(/^[^ \t]+[ \t]+/, "", s)
            }
            # strip leading VAR=value assignment prefixes
            while (s ~ /^[A-Za-z_][A-Za-z_0-9]*=[^ \t]*[ \t]+/) {
                sub(/^[^ \t]+[ \t]+/, "", s)
            }
            # a segment that begins with a redirection has no command in it
            if (s ~ /^[<>]/) continue
            word = s
            sub(/[ \t].*$/, "", word)
            if (word == "") continue
            # accept an absolute path: compare on the basename
            sub(/^.*\//, "", word)
            if (word in is_applet) applet_hits++
        }
        printf "%d %d %d %d\n", subs, pipes, applet_hits, subs + pipes + applet_hits
    }'
}

# ---------------------------------------------------------------------------
# assert_ceiling <label> <file> <function> <ceiling>
# ---------------------------------------------------------------------------
assert_ceiling() {
    local label="$1" file="$2" fn="$3" ceiling="$4"
    local body counts subs pipes applets total

    body=$(extract_function "$file" "$fn")
    if [ -z "$body" ]; then
        bad "$label: could not extract $fn from $file"
        return
    fi

    counts=$(printf '%s\n' "$body" | count_sites)
    subs=$(printf '%s' "$counts" | cut -d' ' -f1)
    pipes=$(printf '%s' "$counts" | cut -d' ' -f2)
    applets=$(printf '%s' "$counts" | cut -d' ' -f3)
    total=$(printf '%s' "$counts" | cut -d' ' -f4)

    printf '  ---   %s: cmd-subs=%s pipes=%s applets=%s total=%s (ceiling %s)\n' \
        "$fn" "$subs" "$pipes" "$applets" "$total" "$ceiling"

    if [ "$total" -le "$ceiling" ]; then
        ok "$label: $fn has $total external exec sites, at or below the ceiling of $ceiling"
    else
        bad "$label: $fn has $total external exec sites, ceiling is $ceiling (over by $((total - ceiling)))"
    fi
}

# ---------------------------------------------------------------------------
section "harness self-check — the scanner must not miscount"

self_check() {
    local desc="$1" expect="$2" src="$3" got
    got=$(printf '%s\n' "$src" | count_sites | cut -d' ' -f4)
    if [ "$got" = "$expect" ]; then
        ok "scanner: $desc (total $got)"
    else
        bad "scanner: $desc — expected $expect, got $got  [src: $src]"
    fi
}

# A path containing an applet name as its last segment must not be counted.
self_check "a proc path is not a stat(1) call" 0 'read -r a b c < /proc/stat'
self_check "a redirect target is never a command" 0 'read -r x < /proc/uptime'
# Pure builtins are free.
self_check "pure builtin arithmetic and expansion are free" 0 'y=${x%%.*}; z=$(( y + 1 ))'
# The approved target shape for parse_serving_cell scores exactly 3.
self_check "one-awk-pass shape scores 3" 3 'rec=$(printf "%s\n" "$raw" | awk "{print}")'
# Pipe characters inside quotes and inside parameter expansion are not pipes.
self_check "a quoted pipe delimiter is not a pipeline" 0 'a="x|y"; b=${a%%|*}; c=${a##*|}'
self_check "a single-quoted pipe is not a pipeline" 0 "sep='|'"
# Comments are stripped, so prose naming an applet costs nothing.
self_check "a comment mentioning awk and grep costs nothing" 0 '# uses awk and grep and cut'
# The idiom the profile doc calls out as WRONG: two substitutions, one pipe,
# two applets. echo and printf are bash builtins and are correctly free.
self_check "the wrong proc-stat idiom scores 5" 5 'l=$(head -1 /proc/stat); v=$(echo "$l" | awk "{print \$5}")'
# Nested substitution: the inner one must be seen through the outer one.
self_check "nested substitution is counted at both levels" 6 'tac=$(_hex_to_dec "$(printf "%s" "$csv" | cut -d, -f11 | tr -d "\r")")'

# ---------------------------------------------------------------------------
section "fork-site ceilings"

printf '  ---   applet set: %s\n' "$APPLETS"
printf '\n'

# Target 1 — parse_serving_cell: one BusyBox-awk pass emitting a single
# pipe-delimited record, then a pure-bash suffix-trim walk over it.
assert_ceiling "target 1" "$PARSE_AT" "parse_serving_cell" 3

# Target 3 — update_system_health: sysfs reads become read builtins, the
# coredump find becomes a glob loop, the df output is split with `set --`
# instead of four awk calls, core_count is counted with a read loop instead
# of nproc/grep, and the two crash-log jq calls collapse to one that is
# skipped entirely while the log is an empty array.
#
# The ceiling is 4, not 3, and the number is derived rather than chosen. Two
# external calls survive the rewrite by design: `df` is the only source of
# the /usrdata figures, and `jq` is the schema boundary on the crash log —
# hand-parsing JSON there would trade a fork for a correctness risk. This
# scanner sums cmd-subs, pipes and applets independently, so each of those
# two command substitutions scores 2 (one cmd-sub + one applet). 2 + 2 = 4
# is the floor. The plan said 3; that was set before this scanner existed
# and was simply wrong arithmetic, corrected here by the orchestrator rather
# than by the builder implementing against it.
assert_ceiling "target 3" "$POLLER" "update_system_health" 4

# Target 4 — update_proc_metrics: /proc/stat, /proc/meminfo and /proc/uptime
# are all readable with the read builtin and suffix trimming. Zero forks.
assert_ceiling "target 4" "$POLLER" "update_proc_metrics" 0

# Target 5 — qcmd_exec: the echo/OK stripper
#
#     result=$(printf '%s\n' "$result" | grep -v '^AT' | grep -v '^OK$' | grep -v '^$')
#
# becomes a pure-bash walk over the string, the same idiom parse_serving_cell
# and read_ping_data already use. Zero forks.
#
# This target was added AFTER the first three landed, on measured evidence
# rather than by inspection. Phase 5 profiling put poll_serving_cell at 42 ms
# (RM520N-GL) and 55 ms (RG501Q-EU) against a 40/50 ms bar — a real 5-10%
# overshoot, reproducible to within 2% across two runs per device. The residual
# was NOT in the rewritten parse_serving_cell, which by then held exactly one
# command substitution. It was these three greps: 3.55 ms each on the RM520N-GL
# and 4.75 ms on the RG501Q-EU, so ~11 ms and ~14 ms per call, which is almost
# exactly each device's overshoot.
#
# qcmd_exec runs for EVERY AT command the poller issues, not just the serving
# cell, so this also reaches the CA block and poll_tier2.
#
# The ceiling is 1, not 0: `result=$(qcmd "$cmd" 2>/dev/null)` is the AT
# transport itself and must stay. `qcmd` is not in the applet set above, so
# that substitution scores 1 and nothing else does.
assert_ceiling "target 5" "$POLLER" "qcmd_exec" 1

# NOTE: read_ping_data is deliberately NOT asserted here. It was dropped from
# this pass (its profile baseline is stale — the repo copy and the two device
# copies differ), so a ceiling on it would be red forever and would tell us
# nothing about work anyone is doing.

# ---------------------------------------------------------------------------
printf '\n%d passed, %d failed' "$pass_count" "$fail_count"
if [ "$fail" -eq 0 ]; then
    printf ', ALL PASS\n'
    exit 0
else
    printf ', FAILURES\n'
    exit 1
fi
