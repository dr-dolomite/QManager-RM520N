# TTL & MTU

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

> The `/local-network/ttl-settings` page: rewrite the hop count on outbound cellular packets (IPv4 **TTL**, IPv6 **Hop Limit**), and override the **MTU** — the largest packet the cellular interface will send without fragmenting — on every `rmnet_data*` interface.

**Short version:** TTL rewriting is how a tethered device stops looking tethered. Every router that forwards a packet decrements its TTL (Time To Live) by one, so a carrier can count hops and tell "this packet came from the phone" apart from "this packet came from a laptop behind the phone". Pinning the outgoing TTL to a fixed value erases that difference. MTU is a separate knob that happens to live on the same page because both are per-packet properties of the same cellular interface.

## Quick Reference

| Item | Value |
| ---- | ----- |
| Route | `app/local-network/ttl-settings/page.tsx` (thin re-export) |
| Components | `components/local-network/ttl-mtu-settings/` — `shapes.ts`, `ttl-mtu-strip.tsx`, `ttl-settings-card.tsx`, `mtu-settings-card.tsx`, `ttl-settings.tsx` (shell) |
| Hooks | `hooks/use-ttl-settings.ts`, `hooks/use-mtu-settings.ts` |
| CGI (TTL) | `scripts/www/cgi-bin/quecmanager/network/ttl.sh` |
| CGI (MTU) | `scripts/www/cgi-bin/quecmanager/network/mtu.sh` |
| Shared lib | `scripts/usr/lib/qmanager/ttl_state.sh` |
| Boot units | `scripts/etc/systemd/system/qmanager-ttl.service`, `qmanager-mtu.service` |
| Root helper (MTU) | `scripts/usr/bin/qmanager_mtu_apply` |
| Persisted TTL state | `/etc/qmanager/ttl_state` (plain `TTL=`/`HL=` key-value, www-data-writable) |
| Persisted MTU state | `/etc/firewall.user.mtu` (a list of `ip link set …` commands) |
| i18n root | `ttlMtu.*` in `public/locales/<loc>/common.json` (62 leaves × 5 locales) |
| Harness | `scripts/test/local-network-settings-design-language.sh` |

## Where each value comes from

| Value | Source | Notes |
| ----- | ------ | ----- |
| TTL / HL | **live `iptables` / `ip6tables` mangle rules** | `ttl_state_read_live` greps `TTL set to <N>` / `HL set to <N>` out of `-t mangle -vnL POSTROUTING`. The GET never reads the file |
| `is_enabled` (TTL) | derived: `ttl > 0 || hl > 0` | 0 means "no rule", not "a rule setting zero" |
| MTU | **`ip link show <wan>`** | the WAN interface is resolved at runtime, see below |
| `is_enabled` (MTU) | `[ -f /etc/firewall.user.mtu ]` | file presence, not a value comparison |

### The rules the backend actually installs

```sh
iptables  -t mangle -I POSTROUTING -o rmnet+ -j TTL --ttl-set <ttl>
ip6tables -t mangle -I POSTROUTING -o rmnet+ -j HL  --hl-set  <hl>
```

`rmnet+` is a wildcard: the cellular WAN does not live on a fixed `rmnet_dataN`. `ttl_state_apply` **drains before it inserts**, in a bounded 32-pass loop per family — `iptables -D` removes one matching rule per invocation, so a single delete would leave duplicates from a past racy apply or a boot-plus-CGI double-apply, and a duplicate lies to the next `read_live`.

A value of `0` is "remove the rule", not "set TTL to zero" — the insert is skipped entirely.

### `resolve_wan_interface()` — why the MTU read is not `rmnet_data0`

`mtu.sh` walks a four-step ladder, most authoritative first: the default route's device → the first `rmnet_data*` holding a global-scope address → the first with `carrier=1` → `rmnet_data0` as a legacy-preserving fallback.

**Why:** the channel index migrates across attach cycles. Measured live — the modem was attached on `rmnet_data1` (the only interface up, holding the address and the default route) while `rmnet_data0` sat down with no address but non-zero `/proc/net/dev` counters, i.e. it had been the WAN earlier in the same boot. Hardcoding index 0 reported the MTU of a downed interface, and only looked correct because both happened to read 1500.

