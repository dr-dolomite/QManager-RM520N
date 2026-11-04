# Run: IP Passthrough page redesign (/local-network/ip-passthrough)
status: closed
lane: full
base: 71fb714c35363d3b33fa0eb700b5b74f85059fbc   branch: worktree-wt-ip-passthrough-redesign (.claude/worktrees/wt-ip-passthrough-redesign)   opened: 2026-10-12   lead: opus

## Request
"Redesign the IP Passthrough page (/local-network/ip-passthrough) in QManager-RM520N, on the same premise as the Watchdog, Network Events and Latency Monitor redesigns. Start with the qm-redesign-review skill: publish an Artifact with a measured critique, a working mockup and a change list, then wait for my approval. Build only after I approve, under qm-orchestrate. Load /impeccable context." (Full brief, with DO-NOT-BREAK list, amendments, hard rules and verification steps, is in the session's first message.)

## Decisions taken — do not re-ask
- Routed through qm-redesign-review (recon + plan); artifact gate before any code.
- Device policy (user): read-only probes only. NEVER apply IPPT, reboot or write config on the device without asking. Browser: stub Apply, never navigate to /reboot/ against the device.
- Commit only when the user says so. Release-note bullet goes in the v0.1.17-draft entry.
- GATE passed 2026-10-12 (AskUserQuestion): Layout "Strip over card (Recommended)"; Banners "Retire both (Recommended)"; Backend bug "Yes, separate ticket (Recommended)"; Copy "All of it (Recommended)". Artifact is the brief.
- User amendment after the gate: "Add more vertical gaps with the IP Configuration card" -> artifact v2: SETTING.GROUP gap 14px (was 6), SETTING.BODY gap-y 28px / gap-x 40px.
- User: "we cannot do live tests with Enabling / Disabling Passthroughs" -> device proof is read-only only (AT queries, parsers run from /tmp). "Other than that we can proceed."
- Close-out pre-authorised (user): "Merge to development once everything passes and as another part of the v0.1.17 release" -> commit + merge into development after verify; release-note bullet in the v0.1.17 entry.

## Plan
| id | task | class | seat (model/effort) | write set | state |
|---|---|---|---|---|---|
| R1 | Surface + canon recon | recon | conductor (inline) | none | ACCEPTED |
| R2 | Device read (GET as www-data) | recon | conductor (read-only ssh) | none | ACCEPTED |
| P1 | Review artifact (critique + mock) | plan | conductor | scratchpad only | VERIFIED v1 — https://claude.ai/artifact/4o6m9zJK4Q9nV5UrBiy9wL |
| G1 | Gate | gate | user | none | ACCEPTED |
| B1 | Frontend build | build | ui-builder (pin) | components/local-network/ip-passthrough/**, public/locales/*/common.json | VERIFIED |
| V1 | Blind verify | verify | qm-verifier (pin) | none | ACCEPTED (PASS_WITH_NOTES) |
| D1 | Docs + release note | docs | docs-writer (pin) | docs/reference/ip-passthrough.md, DESIGN.md row, RELEASE_NOTES.md | ACCEPTED |
| B2 | parse_at.sh echo-line fix | build | cgi-endpoint-builder (pin) | scripts/usr/lib/qmanager/parse_at.sh | ACCEPTED |

## Attempts   (append-only)
| task | # | seat | ticket rev | outcome | checks run | evidence path |
|---|---|---|---|---|---|---|
| B1 | 1 | ui-builder | r1 | DONE_WITH_CONCERNS: status-strip.tsx new, ippt-strip.tsx deleted, card/shell/shapes rewritten, 5 catalogs; 1440 device 623px (was 1,056), strip 110 / card 385, 390 no h-scroll 1,382px; Apply->POST->error toast, no navigation. Concerns accepted: Target dims key only (avoid compounding), parse_at.sh is B2's, docs out of write set, SaveButton aria em dash is the primitive's | tsc, eslint, i18n:check 0 err, build, browser :3027 shim | builder report; conductor read hand-off lines 278-300 |
| V1 | 1 | qm-verifier | r1 | PASS_WITH_NOTES: 11/11 criteria; notes: strip figures overlap at 640-655px card (min-w-0 in repeat(5,auto)), phone settings skeleton ~100px short, eth0 in status blurb, manual MAC -> Router counts 2 changes (accurate: MAC is cleared; kept) | tsc, eslint, i18n, build, browser :3029 | .orchestra/scratch/verify-*.log |
| fix 1 | - | conductor (Direct) | - | ACCEPTED: FIGS step 40->48rem card, wide figures flex-wrap + min-w-max (0 overlap/overflow at card 294-1072px); Mode-note skeleton lines (phone skeleton 807 vs loaded 788, was ~100 short); eth0 -> 'the Ethernet device' x5 + doc; DESIGN.md CardDescription cite | tsc, eslint, i18n:check, build; browser :3027 | this ledger |
| D1 | 1 | docs-writer | r1 | DONE_WITH_CONCERNS -> ACCEPTED: ip-passthrough.md anatomy + parser note (59 leaves), README row, DESIGN.md landed row, 2 v0.1.17 bullets; conductor fixed DESIGN.md CardDescription cite (:468 -> card:337 CARD_DESC) | symbol greps | docs diff |
| B2 | 1 | cgi-endpoint-builder | r1 | DONE -> ACCEPTED: 3 awk filters anchored on index($0,"+QMAP:"/"+QCFG:")==1; mpdn_rule parser safe (case-sensitive "MPDN_rule",0,); 1 file +6/-3 | bash -n, check-crlf OK; RM520N old nat0/usb0/dns disabled -> new nat1/usb1/dns enabled on the same captured replies; synthetic CRLF/ERROR/empty cases; RG501Q unreachable | builder report; conductor 3-way md5 |

## Findings that survive
- Sibling grammar to restate (never import): watchdog/shapes.ts (PAIR, HERO_SHELL, CARD_SHELL px-6), latency-monitoring/shapes.ts ROWS (42px pill rows, 5px gap), alerts/shapes.ts BENTO. SegmentedField glyph={() => null} in latency sites-card.tsx:275.
- Reboot hand-off: ip-passthrough-card.tsx:394-418 (sessionStorage qm_rebooting, clear qm_logged_in, href /reboot/). Review rule, not checked: docs/reference/ip-passthrough.md table.

- Measured (dev server 3019 + public/__qm-ippt-shim.js, 1440x1080 dark): band 136px, 4 tiles 262px wide, MAC + 3/4 captions truncated; card 687px, rows 88-99px x 1,021px, Select left edges x=1048-1095. Sample passthrough + Mode dirty: banners 72 + 92px, card top 425->532 when Mode changes, Apply y=1,187, page 1,288px; phone 390: first control y=1,448, Apply y=2,339, page 2,429px.
- Reboot banner body says the gateway "stops answering" even when switching passthrough -> Router (copy wrong in that direction).
- BACKEND BUG (out of scope, ask): parse_at.sh parse_ippt_nat/usbnet/dhcpv4dns (:1166-1207) match qcmd's command ECHO line first, so with no ippt_config.json the GET reports nat 0 / usb 0 (RMNET) / dns disabled while the modem says IPPT_NAT 1 / usbnet 1 (ECM) / DHCPV4DNS enable (61368cd2, 2026-10-12). Applying a Mode-only change would rewrite all three.

## Device state
RM520N-GL 61368cd2: one read-only probe (GET as www-data with a minted session, AT queries MPDN_RULE/IPPT_NAT/usbnet/DHCPV4DNS/LANIP). Session file and /tmp/ipptprobe.sh deleted (count 0). No ippt_config.json on the device.
Temporary repo file: public/__qm-ippt-shim.js in the MAIN checkout (delete before merge).
B2 (2026-10-12): /tmp only, cleaned (0 matches). 3-way md5 parse_at.sh: deployed d97c8237 = base d97c8237; worktree 192da5bf (not deployed). No ippt_config.json on device. Stored poller values stay wrong until the fixed parser ships (OTA + boot).

## Handoff — NEXT ACTION
Closed 2026-10-12: committed in the worktree and merged into development per the user's pre-authorisation; post-merge gates re-run. Not yet run on hardware beyond the read-only parser proof; the user's tarball run is the hardware proof. Worktree .claude/worktrees/wt-ip-passthrough-redesign kept on disk.
