# Software Update (`/system-settings/software-update`)

> **Applies to:** RM520N-GL (SDX65) · frontend re-authored onto the design canon 2026-09-07
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)
> Family: `components/system-settings/software-update/**` · namespace
> `public/locales/*/system-settings.json`, `software_update.*` subtree

The Software Update page is the one surface in QManager whose primary verb destroys the surface
itself: installing an update replaces the running app and reboots the modem the browser is
talking to. It exists so a user can do that on purpose, with the consequence visible **before**
they commit rather than discovered afterwards.

The 2026-09-07 re-authoring **did not touch the backend**. `update.sh`, `qmanager_update`,
`qmanager_auto_update`, the timer unit and the installer are all unchanged; every value on the
page was already in the payload. What changed is the client: the family moved out of
`components/monitoring/software-update/` into `/system-settings`, fifteen `Separator`s doing the
work of card boundaries became a status band plus four cards, all page state collapsed into one
discriminated union, and two facts the backend had been emitting into a void were finally wired
up. This doc covers that union and why it is the whole contract, the two fixes and the evidence
behind them, the decisions that look like omissions and are not, and what is deliberately left
alone.

---

## Quick Reference

| Thing | Where |
| ----- | ----- |
| Route | `app/system-settings/software-update/page.tsx` (a three-line re-export) |
| Page shell | `components/system-settings/software-update/software-update.tsx` |
| Page header | `components/system-settings/software-update/page-header.tsx` |
| Status band | `components/system-settings/software-update/status-band.tsx` |
| Anchor card | `components/system-settings/software-update/update-card.tsx` |
| Step ladder | `components/system-settings/software-update/step-ladder.tsx` |
| Release notes | `components/system-settings/software-update/release-notes-card.tsx` |
| Preferences | `components/system-settings/software-update/update-preferences-card.tsx` |
| Version management | `components/system-settings/software-update/version-management-card.tsx` |
| Loading placeholders | `components/system-settings/software-update/card-skeleton.tsx` |
| Geometry + tone | `components/system-settings/software-update/shapes.ts` (the family's **only** shape module) |
| State resolution | `components/system-settings/software-update/derive.ts` (pure; no React, no classes) |
| Hook + types | `hooks/use-software-update.ts` |
| CGI endpoint | `GET`/`POST` `/cgi-bin/quecmanager/system/update.sh` — **frozen, not edited** |
| Poll cadence | `POLL_INTERVAL = 2000` ms (`hooks/use-software-update.ts`) |
| Interrupted-install marker | `/etc/qmanager/VERSION.pending` (read by the CGI, never by the client) |
| Auto-update timer | `scripts/etc/systemd/system/qmanager-auto-update.timer` — `OnCalendar=daily` + `RandomizedDelaySec=3h` |
| Band clock tick | `CLOCK_TICK_MS = 15_000` (the "Checked N ago" caption only) |
| Icon family | **lucide** — `/system-settings` is a lucide route, no Material Symbols here |
| i18n | 137 leaves under `software_update.*`, five packs |

---

## The single-union rule

**Short version: every child of this page reads one string, and no component is allowed to look
at a payload and decide for itself what is happening.**

`derive.ts` exports `UpdateView`, a ten-member discriminated union — a closed set of names where
exactly one is true at a time, so the compiler can force every consumer to handle all of them:

```ts
export type UpdateView =
  | "loading" | "unreachable" | "check_failed" | "up_to_date"
  | "available" | "downloading" | "verifying" | "staged"
  | "installing" | "rebooting";
```

`software-update.tsx` computes it once with `resolveView()` and passes it down. Nothing below the
shell reads `downloadState.status` or `updateStatus.status`. That is not stylistic: the page has
**four** independent sources that each claim to describe the run — the hook's `isDownloading` and
`isUpdating` booleans, `updateStatus` from the install poller, and `downloadState` from the
download poller — and they legitimately disagree during the handoff between phases. The surface
this replaced read them independently in five places, which is how a header could say
"Downloading…" over a card saying "Up to date".

### `resolveView`'s precedence, and why it is this order

Highest first. **A run in flight outranks anything the GET says**, because the GET is a snapshot
of GitHub's opinion and a run is a fact about this device right now.

| # | Guard | Reasoning |
| - | ----- | --------- |
| 1 | `isLoading` | Nothing has landed; every other field is a default, not a reading |
| 2 | `error && !updateInfo` | `unreachable` — the whole page has no data. With data in hand a failure is non-fatal and falls through to `check_failed` |
| 3 | `updateStatus.status === "rebooting"` | Terminal. The device is going away and nothing supersedes that |
| 4 | `isUpdating && installing` | Both halves required: `updateStatus` can carry a stale `installing` from a previous poll after `isUpdating` has already been cleared by a failure |
| 5 | `downloadState.status === "verifying"` | Checked **before** `downloading` — the chained poller collapses `verifying` into `downloading` in `updateStatus`, so the download state is the only place the distinction survives |
| 6 | `(isUpdating \|\| isDownloading) && updateStatus === "downloading"` | The `updateStatus`-derived half is gated on an in-flight flag, symmetrically with guard 4 |
| 7 | `isDownloading \|\| downloadState === "downloading"` | The states that carry their own liveness need no flag |
| 8 | `resolveFailure(...)` non-null | `check_failed` |
| 9 | `downloadState === "ready"` **and** its version is not the running one | `staged` |
| 10 | `update_available === true` | `available` |
| 11 | fallback | `up_to_date` |

> ⚠️ Guards 6, 8 and 9 each fix a defect found in adversarial review, and each is easy to
> "simplify" back into the bug:
>
> - **8 must stay above 9.** With `staged` first, an install that failed left `downloadState` at
>   `ready` and the page repainted as "Ready to install" — no notice, no chip, nothing. A real OTA
>   dying on the modem produced zero UI change.
> - **6 must keep its flag.** `installVersion` sets `updateStatus` to `downloading` before its
>   POST and the hook has no other reason to reset it, so an unguarded read stranded the page in a
>   spinning `downloading` forever, clearable only by a reload. The hook now also resets the
>   status to `idle` on those failure paths; the guard is the second belt.
> - **9 must keep its version test.** A `ready` marker left behind by a completed install
>   otherwise offers to install the build that is already running, and the delta strip renders
>   `v0.1.9 → v0.1.9`.

### `resolveFailure` — one view, three honest sentences

The approved union has **no failure members beyond `check_failed`**. A failed GitHub check, a
failed download and a failed install all resolve to that one view, because they want the same
tone (destructive) and the same layout (the page stays whole, the anchor card carries the
notice). What they do not want is the same sentence: "Could not reach GitHub" is a lie when
GitHub answered and the tarball did not verify.

The hook's shared `error` string cannot answer this on its own — nine call sites write it and
only two are check failures. So the hook also tracks **which operation failed**:

```ts
export type UpdateErrorKind = "check" | "download" | "install";
```

**The hook carries no English prose.** `error` holds the device's own sentence or `null` — every
`||  "Failed to …"` fallback was removed, because a fallback fires exactly when the backend
answered with nothing, i.e. on the transport failure that is the most likely case, and
`i18n:check` cannot see a literal inside a hook. The human sentence is the render site's, keyed
off `errorKind` (the anchor card's `notice.failed_check` / `failed_download` / `failed_install`,
the band's captions, the header's verb) and translated there. That also means `resolveView` tests
`errorKind !== null` for `unreachable` rather than the text: the device may fail without saying
why, and the absence of a sentence is not the absence of a failure.

Every `setError` goes through one `fail(kind, message)` helper, and `resolveFailure()` is the
**one** derived place that turns that into `{ kind, message }` or `null`. Three slots then read
`failure.kind` rather than the view — the anchor card (title, description, chip and notice, all
from a single lookup), the band's Latest tile and head chip, and the page header's verb, which
offers "Try again" for a check, "Try download again" for a download and "Install {version}" for
an install, because the package is still staged and re-checking would discard it.

The three failure kinds share the `destructive` role, so `FAILURE_CHIP` and `LATEST_FACE` give
each its **own** glyph — `CloudOffIcon`, `XCircleIcon`, `OctagonAlertIcon` — and use the same
three in both maps so the band and the card never name one failure two ways.

A component that reaches for `downloadState.status` to choose its own copy is the exact defect
the union exists to stop, and it will look like it works — both branches render, both are
plausible — until a device fails a checksum and is told its internet is down.

---

## The four-step ladder is always rendered

**Short version: the reboot is on screen before you click anything.**

`step-ladder.tsx` renders Download → Verify → Install → Reboot as four rows, unconditionally, in
every view. At rest all four are `pending`. During a run `stepStates(view)` in `derive.ts` flips
the same four rows to `done` / `active` / `pending` in place — nothing mounts, nothing unmounts,
no layout moves, and the row heights that were on screen a second ago are the row heights that
are on screen now.

That is the surface's signature idea and the reason a user finds out the modem restarts while
they still have the option not to. The page it replaced revealed the reboot step only after the
install had started.

`activeStepIndex(view)` maps `downloading → 0`, `verifying → 1`, `installing → 2`,
`rebooting → 3`, and `null` at rest. `staged` marks steps 0 and 1 `done` with 2 and 3 still
`pending`, which is exactly what a staged-but-uninstalled package means.

### There is deliberately no fill bar — and one must not come back

The backend reports a status **word**, never a percentage. `update.sh` writes
`status: "downloading" | "verifying" | "ready" | "installing" | "rebooting" | "error"` and no
byte counter exists anywhere in the pipeline.

The retired `update-status-card.tsx` shipped a `SegmentedProgress` component and, beside it, a
track whose inline width was hardcoded to 60% while downloading and 90% while verifying. Those
numbers measured nothing. They were a picture of a measurement over data that does not exist.

Per DESIGN.md's Loader-and-Dots Rule, fill bars are reserved for data visualisation and
step-based progress uses a spinner plus dot indicators. **The four ladder discs are the dot
indicators.** Do not substitute a `MetricBar`, a `Progress`, or an indeterminate bar; the honest
signal here is which row is spinning.

---

## The two fixes folded in

Neither touched the CGI. Both read fields the backend was already emitting.

### 1. The interrupted install now has a surface

`update.sh` emits `previous_install_failed` (boolean) and `pending_version` (string or null) on
**all three** GET paths — the API-fetch-failed path (~line 142), the rate-limited path (~line 179)
and the normal path (~line 285). Both are derived from whether `/etc/qmanager/VERSION.pending`
exists and is non-empty:

```sh
--argjson pif "$([ -n "$pending_version" ] && echo true || echo false)" \
--arg pv "$pending_version" \
```

A surviving `VERSION.pending` marker means an install wrote the marker, began replacing files,
and never reached the reboot that clears it. **The tree may be mixed** — some files from the new
build, some from the old.

Neither field appeared in the `UpdateInfo` interface, so nothing on the client could read them.
They were emitted into a void on every device, on every request, for the life of the endpoint.

Both are now typed. `installedState()` reads them **defensively** —
`info?.previous_install_failed === true`, never a truthiness test — because a device running an
older QManager omits the key entirely and an absent key must not be read as a condition.

When true, the shell renders a page-level `Banner role="degraded"` with **no dismiss**. That is
the Dismiss-Only-Notices Rule: a standing condition has no X, because dismissing it would not
change the fact. `banner.tsx` enforces this by construction — `degraded` carries no
`dismissible` flag, so an `onDismiss` handler on that role is ignored rather than honoured.

The banner's CTA calls `resumeInterrupted()`, which preselects `pending_version` in the version
management select and opens that card's confirm dialog. This is why `selectedVersion` and
`versionDialogOpen` live in the **shell** rather than in `version-management-card.tsx`: the
banner sits above the card and needs to drive it.

> ℹ️ NOTE: the banner requires **both** `previous_install_failed` and a non-null
> `pending_version`. The backend can in principle report the flag with an empty marker file; a
> banner naming no version would be an alarm with no action attached to it.

### 2. `download_size` is `null` on every device that has ever run this code

`update.sh` sets `download_size=""` unconditionally on the normal GET path and **never assigns
it again**, and the jq emitter then maps the empty string to `null`:

```sh
download_size=""
...
download_size: (if $ds == "" then null else $ds end),
```

So `info.download_size` is `null` everywhere, always. Both consumers of it in the retired UI —
the size chip and the install dialog's "Download size:" clause — were dead branches that no
device could reach.

The figure exists. It is on the matching release asset in `available_versions[]`, which the same
GET already builds. `latestAssetSize(info)` finds the entry whose `tag` equals `latest_version`
and returns its `asset_size`; `packageSize(info)` prefers a non-empty `download_size` and falls
back to it.

`download_size` is **kept in the type** because the field still exists on the wire and removing
it would make the interface a worse description of the payload than the payload is. It is simply
never the only source.

Version management resolves its own size independently: the **chosen** build's `asset_size`,
falling back to the page-level figure. The latest release's size is not the size of a downgrade.

---

## The error channel: the hook's two save signatures

**Short version: a preference that failed to save is not a failed GitHub check, and the page used
to say it was.**

`togglePrerelease` and `saveAutoUpdate` return `Promise<string | null>` — `null` on success, the
device's own words otherwise — and deliberately do **not** call the hook's shared `setError`.

> ⚠️ `""` is a real failure: the device declined and said nothing. The card therefore tests
> `failure !== null`, never truthiness, or a silent rejection reads as a save and even fires the
> success toast. The sentence is the card's own — it knows which row it saved, so it renders
> `preferences.auto.error` or `preferences.prerelease.error` and puts the device's words, when
> there are any, in the mono detail line beneath.

The mechanism: `error` is a `resolveView` input. Setting it from a rejected write repaints the
entire surface as `check_failed` — the anchor card's title, description and chip all flip, the
status band's Latest tile goes destructive with the caption "Could not reach GitHub", and the
band head grows an "Offline" chip. All of that over a toggle the device declined to write, with
a perfectly good GET already in hand.

This is the same defect `system-settings.md` records for `useSystemSettings().error` and the same
fix: the read path owns the shared error, the write path returns its own.

`update-preferences-card.tsx` owns the consequence — a destructive `NOTICE` box with
`role="alert"`, carrying the device's own sentence as machine voice beneath the translated
title, plus the existing toast. `saveError` clears on the next successful save.

> ⚠️ WARNING: `fetchUpdateInfo` still calls `setError(null)` on entry and both save paths call it
> on success. That is correct here — a successful save re-fetches, so the read error genuinely is
> resolved — but it is the construction `system-settings.md` warns about in the reverse case.
> Anything that clears the shared error **without** re-reading would erase a real stale-read
> warning while every value on screen was still from the failed read.

---

## `auto_update_time` is inert, and no time picker may be added

The auto-update timer is `OnCalendar=daily` with `RandomizedDelaySec=3h` — it fires once a day at
a time systemd picks, and the randomisation is deliberate: it spreads a whole fleet's GitHub API
calls rather than pointing every device at the same minute. There is nothing for a user to
configure.

The CGI still validates the field and rejects a malformed one:

```sh
echo "$auto_time" | grep -qE '^[0-9]{2}:[0-9]{2}$' || {
    cgi_error "invalid_value" "time must be HH:MM format"; exit 0
}
```

So the client must send something. `AUTO_UPDATE_TIME` in `shapes.ts` is that constant, posted
unchanged on every `save_auto_update`. The retired card carried a `useState("03:00")`, a sync
effect and a time input, all of which configured a value nothing reads.

**The band's third tile is what replaced the picker.** It reports On/Off with the caption "Daily
check at a randomised time", which is the true cadence stated in words. Restoring a picker would
re-create a control that appears to set a schedule and does not.

---

## The reboot handoff is untouchable

Three lines, in this order, at **four** sites in `hooks/use-software-update.ts` — the install
poller's `rebooting` branch and its `catch`, and the chained poller's `rebooting` branch and its
`catch`:

```ts
sessionStorage.setItem("qm_rebooting", "1");
document.cookie = "qm_logged_in=; Path=/; Max-Age=0";
window.location.href = "/reboot/";
```

The OTA worker waits for the `/reboot/` page's `reboot_ack` before issuing the reboot syscall, so
the navigation must happen while lighttpd is still alive to serve that static page. Clearing
`qm_logged_in` is what stops the auth guard bouncing the browser to `/login/` instead, and the
`sessionStorage` flag is what tells `/reboot/` it is a legitimate arrival rather than a stray
visit. Dropping any one line breaks `cgi_reboot_response`'s ack wait **silently** — the install
completes, the page hangs, and the modem never restarts.

The `catch` branches navigate too, and that is deliberate: a fetch that fails mid-install almost
certainly means the device is already rebooting, and waiting does not bring it back sooner.

This is out of scope for any frontend change on this surface. See
[`ip-passthrough.md`](./ip-passthrough.md) for the same three-line contract on the other route
that reboots.

---

## Two deliberate deviations from the approved spec

Both are decisions, not oversights. Do not "restore" them.

### 1. Distinct glyphs where the spec specified a shared spinner

The spec's §3 tables put a spinning `Loader2Icon` on **both** `installing` and `rebooting` in the
page-header badge, and on **both** `downloading` and `installing` in the band's Latest tile.

That is two states sharing one glyph in one slot, which the Every-Chip-Has-A-Glyph Rule forbids.
`success-container` and `warning-container` measure **1.03:1** apart and are indistinguishable
under deuteranopia; on this surface all four of the Latest tile's running states are the same
`primary` fill. The glyph is the only separator those states have, and a caption is not allowed
to be the only difference between "fetching a file" and "replacing your system".

Both now key onto distinct glyphs. The header badge reads `ANCHOR_CHIP[view]`, whose ten entries
are pairwise distinct within each variant. `LATEST_FACE.installing` takes `PackageOpenIcon`
while `LATEST_FACE.downloading` keeps the spinner.

The same rule then forced one more move. Adding a `verifying` face on `ShieldCheckIcon` collided
with `verified`, which already held it — two `primary` states in one slot separated only by their
caption. `verified` moved to `PackageCheckIcon`, which also rhymes with `ANCHOR_CHIP.staged`.

`ANCHOR_CHIP` is typed `Record<UpdateView, …>`, so an eleventh view cannot reach the slot without
someone choosing its glyph.

### 2. The staged-install pill keeps its confirm dialog

The spec's header table describes the `Install {version}` pill but not its handler, and §7's
delete list does not mention the confirm. The retired page had one, so it was preserved: the pill
sits in the page header where a mis-click is cheap, and **one click on it restarts the modem**.

The `AlertDialog` lives in `software-update.tsx` rather than in the header, because the header is
a presentational switch over the view and the dialog needs the payload to name a version and a
size.

---

## Composition and states

```
PAGE_ROOT
  [Banner role="degraded"]     only when previous_install_failed && pending_version
  <PageHeader />               title + one contextual verb (+ "Check again" when an update is known)
  <StatusBand />               head label + 3 tiles (Installed · Latest release · Automatic updates)
  <UpdateCard />               ANCHOR — delta strip + step ladder + consequence notice
  {!running && <ReleaseNotesCard />}
  {!running && <CARD_GRID>     <UpdatePreferencesCard /> <VersionManagementCard /> </>}
```

`running` is `installing || rebooting` only. **Download and verify leave the page whole** — there
is nothing dangerous about a file sitting in `/tmp`, and unmounting three cards to say so would
be theatre. Only a run that is actually replacing files clears the surface down to the band and
the anchor.

| State | Reached when | Treatment |
| ----- | ------------ | --------- |
| **Loading** | `isLoading` — before the first read settles | Band tile skeletons, `AnchorCardSkeleton`, `NotesCardSkeleton`. The action pill is a `SKELETON.ACTION` placeholder, without which the header jumps by 42px plus its gap |
| **Unreachable** | `error && !updateInfo` | `ConditionBlock tone="destructive"`, `ServerOffIcon`, `role="alert"`, with a retry, plus the raw error beneath it in `ERROR_STATE.DETAIL` (mono) |
| **Check failed** | a failure with data in hand | The page stays whole; the anchor card carries a destructive `NOTICE` with the backend's own sentence |
| **Empty — no changelog** | no `changelog` / `current_changelog` | `ConditionBlock tone="neutral"`, `FileTextIcon` — never a blank panel |
| **Empty — no versions** | `available_versions` is `[]` | `ConditionBlock tone="neutral"`, `PackageOpenIcon` |
| **Save failed** | a preference write returned a message | A card-scoped destructive `NOTICE`, plus a toast. Never the page-level error |

Every skeleton wears the loaded view's own box constant. `AnchorCardSkeleton` renders inside the
real `CARD_SHELL_HERO`, `DELTA.ROOT`, `LADDER.GROUP` and `NOTICE.BOX`, so its height *resolves*
to the loaded card's rather than being asserted as a number that can drift. The ladder's
placeholder is four rows because the ladder is always four rows.

### Motion

One page cascade: `staggerContainer` on `PAGE_ROOT` with `initial`/`animate` declared once, and
`staggerItem` on the header, the band section and each card. Row-level stagger inside the ladder
and the tile grid uses `staggerRows` / `staggerRowItem`.

The loaded group is wrapped in a `motion.div` with `display: contents` that declares its **own**
`initial`/`animate`. That is not redundant. A variants-only child that mounts after its parent's
clock has already run waits forever at `opacity: 0` — a full-height blank region, no error, every
gate green. This group mounts on the skeleton-to-data swap, which is exactly that boundary. See
the same trap recorded in [`system-settings.md`](./system-settings.md).

Both dialogs write their two directions separately via `DIALOG_MOTION`, because Radix holds
`pointer-events: none` on the body for the whole exit and an unqualified emphasized close buys
800 ms of dead clicks.

---

## The file map

| File | Owns |
| ---- | ---- |
| `software-update.tsx` | The shell: the one `resolveView` call, the cascade root, the interrupted banner, the version select's state (so the banner can drive it), and the staged-install confirm |
| `shapes.ts` | Every geometry string, control height, tone map, face and skeleton line box on this surface |
| `derive.ts` | `UpdateView` and every function that turns a payload into a state. Pure — no React, no class strings |
| `page-header.tsx` | The title and the page's one verb, resolved from the view in a single switch |
| `status-band.tsx` | Three tiles, the band head chip, and the 15-second clock behind "Checked N ago" |
| `update-card.tsx` | The anchor: delta strip, ladder mount, consequence notice. `NOTICE_COPY` and `SHOWS_NEXT` are `Record<UpdateView, …>`, so a new view cannot reach the slot undecided |
| `step-ladder.tsx` | The four rows and their tone transitions |
| `release-notes-card.tsx` | The markdown panel, its full-notes dialog, and the next-vs-installed changelog choice |
| `update-preferences-card.tsx` | Two switches, their own error notice, and the inert time constant |
| `version-management-card.tsx` | The version select, its Install button, its confirm dialog, and the per-build size |
| `card-skeleton.tsx` | The anchor and notes placeholders, both wearing real boxes |

**`shapes.ts` RESTATES the family's numbers rather than importing them.** A sibling shape module
is not a shared library; the *design system's numbers* are. `components/system-settings/shapes.ts`
holds the same 104px tile, the same 42px pill, the same focus ring — and this module declares its
own copies rather than importing them.

### Two invariants a reviewer will otherwise "correct" back

**The focus gap takes the HOST's ground.** The ring is one geometry (`FOCUS_RING_BASE`) with three
grounds: `FOCUS_RING` on the page canvas, `FOCUS_RING_ON_SURFACE` on a card or dialog panel,
`FOCUS_RING_ON_CONTAINER` inside a row group. A single page-coloured gap is invisible in light
mode and a visibly darker halo in dark, where the canvas is 0.12 against a 0.17 card and a 0.20
row group. `components/ui/banner.tsx` solves the same problem per tone. Where a primitive ships
its own gap (`switch.tsx`, `button.tsx`, `select.tsx` all hardcode the canvas), the call site
passes the host's constant and `twMerge` drops the primitive's — verified in the browser: the
switch keeps only `focus-visible:ring-offset-surface-container`, and a keyboard-focused notes
panel paints a 2px gap in `--surface` under 3px of `--ring`.
**The status band is NOT a live region.** Its Latest tile re-reads the wall clock every 15s
(`CLOCK_TICK_MS`), so an `aria-live` there re-announces "5 minutes ago" at every rollover — noise
with no state change behind it. The ladder carries the run's `aria-live`, the notices carry
`role="alert"` / `role="status"`, and a save reports through a toast. The band keeps `aria-busy`
only.

> ⚠️ WARNING: nothing under `components/system-settings/software-update/` may import a shape from
> a sibling family, and no sibling family may import from here. The two shared things this family
> *does* import are `components/system-settings/condition-block.tsx` (a component, not geometry)
> and `lib/motion.ts` (the motion scale's single source of truth).

`ConditionBlock` gained an optional `detail` slot for this surface: the unreachable state's raw
device text renders *inside* the block, because a paragraph beside a `role="alert"` is not part of
what the alert announces. Every other caller passes nothing and is unchanged.

Note the divergence from `logs.md`'s family module, which *re-exports* twenty names from
`components/system-settings/shapes.ts`. That is the same rule reaching a different answer: Logs
imports from its own family one level up, which is legal; this module found it cheaper to restate
because it uses a different card shell (`CARD_SHELL_HERO`) and a different field grammar.

---

## Out of scope

Deliberately untouched by this pass, and not to be picked up incidentally:

- **`scripts/www/cgi-bin/quecmanager/system/update.sh` and the whole OTA pipeline** —
  `qmanager_update`, `qmanager_auto_update`, `qmanager_auto_update_arm`, the timer units, the
  sudoers rules, the installer. See
  [`qmanager-independence.md`](./qmanager-independence.md) for the pipeline itself.
- **The hook's fetch, poll and navigation logic.** The types gained two fields and `derive.ts`
  gained helpers; behaviour did not change. The 2 s poll cadence stays.
- **The reboot handoff** (above).
- **`installUpdate`** — exported from the hook, POSTs the legacy one-step `action=install`, and
  has **zero consumers** product-wide. A known, deliberately-deferred cleanup. The CGI's own
  `install` action is *not* dead; the auto-updater uses it.
- **The CGI's `rollback` action** — reachable from no client anywhere in the tree. Same
  deferral.

---

## Known residue

- **`version-management-card.tsx` pins two class strings locally** instead of in `shapes.ts`,
  each now lifted into `SELECT_ITEM` as `CHIP_GLYPH` and `HOST`, keeping their one-line reason.
  - A chip-glyph ink pin. `select.tsx` carries a descendant selector that repaints any `svg`
    inside a `SelectItem` that has no explicit text-colour class, so a `Badge`'s glyph inside the
    dropdown loses its container ink and turns muted. The pin re-asserts the current ink.
  - A host rule giving `SelectItem`'s last child room to grow. Radix's `ItemText` span
    shrink-wraps as a flex item, which leaves `SELECT_ITEM.META`'s auto left margin no slack to
    push against, so the state chips sit against the version tag instead of at the right edge.
- **The three cards below the anchor unmount during install.** `AnimatePresence` is not wired for
  their exit — they simply stop rendering. That is intentional (no exit animations on this
  surface) but it does mean the transition into a run is a cut, not a fade.
- **The band's Latest tile and the anchor chip both derive from `view`** but through different
  maps (`latestState()` → `LATEST_FACE`, and `ANCHOR_CHIP` directly). They cannot disagree about
  *state*, only about tone vocabulary — the tile has a `neutral` disc for never-checked where the
  chip uses `muted`. That is a deliberate split (a disc is a fill, a chip is a role) and not
  drift.

---

## i18n

137 leaves under `software_update.*` in the `system-settings` namespace, across all five packs
(`en`, `zh-CN`, `zh-TW`, `it`, `id`). The surface it replaced called `t()` **zero** times.

Subtrees: `page`, `actions`, `band`, `card`, `delta`, `steps`, `notice`, `notes`, `preferences`,
`versions`, `banner`, `states`, `time`, `toast`.

- **Relative ages are keyed, not concatenated.** `formatRelativeTime()` in `derive.ts` takes `t`
  as an argument and resolves `software_update.time.*`, with `_one` variants for the singular.
  It also takes `nowMs` as an argument rather than reading the clock — a render-time clock read
  is impure, and the caller owns the 15-second tick.
- **`card.*` and `card.chip.*` are keyed by view name**, one entry per union member. A new view
  therefore fails `i18n:check` rather than rendering a raw key.
- **Casing lives in the class** (`EYEBROW` carries `uppercase`), never in a leaf. Casing in
  content does not translate.

> ⚠️ WARNING: the locale packs are **CRLF**. A naive `JSON.parse` → `JSON.stringify` round-trip
> rewrites every line ending and produces a whole-file diff. `bun run i18n:check` is a hard gate
> and exits 1 on a missing key or an empty value; it cannot see a hardcoded English literal, so
> grep for those by hand. See [`i18n.md`](./i18n.md).

---

## Related

- [`system-settings.md`](./system-settings.md) — the route index, the shared family module, and
  the same shared-error defect recorded on `useSystemSettings`
- [`logs.md`](./logs.md) — the sibling sub-route that took the canon pass first; the structural
  model for this family's band and shape module
- [`qmanager-independence.md`](./qmanager-independence.md) — the OTA pipeline, the auto-update
  timer's arming, and the `qmanager_auto_update_arm` root helper
- [`scheduled-timers.md`](./scheduled-timers.md) — why every timer on this device is a systemd
  timer, and the 1970 boot window the auto-update timer has to survive
- [`ip-passthrough.md`](./ip-passthrough.md) — the same three-line reboot handoff on the other
  route that restarts the modem
- [`icon-system.md`](./icon-system.md) — the route-scoped lucide/Material boundary
- [`i18n.md`](./i18n.md) — the translation gate
- [`tailwind-prose-hazard.md`](./tailwind-prose-hazard.md) — why this doc describes bracketed
  utility spellings in words instead of quoting them