> ℹ️ NOTE: `detect_active_cid()` in `cgi_at.sh` cannot help here. It resolves a PDP **context ID**, and neither `+CGPADDR` nor `+QMAP` carries a Linux interface name — there is no CID→interface mapping anywhere in the codebase, and the `+QMAP` mux id matching `rmnet_dataN` today is coincidence, not a contract.

The `POST` writes one `ip link set <iface> mtu <n>` line per `rmnet_data*` into `/etc/firewall.user.mtu` (temp file + `mv`) and applies them immediately. `{"mtu":"disable"}` removes the file and reverts to the carrier-negotiated value. Accepted range is **576–9000**, validated at the CGI.

## Page anatomy (re-authored 2026-08-31)

The composition is the one `/local-network/ethernet` landed on (`2511953`) and `/local-network/traffic-engine` adopted (`0fdfc65`):

**page header + Refresh pill → Band A (live read-only tiles) → Band B (write cards).**

`ttl-settings.tsx` is the data shell — it owns *both* hooks, the shared Refresh, the derived band state and the motion cascade. `ttl-mtu-strip.tsx` is Band A. `ttl-settings-card.tsx` and `mtu-settings-card.tsx` sit side by side in Band B (`@4xl/main:grid-cols-2`). Every geometry string, tone, control height and skeleton line box comes from `components/local-network/ttl-mtu-settings/shapes.ts`.

> ⚠️ **`shapes.ts` is this family's own module. Restate geometry in it; never import a shape from `components/cellular/` or from a sibling `/local-network/` family.** Anything genuinely family-wide belongs one level up, not cross-imported sideways.

The route is **lucide**, per the Icon-Boundary Rule (`icon-system.md`).

### Two endpoints, two pending flags

The band spans `ttl.sh` and `mtu.sh`. They are separate CGI scripts on separate transports and **they fail independently** — the TTL read can land while the MTU read is still in flight, or one can 500 while the other is healthy.

The strip therefore takes `ttlPending` and `mtuPending` as distinct props, and each tile's caption is chosen from the flag belonging to *its own* endpoint (`caption_pending` vs `caption_unread`).

> ⚠️ **Do not collapse these into one page-level `isLoading`.** That is how a tile ends up captioned "the modem hasn't answered" over a request that is still in flight — a confident statement about a question that has not been asked yet. The skeleton only replaces the whole grid when neither endpoint has answered *and* at least one is still pending; once either lands, the grid renders and the un-landed tile explains itself.

### Band A — three tiles, not four

| Tile | Value | Caption |
| ---- | ----- | ------- |
| TTL (`RouteIcon`) | the live IPv4 TTL, or `—` | active / idle / pending / unread |
| Hop limit (`WaypointsIcon`) | the live IPv6 HL, or `—` | active / idle / pending / unread |
| MTU (`PackageIcon`) | the figure plus a `bytes` `Tag`, **only when the read succeeded** | active (naming the carrier default) / idle / pending / unread |

Tile bodies are neutral; the only colour is the 52 px disc, tinted `success` when that value is actively overriding and neutral otherwise. The band header carries a `custom` / `default` status chip, gated on a landed read — the chip is a property *of* the reading, so with no reading there is nothing for it to be a property of.

Two whole-band substitutes replace the grid rather than repeating a message three times: an `unavailable` `NoticeTile` with a Retry action when neither endpoint answered, and an `idle` `NoticeTile` when both endpoints answered and nothing is in force.

### The three-tile decision: `autostart` is deliberately NOT rendered, and the harness bans it

`ttl.sh` returns a fourth field, `autostart`, and the approved design drew it as an "ON REBOOT → Reapplied / Nothing set" tile. It was measured and dropped. **Rendering it is now a test failure**, not merely discouraged.

The chain:

