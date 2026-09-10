# Verification: the device first, gates second, a blind verifier third

**A change is proved by running it, not by a harness we wrote ourselves.** A test written in this repo can only assert what its author already believed. Every cross-device defect found so far — the missing `wget` applet, `timeout`'s positional form, the absent `mountpoint`, `/etc/passwd` at `0600` — came from running a command on a second device. None came from a harness, and none came from an agent reading code.

**No test harnesses, ever:** no `scripts/test/`, no `*.test.*`, no one-off assertion script. Write a test only if the user explicitly asks.

## Layer 0 — run the real thing

This layer is the conductor's own move and costs no dispatch. Name it in the plan before the gate: the target, the command, and the output that means it worked.

- **Backend / shell** — `scp` the file up and run it. See `CLAUDE.md` > Live Device Access for the connection recipe and the device table.
- **CGI** — through lighttpd (`curl -sS http://127.0.0.1/cgi-bin/quecmanager/...`) or `sudo -n -u www-data`. Never a root shell with `_SKIP_AUTH=1`; that has masked real permission bugs.
- **Portability** — both devices, diffed, and **prove which device answered** (`cat /etc/quectel-project-version`, the serial from `/proc/cmdline`). A wrong-device capture fails silently.
- **Frontend** — load the route in the Browser pane against `next dev` on the project's launch entry, never port 3000 (that is the sibling repo). Read the rendered page, the console, and the network tab.
- **Anything disruptive** — a reboot, `AT+CFUN=1,1`, a service restart, a factory reset, a live config write — is flagged in the plan and needs the user's explicit yes first, quoted into the ledger's Decisions section.

## Layer 1 — deterministic gates

Run all of them, never a weaker proxy.

| Surface | Gates |
|---|---|
| Backend | `bash .claude/check-crlf.sh <files>`, plus an on-device `sh -n` / `bash -n` |
| Frontend | `bunx tsc --noEmit`, `bun run lint`, `bun run i18n:check` (100% parity across the five locale packs, which are CRLF), `bun run build`, and `bun run icons:check` when an icon changed |

**Read `bun run build`'s output.** It reports `Found N warnings while optimizing generated CSS` with a code frame naming the class, then drops the rule and **exits 0** — so the Tailwind prose hazard passes every exit-status check. Mechanism: `docs/reference/tailwind-prose-hazard.md`.

**A green gate proves nothing about rendering.** `next build`, `tsc --noEmit`, `eslint` and `i18n:check` were all green on a tree where every route in `next dev` returned 500. Gates are necessary, never sufficient. A failing gate needs no verifier — it goes straight into a fix ticket.

## Layer 2 — `qm-verifier`, blind

Required for every accepted change except a single-file change with no logic content (pure formatting, comments, docs). "It seemed trivial" is not an exemption; the impulse to skip it is itself a signal.

**Commit the candidate first** so the tree is clean and the change is in it — never stash it, which would leave the verifier grading the baseline. When the verdict returns, `git status --porcelain` must be empty and HEAD unchanged; any detected mutation voids the verification and is itself a finding.

Give it the original request **verbatim**, the diff or the changed paths, the acceptance criteria, and the `PROOF` line. Nothing else — never the builder's narrative or its restatement of the task, which is where most bad accepts come from. It re-runs the gates itself, runs the script or loads the page when `PROOF` says so, runs the three-way md5 when `DEVICE ≠ none`, checks the *goal* rather than the checklist, and reports a per-criterion evidence table plus a **Not checked** section.

Verifier and conductor resolve to the same model here, so disclose it accurately: **"blind-verified (same model, independent context)"** — never as an independent second opinion.

## Device hygiene

- **Three-way md5** before trusting device behaviour and again at close-out: deployed vs `git show HEAD:<path>` vs working copy. A deployed copy matching neither means something wrote mid-flight.
- **Any agent with `.env` access may touch the device regardless of its brief** — one deployed half-edited code against a "do not deploy" brief. Verify with md5, not with the report.
- Leave the device clean: remove `/tmp` staging when the run closes.

## Close-out checklist

1. Whole-tree `git status --short` — question every path that is not in a WRITE SET.
2. Grep `*.ts *.tsx` for scaffolding markers (`qm-preview`, `__qm-preview-shim`).
3. If `.orchestra/ledger.md` was touched at all, `git diff --numstat .orchestra/ledger.md` must show 0 deletions.
4. After any merge into `development`, run the full gate set again — a clean auto-merge can still break the build.
5. `git add -f` for anything under `.claude/`; it is gitignored and otherwise stays silently untracked.

## Disagreement

A reproduced deterministic failure outranks any verdict, including a `PASS`. At most 3 reruns to characterise a suspected flake, and inconsistent results are treated as failing — never rerun-until-green. Still unresolved → the change is **blocked**, not accepted; hand both artifacts to the user. **The user's own tarball install and report is the authoritative result** and outranks any static reading of the code; when it is ambiguous, ask for the screen or command output that would settle it rather than inferring.
