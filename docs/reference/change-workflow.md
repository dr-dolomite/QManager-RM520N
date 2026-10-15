# Change Workflow

> **Applies to:** RM520N-GL (SDX65) · verified 2026-10
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

The `qm-orchestrate` skill was retired on 2026-10-15 (user decision: it added cost without adding
value). Code changes now run on the normal flow below, with validation at the end.

## The flow

1. **Recon** — read the router row's reference doc, then locate what the change touches. Broad
   sweeps go to `qm-scout` (pinned Haiku 5.5, medium effort); never pass a `model` override to a
   pinned agent.
2. **Plan** — a short task list. Ask the user only for a decision that is genuinely theirs.
   `superpowers:brainstorming` runs **only when the user explicitly asks for it**.
3. **Build** — inline edits, or one specialist agent per independent piece (`cgi-endpoint-builder`,
   `ui-builder`, `qm-worker`, `docs-writer`). Builds on Sonnet, judgments on Opus.
4. **Validate** — the three layers below, then report what was and was not checked.

Redesign / polish requests still go through `qm-redesign-review` first; the approved design is then
built on this flow.

## Validation

**Run the real thing.** No test harnesses — write a test only if the user asks.

- **Backend / shell** — `scp -O` the file up and run it; prove which device answered.
- **CGI** — through lighttpd or `sudo -n -u www-data`, never a root shell with `_SKIP_AUTH=1`.
- **Portability** — run on both devices and diff.
- **Frontend** — load the route in the Browser pane on the launch entry (never port 3000); read the
  page, console and network tab.
- **Disruptive actions** (reboot, `AT+CFUN=1,1`, service restart, live config write) need the user's
  yes first.

**Deterministic gates** — all of them, never a weaker proxy:

| Surface | Gates |
|---|---|
| Backend | `bash .claude/check-crlf.sh <files>`, on-device `sh -n` / `bash -n` |
| Frontend | `bunx tsc --noEmit`, `bun run lint`, `bun run i18n:check`, `bun run build` (read its CSS warnings; it exits 0 on them), `bun run icons:check` when an icon changed |

A green gate proves nothing about rendering — the page load is still required.

**Blind verifier** — `qm-verifier` for any change with logic content. Commit first, give it the
request verbatim, the diff, the acceptance criteria and the proof step; never the builder's
narrative.

**Close-out** — `git status --short` over the whole tree; md5 deployed vs `HEAD` when the device was
touched; `git add -f` anything under `.claude/`; `.orchestra/ledger.md` is append-only if touched.
The user's own tarball run is authoritative.
