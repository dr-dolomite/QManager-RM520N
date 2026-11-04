# Run: Switch → SegmentedField in the cards the Card-Foot sweep touched
status: closed
lane: full (frontend only, no device)
base: 62287c50   branch: wt/switch-segmented-field @ .claude/worktrees/switch-segmented-field   opened: 2026-10-06   lead: Sonnet 5.5

## Request
"Switch → SegmentedField. 24 sites in 19 files. The rule says new and reworked surfaces only, so do it as part of item 3 where a card is already being touched. Don't run it as a separate sweep. Append as another part of the .17-draft version." Then: "Wait for that session to finish, then do it."

## Decisions taken — do not re-ask
- 2026-10-06 "Item 3" = the Card-Foot Apply sweep (run 2026-10-06-card-foot-apply-sweep, merged 62287c50). Scope = Switches inside cards that sweep moved to CardFoot; the other ~10 sites stay in DESIGN.md Migration Deltas.
- 2026-10-06 User chose this session to do it AFTER the sweep session finished (it did; branch merged and ledger closed).
- 2026-10-06 Goes in the existing v0.1.17-draft release entry as one more Improvements bullet; no version rotation.
- Exempt, unchanged: custom-profile-form wizard, automation-tiles per-row, schedule-tile, live-band-hero, force-tcp-card, tailscale/connection-card, transcript-card, update-preferences-card.
- Idiom (from the101): inline `SegmentedField`, `breakpoint="never"`, two options with translated labels, caller-supplied glyph (Material `check` under /cellular/**, lucide `CheckIcon` elsewhere — icon boundary).
- A Switch that fires an immediate mutation (not a draft preference) is skipped and reported.

## Plan
| id | task | class | seat | write set | state |
|---|---|---|---|---|---|
| A | cellular: lte-tower, nr-sa-tower, mbn-card, backup-imei, sms-forwarding | build | ui-builder | those 5 files | DONE (5/5 converted, no locale change: reuses common state.on/off) |
| B | lucide routes: custom-dns x2, mtu, ttl, ladder-card, alerts/channel-field, scheduled-operations-card | build | ui-builder | those files | DONE_WITH_CONCERNS (6/8 converted; skipped ladder per-rung switch and scheduled-operations-card, which autosaves) |
| V | blind verifier | verify | qm-verifier | none | FAIL then fixed: SMS forwarding label clipped at 375px (fixed row height + truncate) -> TOGGLE_ROW wraps; re-verified PASS at 375/430/1280 and Indonesian. Also fixed: lte-tower-card back to CRLF, dead switchLabelId in mtu/ttl |
| D | DESIGN.md Migration Deltas (13 sites / 10 files), CLAUDE.md count, release bullet | docs | conductor | DESIGN.md, CLAUDE.md, RELEASE_NOTES.md | DONE |

## Attempts   (append-only)
| task | # | seat | ticket rev | outcome | checks run | evidence path |
|---|---|---|---|---|---|---|

## Findings that survive
- `grep -rnE "<Switch\b" app components` at 62287c50: 24 sites in 19 files, unchanged by the sweep.
- Existing SegmentedField consumers (cellular-settings-card, apn-settings-card) use string values; none is boolean, so On/Off needs a "on"/"off" mapping at the call site.

## Device state
No device touched. Frontend-only change.

## Evidence
- Conductor gates on the final tree: tsc rc=0, eslint on 14 files rc=0, i18n:check 0 errors, `bun run build` rc=0 with no CSS optimizer warning.
- Verifier rendered with mocked CGI (no device): custom-dns, ttl/mtu, watchdog, alerts, sms-forwarding, imei, apn/MBN, tower-locking LTE + NR-SA. Not rendered: Discord channel row, light theme, real device, save paths.
- Open: tap target is 34px segments in a 42px track (primitive's size), below the old 44px Switch overlay; ladder per-rung Switch left because the rung's right column is too narrow; SMS forwarding 20s reload resets an unsaved draft (pre-existing).

## Device state
Not touched.

## Handoff — NEXT ACTION
Committed on wt/switch-segmented-field. Merge into development is the user's choice (close-out question). Nothing else open.