- `ttl.sh:48-51` sets `autostart` from `svc_is_enabled "$TTL_INIT"`.
- `svc_is_enabled` (`platform.sh:130-133`) is exactly `[ -L "$_WANTS_DIR/$unit" ]` — does the boot symlink exist. Nothing more.
- `install_rm520n.sh:3106-3161` globs **every** `qmanager-*.service` and symlinks it into the wants directory, skipping only units with no `[Install]` section (`qmanager-auto-update`, `qmanager-scenario-schedule`, `qmanager-scheduled-reboot`, the two tower-schedule units) and the four config-gated services in `UCI_GATED_SERVICES` (`:118`). `qmanager-ttl` is in neither list.

So every install and every OTA re-creates the symlink, and the field is `true` on every device, forever. A constant rendered as a reading is worse than no tile.

It is also **not sufficient** for what the tile claimed. `qmanager-ttl.service` carries `ConditionPathExists=/etc/qmanager/ttl_state`, and `ttl_state_write_persisted` (`ttl_state.sh:119-122`) **deletes** that file when `ttl` and `hl` are both 0. A fresh device is `autostart:true` with nothing to reapply — the tile would have read "Reapplied" while nothing was set.

> ℹ️ NOTE: this is *not* the `systemctl is-enabled` trap recorded in project memory. `svc_is_enabled` tests the symlink directly rather than asking systemd, precisely because the wants-symlinks live under `/lib` and systemd-239 does not count them.

> ⚠️ **Open item, not fixed here.** `qmanager-ttl.service` places `ConditionPathExists=` in its **`[Service]`** section. systemd's `Condition*=` directives are `[Unit]`-section options — `qmanager-ethernet.service` puts its own in `[Unit]` for exactly this reason (see [`ethernet.md`](./ethernet.md)). The condition is therefore very likely inert on-device, meaning the unit runs its `ExecStart` on every boot even with no state file, where `ttl_state_read_persisted` returns `0 0` and `ttl_state_apply 0 0` is a drain. Harmless, but it is not what the file says it does. **Not verified on hardware** — settling it needs a boot with no `/etc/qmanager/ttl_state` and a check of `systemctl status qmanager-ttl` for `inactive` (condition honoured) vs `active (exited)` (condition ignored).

### The MTU tile draws no figure without a successful read

```sh
current_mtu=$(get_current_mtu)
current_mtu=${current_mtu:-1500}      # mtu.sh:96-97
```

A failed interface read and a genuine 1500 arrive at the frontend **identically**. There is no field on the response that separates them.

The band therefore gates the figure on whether the endpoint answered at all (`mtuReady`), and its caption states *provenance* rather than claiming a measurement. When the read has not landed, the tile shows `—` and says so, instead of printing the most common MTU in the world as if it had been observed.

