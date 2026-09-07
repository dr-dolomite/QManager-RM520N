# Web Console (`/system-settings/web-console`)

> **Applies to:** RM520N-GL (SDX65) · frontend re-authored onto the design canon 2026-09-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)
> Family: `components/system-settings/web-console/**` · namespace `public/locales/*/system-settings.json`, `web_console.*` subtree — all five packs define it, see "i18n" below

Web Console is a full interactive shell in the browser: a real `bash --login`
session running on the modem itself, reachable without SSH. It exists because
QManager already ships an SSH-capable device, but not every user has an SSH
client handy, and a browser tab is the one client every user already has open.

Unlike every other feature this project's `docs/reference/` describes, this one
has **no CGI script at all**. The "backend" is a native binary
([ttyd](https://github.com/tsl0922/ttyd), a small C program that wraps a PTY — a
pseudo-terminal, the same OS primitive a real terminal emulator or SSH session
talks to — in a WebSocket server) run as its own systemd unit, reverse-proxied by
lighttpd. The frontend speaks ttyd's binary WebSocket protocol directly and
drives an [xterm.js](https://xtermjs.org/) terminal emulator painted into the
page. Nothing here was touched on the backend by this pass; the systemd unit,
the shell script it execs, and the lighttpd proxy block are exactly as they were.

---

## Quick Reference

| Thing | Where |
| ----- | ----- |
| Route | `app/system-settings/web-console/page.tsx` (a five-line re-export) |
| Page shell | `components/system-settings/web-console/web-console.tsx` |
| Card | `components/system-settings/web-console/web-console-card.tsx` |
| Geometry + tone | `components/system-settings/web-console/shapes.ts` |
| Derivations | `components/system-settings/web-console/derive.ts` — imports `ConsoleFailureKind` from the hook, re-derives nothing |
| Live-theme reader | `components/system-settings/web-console/terminal-theme.ts` |
| WebSocket + ttyd protocol hook | `hooks/use-web-console.ts` |
| ttyd process unit | `scripts/etc/systemd/system/qmanager-console.service` — no `User=`, so it runs as **root** |
| The shell ttyd execs | `scripts/usrdata/qmanager/console/console.sh` — sets `PATH`/`HOME`/`TERM`, prints a banner, `exec /bin/bash --login` |
| Reverse proxy | `scripts/usrdata/qmanager/lighttpd.conf`, the `/console` block — WebSocket upgrade, no auth of its own |
| Socket endpoint | `wss://<host>/console/ws` (or `ws:` over plain HTTP) |
| Install | `qmanager_console_mgr install`, called from `install_rm520n.sh` — **non-fatal**: a failed ttyd download leaves the feature unavailable, not the install |
| Icon family | **lucide** — `/system-settings` is a lucide route, no Material Symbols here |

---

## This is ttyd behind lighttpd, not a CGI endpoint

`qmanager-console.service` runs:

```
ExecStart=/usrdata/qmanager/console/ttyd -i 127.0.0.1 -p 8080 \
  -t 'theme={"foreground":"#e4e4e7","background":"#09090b","cursor":"#e4e4e7"}' \
  -t fontSize=14 --writable /usrdata/qmanager/console/console.sh
```

bound to loopback only, port 8080. The unit has **no `User=` directive**, which
in a systemd `.service` file means the process inherits the default —
**root** — a fact `install_rm520n.sh`'s own comment states outright ("so it runs
as root"). `console.sh` sets a `PATH` that includes Entware's `/opt/bin`, sets
`HOME=/usrdata/root`, prints a two-line banner, and hands off to
`exec /bin/bash --login`. Every command typed into this terminal runs as root on
the modem, with the same privilege an SSH session using the device's own root
credentials would carry.

`lighttpd.conf` proxies the path with a WebSocket upgrade:

```
$HTTP["url"] =~ "(^/console)" {
    proxy.header = ("map-urlpath" => ( "/console" => "/" ), "upgrade" => "enable" )
    proxy.server = ( "" => ("" => ( "host" => "127.0.0.1", "port" => 8080 )))
}
```

There is no `scripts/www/cgi-bin/**` script anywhere in this path. Every other
feature this project documents reads a JSON envelope from a shell script; this
one opens a socket straight to a systemd-managed binary and stays open for the
life of the session.

**ttyd's own authentication is unused.** The hook's connect handshake sends
`AuthToken: ""` — an intentionally empty credential — because ttyd's built-in
auth is not how this feature is gated. Access control is upstream, at whatever
already sits in front of `/console`: the page itself is behind QManager's own
session cookie, the same as every other `/system-settings` route.

**Install is explicitly optional and non-fatal.** `install_rm520n.sh` downloads
the `ttyd` binary via `qmanager_console_mgr install` and, on failure, logs a
warning ("ttyd download failed — web console unavailable") and continues the
install rather than aborting it. A device that could not fetch ttyd — a slow
network, a GitHub outage during install — still gets every other feature; this
one page just renders its unavailable state forever.

---

## The xterm theme is read from the live page, not hardcoded

`terminal-theme.ts` exists because xterm.js parses its `theme` option as literal
CSS colour **strings**, using a parser written before `oklch()` existed — and
every colour token in this product is `oklch(...)`. Handing xterm an oklch string
is silently rejected; the terminal keeps whatever colour it already had, which
is how the pre-pass version ended up with four permanently-hardcoded hex values
that never noticed a light/dark switch.

The fix is to let the **browser** do the conversion instead of doing it by hand:
paint the resolved CSS custom property onto a 1×1 `<canvas>`, then read the pixel
back as sRGB.

```ts
function toHex(ctx, value) {
  ctx.fillStyle = SENTINEL;         // a colour no token could ever equal
  const before = ctx.fillStyle;
  ctx.fillStyle = value;            // if the browser rejects it, this is a no-op
  if (ctx.fillStyle === before) return null;   // rejection detected
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}
```

Assigning a colour the canvas context does not understand is a silent no-op in
the Canvas 2D API — `ctx.fillStyle` simply keeps its previous value rather than
throwing — which is why the function primes `fillStyle` with a sentinel colour
first and compares against it afterward, rather than trusting the assignment to
either succeed or visibly fail.

`readTerminalTheme(host)` reads `--on-surface` (foreground), `--surface-container`
(background — the same token the pane's own CSS background uses, so the terminal
and the box around it are one visual plane) and `--primary` (cursor) off a host
element via `getComputedStyle`, falling back to the pre-canon hardcoded hex
triplet if the canvas is unavailable or a token fails to resolve. It also forces
both of xterm's "white" rungs to the resolved foreground token, because a shell's
default ANSI white is close to `#ffffff` and invisible against a light theme's
pale background.

> ⚠️ **`readTerminalTheme` and `readTerminalFont` both require a `host`
> parameter** — an `HTMLElement` to call `getComputedStyle` on — and return the
> hardcoded fallback when it is missing. `web-console-card.tsx` passes the
> terminal's own container element at both of its two call sites (terminal
> construction and the theme-change effect), so both reads resolve against the
> live page rather than falling back.

**The systemd unit's own `-t 'theme=...'` flag is a second, independent copy of
roughly the same three colours**, and it is deliberately **not** kept in sync
with `terminal-theme.ts`. That flag styles ttyd's *own* built-in web UI — the
plain HTML page ttyd would serve if you hit port 8080 directly — which QManager
never renders; the product's UI is `web-console-card.tsx`'s own xterm instance,
mounted into a `<div>` on the QManager page, talking to ttyd purely over its
WebSocket protocol. The two copies happening to hold nearly the same hex values
today is coincidence, not a contract — nobody should ever "fix" a drift between
them by editing the systemd unit.

---

## Close-reason threading

The pre-pass hook discarded everything a `CloseEvent` carries beyond the fact that
it closed. The current `hooks/use-web-console.ts` keeps the code and reason and
turns them into a small discriminated result the UI can name:

```ts
export type ConsoleFailureKind = "unreachable" | "refused" | "dropped" | "ended";

export interface ConsoleFailure {
  kind: ConsoleFailureKind;
  code: number | null;
  reason: string;
}
```

| Kind | Means | Reached when |
| ---- | ----- | ------------ |
| `ended` | The shell exited on its own terms | A clean close (code `1000` or `1005`) on a socket that had actually opened, **or** a manual `disconnect()` call |
| `refused` | The server chose to close with a status of its own | Close code in `{1002, 1003, 1008, 1011, 1013}`, or any application-defined code `>= 4000` |
| `dropped` | A session was running and the link went away | Three rapid closes in a row, and at least one earlier attempt in this run had reached `OPEN` (or the browser reports `navigator.onLine === false`) |
| `unreachable` | The handshake never completed on any attempt | Three rapid closes in a row, and no attempt ever reached `OPEN` |

The comment beside the hook's `onclose` classification states the design
intent plainly: *"a status the server chose to send is a refusal; a schedule
cannot fix it"* — `refused` and `ended` closes stop retrying immediately and land
on a terminal state, while an unexplained close (the `1006` "no close frame at
all" code, or anything else not covered above) keeps retrying through the
rapid-failure ladder below until it gives up.

`ConnectionState` itself is a five-member union —
`"connecting" | "connected" | "disconnected" | "reconnecting" | "unavailable"` —
and `failure` is non-null only while the state is `disconnected` or `unavailable`.
`ended` and `unreachable` both land the state on `unavailable`; `refused` and
`dropped` both land on `disconnected`. **A clean shell exit and "ttyd was never
reachable" render as the same `ConnectionState`,** distinguished only by
`failure.kind` — a consumer that only checks `connectionState === "unavailable"`
cannot tell the two apart.

---

## The rapid-failure ladder

```
RAPID_CLOSE_WINDOW_MS = 2_000     // a close this soon after opening counts as "rapid"
MAX_RAPID_FAILURES    = 3         // this many rapid closes in a row gives up
BACKOFF_INITIAL_MS    = 1_000
BACKOFF_MULTIPLIER    = 2
BACKOFF_MAX_MS        = 10_000    // 1s → 2s → 4s → 8s → 10s, then flat
```

A close counts as "rapid" when the socket never reached `OPEN` at all, or reached
it less than 2 seconds before closing again. Three rapid closes in a row stop
auto-retry outright and settle on `disconnected` or `unavailable` (whichever
the `onclose` handler selects, per the table above); any close that is *not*
rapid resets the rapid-failure counter to zero, so a connection that has been
stable for a while gets a full fresh budget of three attempts if it ever does
start failing. **Refusal and clean-close codes bypass the ladder entirely** —
they settle immediately on their first occurrence, since retrying a close the
server chose deliberately, on a timer, cannot change the server's mind.

`reconnect()` — the manual action wired to the empty-state Retry button and the
`ConditionBlock`'s own retry — clears any pending timer, resets the rapid-failure
counter and backoff to their initial values, and calls `connect()` directly. A
connection stuck at `unavailable` after three rapid failures is not stuck
forever: a manual reconnect always gets a fresh three-attempt budget, regardless
of how many it burned through before.

`disconnect()` is exposed by the hook's return value but **is not called by any
component in the current tree.** It closes the socket, tears down the terminal's
`onData`/`onResize` listeners, and — surprisingly — settles on `kind: "ended"`,
`state: "unavailable"`, not `"disconnected"`. Nobody should infer a `"disconnected"`
state from a manual stop based on the name alone; as written, calling this action
renders identically to "the shell exited cleanly." Since nothing calls it today,
this is a fact about the hook's contract to record for whoever wires it up next,
not a behaviour anyone has observed on screen.

---

## The status chip and the failure tone map

`shapes.ts` keys the chip onto `ChipKey` — `derive.ts`'s union of the three live
states (`connecting` / `connected` / `reconnecting`) plus the hook's four
`ConsoleFailureKind` members — rather than onto `ConnectionState` directly, so
the badge and the failure cover underneath it are reading one classification,
not two:

```ts
export const STATE_CHIP: Record<ChipKey, ChipFace> = {
  connecting:   { variant: "info",        glyph: LoaderCircleIcon, spin: true },
  reconnecting: { variant: "info",        glyph: RefreshCwIcon,    spin: true },
  connected:    { variant: "success",     glyph: CheckCircle2Icon },
  unreachable:  { variant: "warning",     glyph: PlugZapIcon },
  refused:      { variant: "destructive", glyph: ShieldXIcon },
  dropped:      { variant: "destructive", glyph: WifiOffIcon },
  ended:        { variant: "muted",       glyph: PowerOffIcon },
};
```

`derive.ts`'s `chipCopyKey()` picks the key: a non-null `failure` always wins
and its `kind` becomes the chip's key, so a settled socket's badge already
names the same failure kind the cover below it is about to describe — only an
unsettled, still-live socket falls back to `connected` / `reconnecting` /
`connecting`. This is what let the old `disconnected` / `unavailable` pair
retire: those two said only *that* the socket had stopped, never *why*, which
is the same "two classifications of one event" problem the `FAILURE_FACE` fix
below closes. The comment on `STATE_CHIP` in source calls out that every one of
the seven faces carries its own glyph — `success-container` and
`warning-container` measure 1.03:1 apart, and `refused`/`dropped` share their
`destructive` fill outright, so the icon is the only channel that actually
separates them. This replaces the pre-pass status strip, which separated
"Connected" from "Disconnected" by dot **colour alone** — green versus red,
same shape, no glyph at all — a channel that carries no information under
deuteranopia.

`shapes.ts` also declares a `FAILURE_FACE` map, keyed directly onto the hook's
own `ConsoleFailureKind` — `satisfies Record<ConsoleFailureKind, FailureFace>`,
so a fifth member or a renamed one fails the build rather than drifting quietly:

```ts
export const FAILURE_FACE = {
  unreachable: { tone: "warning", glyph: PlugZapIcon },
  refused: { tone: "destructive", glyph: ShieldXIcon },
  dropped: { tone: "destructive", glyph: WifiOffIcon },
  ended: { tone: "neutral", glyph: PowerOffIcon },
} satisfies Record<ConsoleFailureKind, FailureFace>;
```

An earlier revision of this module declared its own five-member `FailureKind`
(`unreachable | ended | dropped | server | unknown`) with a `derive.ts`
function, `resolveFailureKind`, that tried to re-derive it from the hook's close
event — a second, independent opinion about why the same socket closed. That is
the "rival copies of one map" failure this project has hit before elsewhere
(the signal-quality ramp had four): two places classifying one event will
eventually disagree, and whichever one nobody is looking at drifts first. The
fix was to delete the second classifier rather than reconcile it — the hook is
the layer that actually reads the `CloseEvent`, so it is the only layer allowed
to name what happened. `derive.ts` now imports `ConsoleFailureKind` from the
hook and re-derives nothing; its own header comment states this as the rule for
the next person who touches either file.

---

## i18n

Every string on this surface is keyed under `web_console.*` in the
**`system-settings`** namespace, and all five packs define the subtree — page
title and description, the card's title/description, the chip copy per
connection state, the copy/paste/leave keyboard hints, both action button
labels, and every failure state's title/description.

Keys are built with template literals — `` t(`${K}.chip.${chipKey}`) `` — with
`K` a module constant. That shape matters for verification: **`i18n:check`
cannot see a template-literal key.** It compares each pack against the English
superset and never reads a call site, so a key the code calls that no pack
declares would pass the gate silently and ship a raw key string on screen. The
gate is necessary, not sufficient — the same blind spot recorded on the AT
Terminal page.

The dynamic segments resolve against their own source of truth:

| Segment | Resolved from |
| --- | --- |
| `chip.<key>` | `ChipKey` in `derive.ts` — the two live states plus the hook's four `ConsoleFailureKind` members |
| `states.<kind>.title` / `.description` | `ConsoleFailureKind` in `hooks/use-web-console.ts` |
| `states.close.<variant>` | `closeDetail`'s three-way `CloseDetail` key (`close.none` / `close.code` / `close.reason`) |
| `actions.<verb>` | `FAILURE_ACTION` in `derive.ts` |

---

## What the card's structure builds

The JSX in `web-console-card.tsx` assembles:

- A `CardHeader` with a plain `CardTitle`/`CardDescription`, a `CardAction`
  holding the `STATE_CHIP` badge, and a tools row underneath carrying the
  copy/paste keyboard hints (rendered at every width, replacing a pre-pass
  `lg:flex` that hid them on exactly the narrow, touch-adjacent screens where a
  paste shortcut is hardest to guess) plus the Clear and Fullscreen actions.
- A terminal pane that is **hidden, never unmounted**, when the connection has
  failed — the comment on the container's `hidden={failed}` prop states the
  reason: unmounting the host element would dispose the xterm session along with
  it, and a fresh instance on reconnect would lose scrollback.
- A `Skeleton` shown only in a `"loading"` view (before the socket has ever
  settled into a definite state), and a `ConditionBlock` cover — tone, glyph,
  title, description, a machine-voice `detail` line quoting the raw close code
  and reason, and a retry — shown over the pane once `view === "failed"`.
- A full-screen toggle that keeps the card mounted in place rather than
  navigating: `isFullscreen` swaps the wrapping `motion.div`'s class between the
  card's normal slot and a `fixed inset-0` overlay, with an animation-controls
  opacity crossfade (`[0.3, 1]`) on the swap rather than a snap, and an effect
  that calls `fitAddon.fit()` on a `requestAnimationFrame` after every toggle so
  xterm re-measures its now-different box. Escape exits full screen from the
  chrome around the terminal; xterm itself swallows Escape while it has focus, so
  a shell-side editor (`vi`, `less`) still receives the keypress normally.

---

## Related

- [`at-terminal.md`](./at-terminal.md) — the sibling console surface; shares the
  family's page shell and the two-source `shapes.ts` split
- [`system-settings.md`](./system-settings.md) — the route index and the shared
  family module both consoles import from
- [`qmanager-independence.md`](./qmanager-independence.md) — the "Web console"
  subsection covering ttyd's install/uninstall lifecycle at the product level
- [`i18n.md`](./i18n.md) — the translation gate and its blind spot for a key no
  pack declares
- [`icon-system.md`](./icon-system.md) — the route-scoped lucide/Material boundary
