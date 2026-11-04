# Run: Motion canon finalize + app-wide motion sweep
status: closed
lane: full
base: c2ee0e99   branch: worktree-motion-canon-sweep (.claude/worktrees/motion-canon-sweep)   opened: 2026-10-11   lead: opus

## Request
"Finalize our Motion doc (for animation and transitions); Sweep all components for checks and audit against the finalized Motion doc; Update / redesign if needed. I find reduce motion / full motion to also seemed to be inconsistent across the whole QManager app. ... for things such as recon, use Haiku 5.5 ... rewrite those skills / agents if needed."

## Decisions taken — do not re-ask
- User delegated the approach choice to the conductor ("I give you permissions to do decisions").
- Haiku recon: qm-scout pinned to haiku, roster rail 2 rewritten — committed 4e8e92e0 before this run.
- Gate delegated: user 2026-10-11 "we already have established the basis for our Motion according to our design language and philosophy so if there are decisions, you may now decide it yourself." Conductor decides; no AskUserQuestion gate.
- cgi-endpoint-builder effort raised to high (user, mid-run) — c2ee0e99. Not used in this run.
- D1 One resolver for "is motion reduced": `isMotionReduced()` (lib/motion-preference.ts, plain fn: data-motion attr first, then OS query) and `useMotionReduced()` (components/motion-preference.tsx, live: preference context + subscribed media query). motion/react `useReducedMotion` and raw `matchMedia("(prefers-reduced-motion…")` are banned elsewhere, enforced by eslint.
- D2 Loading loops stop under Reduced: canonical `motion-safe:animate-spin` / `motion-safe:animate-pulse` (56/89 spinners already stop; the glyph + label still read as loading).
- D3 tw-animate Radix enter/exit: under the motion-reduce variant a global rule zeroes translate/scale/rotate/blur vars; opacity stays ("movement goes, opacity stays").
- D4 Charts read `useMotionReduced`. No `useChartBarMotion` until a `<Bar>` chart exists; canon text amended.
- D5 Springs banned → DUR/EASE tweens. Unused components/ui/animated-list.tsx + animated-beam.tsx deleted.
- D6 Drawer follows the Modal-Exit Rule; non-modal popups (popover/dropdown/select/tooltip/hover-card/context-menu) run `quick` both ways on the scale.
- D7 not-found decorative loop removed (not live). Speedtest live pulse stays (live + guarded).
- D8 rAF-armed state flips are fixed per the Non-Load-Bearing Rule (judgment → ui-builder).
- D9 Docs: DESIGN.md > Motion restated with D1-D4 as rules, Migration Delta row closed, new docs/reference/motion-preference.md + router row.
- Motion doc = DESIGN.md > Motion (lines ~638-700) + docs/reference/dashboard-state-motion.md; lib/motion.ts + globals.css are the code layer.