> ⚠️ **Open item, deliberately out of scope.** Closing this properly needs a backend field reporting read status — something like `read_ok` on the GET, emitted with `--argjson` so it arrives as a boolean and not a truthy `"false"` string, and read as *absent ⇒ true* for backward compatibility (the pattern `ethernet.sh`'s `interface_present` established). That is a CGI change, and this pass was frontend-only.

### Provenance: `/etc/qmanager/ttl.conf` does not exist

The approved mock's provenance line named `/etc/qmanager/ttl.conf`. There is no such file. The TTL card's line now reads *"Read from the live packet rules, replayed at boot from `/etc/qmanager/ttl_state`"*, which is what actually happens: the **GET reads the live mangle rules**, and the file is only the boot replay source.

A provenance line naming a file that is not there is the same defect class as the honesty bugs this pass closed, which is why it is called out rather than quietly corrected.

**The MTU card deliberately names no file at all.** Its provenance is *"Applied to every interface matching `rmnet_data*`"* — the glob, in `font-mono`. `/etc/firewall.user.mtu` exists and is the boot replay source, but the GET never reads it for a value; it only tests its **presence** for `is_enabled`, and reads the figure from `ip link`. Naming the file would imply the number came from it. Naming the interfaces is the honest answer to "where did this number come from".

On both cards the provenance slot **does two jobs in one line**: when the form cannot be applied, Apply goes dead and the slot becomes the specific refusal reason in destructive ink. "Why can't I press this" and "where did this come from" are asked in the same glance, and growing a second line would push the button out from under the cursor at the exact moment it is refused.

### Band B — the two write cards

Both are peer cards (`rounded-card`, `border-0`, `shadow-[var(--shadow-whisper)]!`), plain `CardTitle` + `CardDescription` with no icon, holding one `ROW_GROUP` of `ROW`s. **Every row carries a required consequence sentence** and it changes with the row's condition — a control that cannot currently work explains why instead of sitting there dead.

| Card | Rows |
| ---- | ---- |
| TTL & Hop Limit | `rewrite` (master toggle), `ttl_value` (`IPv4` tag), `hl_value` (`IPv6` tag) |
| Maximum transmission unit | `mtu_toggle`, `mtu_value` |

The consequence copy names the real risk in plain language — *"Some carriers count hops to detect tethering"*, *"Below roughly 1400 can break path-MTU discovery on sites that drop ICMP"* — rather than restating the field label.

### Draft state is derived, never synced by effect

The obvious `useState<Draft>` + `useEffect(() => setDraft(server))` is a `react-hooks/set-state-in-effect` **error** under this repo's lint config, and it is also wrong on its own terms: every background re-read or Refresh press silently overwrites whatever the user has typed.

All three re-authored families instead hold `Partial<Draft>` **edits** overlaid on a memoised baseline, so a refresh re-bases the delta chips instead of erasing work. This matters most here, because this pass is what **added** the Refresh pill that would otherwise have put the data loss one click away.

The delta chip renders unconditionally and `invisible` when clean, so promoting a row moves nothing — the same reserve-don't-animate trade `SETTING_ROW` makes on `/cellular/settings`.

### `refresh` takes an argument, so it must always be wrapped

`use-ttl-settings.ts` returns `refresh: fetchTtl`, and `fetchTtl` is `useCallback(async (silent = false) => …)`. The `silent` flag suppresses the loading state for a background poll.

So `onClick={refresh}` hands React's `MouseEvent` straight to `silent` as a truthy value: a user-initiated refresh runs with its own spinner suppressed, and the button looks inert for the whole request. That form was live in the tree before this pass. The shell now wires `onClick={() => refreshBoth()}`, and the harness bans the bare form.

> ⚠️ **The compiler does not catch this here.** `UseTtlSettingsReturn.refresh` and `UseMtuSettingsReturn.refresh` are both still declared `() => void` (`use-ttl-settings.ts:41`, `use-mtu-settings.ts:39`), which is what makes the bare spelling type-check. Only `hooks/use-custom-dns.ts:104` took the fix — it declares `(silent?: boolean) => Promise<void>`, so on that surface the bare form is a build error rather than a lint-adjacent convention. **Open item:** widening the two TTL/MTU declarations (and `use-ip-passthrough.ts:60`) to match would make all four enforced by `tsc` instead of by one harness assertion.

### The silent no-op is gone

The retired card contained `if (isEnabled && ttl === 0 && hl === 0) return;` — the form was dirty so the Save button was live, the click did nothing, and the only feedback was a field error already on screen before the press. The harness bans **every spelling** that preserves the behaviour (`!ttl && !hl` included), not one literal string.

### The SIM-profile override banner

A custom SIM profile can carry `settings.ttl` / `settings.hl`. When the active profile sets either, the shell renders an `override`-role `Banner` above Band B and holds the TTL card, because activating that profile writes both values and two writers would fight. The remedy the copy offers is to change them in the profile, or activate a profile that leaves TTL unset. See [`sim-profiles.md`](./sim-profiles.md).

## Related

- [`ethernet.md`](./ethernet.md) — the reference implementation for this page grammar
- [`dpi.md`](./dpi.md) — the sibling `/local-network/` family, second reference
- [`custom-dns.md`](./custom-dns.md), [`ip-passthrough.md`](./ip-passthrough.md) — the other two surfaces re-authored in the same pass
- [`sim-profiles.md`](./sim-profiles.md) — the profile writer behind the override banner
