# Worktree and branch discipline (Full lane)

## Branch model

- **`development` is the integration base.** It is the branch the user works on day to day, and the branch all worktree work is based on and merged back into. When in doubt about "the originating branch", it is `development`.
- **`main` is release-only.** A branch reaches `main` when the user explicitly decides a version is stable. Never merge to `main` on your own initiative.

## Entry — right after the gate, before any builder writes

1. **Be on `development` first.** `.claude/settings.json` pins `worktree.baseRef: head`, so `EnterWorktree` inherits whatever branch is currently checked out. This bit a real run: a worktree branched from `main` at v0.1.12 while `development` was 44 commits ahead, forcing six diverged files to be re-applied at close-out.
2. `EnterWorktree` on a fresh branch named for the change (`wt/<slug>`). Recon and plan stay in the main checkout — they are read-only and should see the branch the user asked about.
3. **Residual check, because the failure is silent:** `git merge-base HEAD development` must equal `git rev-parse HEAD`. A measured entry came up 197 commits behind. If it does not match, `git reset --hard development` on the fresh worktree before any write.
4. Record `BASE=$(git rev-parse HEAD)` in the ledger and **diff against `$BASE` from then on, never against the branch name** — parallel sessions advance `development` mid-run, and `development` itself can be rebased under you.

## What a fresh worktree is missing

| Missing | Fix |
|---|---|
| `.env` | Copy it from the main checkout, or every device-touching agent silently loses SSH access. Verify `git check-ignore .env` still holds; never commit it |
| `/reimagine/` | Gitignored, so the design-mock bundle does not exist. A builder briefed to "match the mock" finds nothing and improvises without saying so. Copy it in before briefing any agent that must read a mock |
| `node_modules` | `bun install` lazily, only if the change needs a frontend build/lint/tsc pass, then `bunx next typegen` — without it, phantom "Cannot find module" errors |
| `.orchestra/scratch/` | Absent by design. Anything a future session needs belongs in the committed run ledger |

The Browser pane's `preview_start` serves the **repo root, not the worktree** — add a launch entry rooted at the worktree, or verify in the main checkout after the merge.

## While the run is open

- **Never `git stash` in the main checkout.** Parallel sessions have uncommitted files there.
- The index and HEAD are per-worktree, but a parallel session's commit in the same checkout can steal staged files — commit from the worktree, not the main tree.
- Isolate builders from each other (`isolation: "worktree"`) only when their file sets overlap or are uncertain. The normal case — backend in `scripts/`, UI in `components/` — is provably disjoint and shares the run worktree.
- `TaskStop` orphans `next dev` children, which keep holding `.next` and make `git worktree remove` fail. Stop the dev server before exiting.

## Close-out

1. Ask the user with `AskUserQuestion`: merge into `development`, keep the branch for a PR, or discard. **Never auto-merge.**
2. `ExitWorktree`. Its "Discarded N commits" line is a known false alarm — verify against `git merge-base` before believing it. Removing a worktree from inside it leaves an empty locked directory.
3. **After merging, run the full gate set again.** The pre-merge typecheck is not enough: files that each pass in isolation can collectively violate a contract that advanced on `development`. One builder's `{ title }` nav item met a merged i18n change that required `t_key`, and only the post-merge build caught it.
4. **Resolve shared index files by integrating both sides, never clobbering** — `CLAUDE.md`, `RELEASE_NOTES.md`, `docs/reference/README.md`, and the installer's gated-service list. Keep the target branch's entries and graft the feature's rows in.
5. Run the close-out checklist in `references/verification.md` before declaring the run closed.