## Plan
| id | task | class | seat (model/effort) | write set | state |
|---|---|---|---|---|---|
| R1 | Reduced-motion mechanism census | recon | qm-scout haiku/low | .orchestra/scratch/motion-r1.md | ACCEPTED |
| R2 | One-Scale census (durations/easings/keyframes) | recon | qm-scout haiku/low | .orchestra/scratch/motion-r2.md | ACCEPTED |
| R3 | Rule census (width, exits, loops, overshoot, modals, nested stagger) | recon | qm-scout haiku/low | .orchestra/scratch/motion-r3.md | ACCEPTED |
| W0 | Foundation: resolver fn+hook, chart hook, use-value-tick, globals.css reduced rules, eslint bans, delete magic-ui | build | ui-builder opus/medium | lib/motion-preference.ts, components/motion-preference.tsx, hooks/use-chart-motion.ts, hooks/use-value-tick.ts, app/globals.css, eslint.config.mjs, components/ui/animated-*.tsx | VERIFIED (b2b0a0d6) |
| W1a | Sweep: components/ui, app, auth, public, onboarding | build | qm-worker sonnet/medium | those dirs | VERIFIED (fb396127) |
| W1b | Sweep: components/cellular, components/dashboard | build | qm-worker sonnet/medium | those dirs | VERIFIED (fb396127) |
| W1c | Sweep: all other components/ dirs + hooks (minus W0 files) | build | qm-worker sonnet/medium | those dirs | VERIFIED (fb396127) |
| W2 | Judgment: rAF flips, nested stagger clocks, inline stagger children | build | ui-builder opus/medium | sites from R3 §6-7 | VERIFIED (d995bb44) |
| V | Blind verify + browser proof under System/Full/Reduced | verify | qm-verifier opus/high + conductor | — | VERIFIED (PASS_WITH_NOTES, b4bf6042) |
| DOC | DESIGN.md Motion + motion-preference.md + router row | docs | docs-writer opus/medium | DESIGN.md, docs/reference/* | VERIFIED (4f44e0f4) |

## Attempts   (append-only)
| task | # | seat | ticket rev | outcome | checks run | evidence path |
|---|---|---|---|---|---|---|
| R1 | 1 | qm-scout haiku | 1 | DONE_WITH_CONCERNS | census | .orchestra/scratch/motion-r1.md |
| R2 | 1 | qm-scout haiku | 1 | DONE_WITH_CONCERNS | census (heuristic) | .orchestra/scratch/motion-r2.md |
| R3 | 1 | qm-scout haiku | 1 | DONE_WITH_CONCERNS | census | .orchestra/scratch/motion-r3.md |
| W0 | 1 | ui-builder opus | 1 | DONE_WITH_CONCERNS (ca-* opacity-only kept, accepted) | tsc 0, build 0, lint 12 expected | b2b0a0d6 |

## Findings that survive
- V1 FAIL (qm-verifier): motion-dom fixes reducedMotion per element at mount and MotionProvider started at "user" -> reload ignored Full/Reduced. Fixed b4bf6042 (provider reads data-motion at render); proven: reload with reduced -> getAnimations() empty, full -> transform running. Mid-session switch reaches motion elements only on next mount: ACCEPTED + documented (forced remount drops drafts).
- Drawer (components/ui/drawer.tsx) has no consumers; vaul's slide is not neutralised under Reduced — matters only if a drawer ships.
- Open, not this run: DESIGN.md Migration Deltas components/ui One-Scale row (~:266) may now be closable; eslint matchMedia ban misses template/constant args.
- Browser proof (static out/ served on :3078, /setup + injected probes): under data-motion=reduced motion-safe:animate-spin/pulse -> animation none, tw-animate --tw-enter-translate-y 0 and --tw-enter-scale 1, opacity kept; under full/absent they animate. Onboarding step dots settle 24px active / 8px idle. Console: only CGI 404s (no backend). OS-query branch not exercised in the pane (OS reduce = false).
- W2: the 7 rAF calls only arm transitions or measure layout; own-clock stagger children all mount late (correct). Do not re-flag them.
- Root cause of Full/Reduced inconsistency: 14 OS-only reads — 8x motion/react useReducedMotion (login-component:507, login-device-name:82, apply-progress-dialog:160, custom-profile-form:129, custom-profile:939, rate-ceiling-disclosure:286, overview/band-rows:139, overview-card:139), 5x raw matchMedia (imei-settings:123, use-watchdog-form:320, step-done:17, at-terminal/derive:167, hooks/use-value-tick:88), hooks/use-chart-motion:136.
- ~50 animations with no reduced handling: 33/89 spinners, skeleton pulse, tw-animate animate-in on components/ui, globals.css .ca-skeleton-out/.ca-content-in.
- Modal surfaces dialog/alert-dialog/sheet are compliant; drawer.tsx:40,56-63 is not.
- Springs: step-password:189, step-network-mode:146,207, step-connection:257, step-band-locking:188, onboarding-shell:120, ui/animated-list:18 (unused).

## Device state
Frontend-only run; DEVICE none.

## Handoff — NEXT ACTION
All waves verified. Close-out pending the user's merge/keep/discard choice. After merge: tsc/lint/build/i18n on development; stop preview motion-proof-3078; delete worktree .claude/launch.json (untracked).
