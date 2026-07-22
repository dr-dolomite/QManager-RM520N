# i18n Runtime Download — Increment B Plan (handoff)

**Status: IMPLEMENTED** (v0.1.13-draft). Increment B — the device-side runtime
downloader that installs published packs onto a live RM520N-GL without a firmware
update — is built and validated. This document is retained as the **historical
design record**; the authoritative as-built reference is the
[Runtime downloader (Increment B)](./i18n.md#runtime-downloader-increment-b)
section of `i18n.md`. Increment A (the contributor pipeline — `bun run lang`,
`lib/i18n/pack.ts`, parity CI, `language-packs/manifest.json`) shipped earlier under
the same draft.

> ℹ️ NOTE: The plan below is preserved as originally written. Several decisions
> changed during implementation — see **[As-built deviations from this plan](#as-built-deviations-from-this-plan)**
> at the bottom before treating any detail here as current.

---

## As-built deviations from this plan

The implementation diverged from this plan in four notable ways. Where they
conflict, the as-built (and `i18n.md`) wins:

1. **OTA survival = re-copy, not symlink.** The plan recommended a `www/locales-packs`
   symlink into the persistent store. As built, `install_frontend()` **re-copies**
   each persistent-store pack into `www/locales-packs/` after the wipe
   (`scripts/install_rm520n.sh:913-923`). This avoids the contested lighttpd
   `server.follow-symlink` dependency entirely.
2. **No systemd boot oneshot.** The plan's alternative was a boot-time oneshot unit.
   As built there is **no new unit** — the re-copy rides the installer that already
   runs on every OTA, and the worker writes the served copy directly at install time
   for immediate availability. Zero new systemd surface.
3. **Concurrency = kernel `flock` on fd 9, not a PID file.** The plan called for a
   PID file + `kill -0` guard. That design proved structurally racy (a real TOCTOU
   window, exploitable under parallel requests), so it was replaced with a kernel
   `flock` held across the double-forked worker's lifetime via the inherited open
   file description — matching the `qcmd` / `sms_alerts.sh` precedent.
4. **Tar hardening gained a member-TYPE check.** The plan hardened against `..` /
   absolute / non-allow-listed **names** only. During validation a symlink smuggled
   in under an allow-listed name (`common.json` → `/etc/passwd`) was found to bypass
   the name check. The as-built `lp_extract_tarball_safe` additionally rejects any
   member that is a **symlink or hardlink** (via the ` -> ` marker in `tar -tvzf`
   output), checked before the column-1 type check.

Two smaller notes: the served copy is written by a narrow root helper
(`qmanager_language_pack_apply`, one bare-path sudoers line) rather than the worker
writing the store directly (the store is root-owned); and the frontend gained a
cold-boot fallback fix (`resolveInitialLanguage` returning `{initial, pendingDownloaded}`)
so a persisted non-bundled `qmanager_lang` no longer silently boots into English.

---

## Goal

Let a user install a community language pack (published by a maintainer to the
project's GitHub release) from the QManager UI, at runtime, and have it:
- persist across reboots **and** across OTA firmware updates,
- load into the running app without a page reload where practical,
- fall back to English for any untranslated string,
- verify integrity (sha256) before it is ever loaded.

This is the *delivery* half of RM551E parity. The *authoring* half is done.

---

## Decisions already locked (do not relitigate)

- **Phased:** contributor pipeline first (done), downloader second (this doc).
- **Trust root = the project's own GitHub release only, maintainer-reviewed.**
  Packs are published by a maintainer via `bun run lang publish` to the persistent
  release tagged `language-packs` (`--latest=false`, out of the OTA feed). No
  arbitrary third-party pack URLs. This keeps the trust boundary identical to OTA
  and is what makes `escapeValue:false` safe to keep (see Security).
- **No `i18next-http-backend`, no `languagedetector`.** The hard invariant holds.
  Injection uses `i18n.addResourceBundle(lng, ns, json)` on fetched JSON, inside
  the existing client-only `useEffect`. Do NOT reintroduce the forbidden plugins.

---

## Live device facts (verified this session via Posh-SSH, read-only)

| Fact | Evidence | Implication |
|------|----------|-------------|
| GitHub egress works from the control plane | `curl -sSI https://github.com` → `200`; DNS resolves; real GNU `curl 8.12` + OpenSSL 1.1.1l with https | Runtime download is viable |
| `/usrdata` has ~98 MB free (shared `ubi2_0`) | `df -h /usrdata` → 98.2M free / 123.7M | Space is not a constraint (5 langs ≈ 274 KB gz) |
| Web root = `/usrdata/qmanager/www/`, `.json` already MIME-typed | `lighttpd.conf` `server.document-root`; mimetype.assign | Served locale path is `/locales/<lang>/<ns>.json` |
| **OTA wipes web root except `cgi-bin`** | `scripts/install_rm520n.sh:901-908` (`install_frontend`) rm -rf's every child of `$WWW_ROOT` except `cgi-bin`, then re-copies `out/*` | **Packs under the web root DIE on every OTA.** This is the central constraint |
| `/usrdata/qmanager/` persists across OTA | live listing; only `www/` children (except cgi-bin) are wiped | A pack store OUTSIDE `www/` survives OTA |
| `tar` is BusyBox 1.31.1 | `tar --version` | Weak traversal defenses → **extraction hardening is mandatory** |
| `sha256sum` + `openssl` present | `which sha256sum openssl` | Integrity verification feasible on-device |

---

## Architecture

### 1. Persistent pack store + OTA re-link (Tier-4 — the hard part)

- Store installed packs at **`/usrdata/qmanager/locales-packs/<code>/`** (outside the
  OTA-wiped `www/`). Each dir holds the namespace JSONs + a copy of `_pack.json`.
- The app fetches packs from a served path under `www/`. Two options — pick one:
  1. **Symlink** `www/locales-packs -> /usrdata/qmanager/locales-packs` and re-create
     the symlink in `install_frontend` after the wipe (one line, but symlink-under-
     lighttpd needs `server.follow-symlink` verified).
  2. **Re-copy** packs into `www/locales/<code>/` on every boot via a tiny oneshot
     systemd unit (or an install-time hook) that reads the persistent store.
  Recommendation: symlink + a re-link step in `install_frontend` — least moving parts.
  Either way this is **new installer surface** → `installer-safety-auditor` is a
  HARD Phase 1 gate before code, and a Phase 5 verify.
- The `install_frontend` wipe loop at `install_rm520n.sh:901-908` must learn to
  preserve (or re-create) the pack link/store. This is the single riskiest edit.

### 2. Download worker (CGI + detached shell)

Port RM551E's shape (recon in the RM551E project confirmed the pattern) but adapt
for lighttpd/systemd/Entware:
- CGI endpoints under `scripts/www/cgi-bin/quecmanager/system/language-packs/`:
  `list.sh` (GET installed + remote manifest), `install.sh` (POST {code} → 202,
  double-fork worker), `install_status.sh` (GET progress), `install_cancel.sh`,
  `remove.sh`. Validate as **www-data**, not root.
- Worker (`/usr/bin/qmanager_language_install`): fetch manifest → find pack → disk
  pre-flight (`df /usrdata` vs size_bytes) → `curl -sSfL` the tarball → **sha256
  verify against the manifest digest** → extract → **validate tree** → atomic
  `mv` into the persistent store → write progress JSON throughout, honor a cancel
  sentinel between steps.
- Concurrency guard via a PID file + `kill -0` (409 if an install is live).

### 3. Extraction hardening (mandatory — BusyBox tar)

BusyBox 1.31.1 tar has weak path-traversal defense. Before/at extraction:
- Reject any archive member whose name contains `..`, starts with `/`, or is not
  in the expected set (`_pack.json` + the known namespace files from `_pack.json`'s
  `namespaces[]`). Extract to a staging dir, validate, then atomic-move.
- Cap pack size (manifest `size_bytes` + a hard ceiling) before download.
- `busybox-portability-checker` gates all of this.

### 4. Runtime injection (frontend)

- Extend `lib/i18n/available-languages.ts` / the catalog so a downloaded (non-bundled)
  language can appear. The `bundled` field + `BUNDLED_CODES` seam already exists.
- On language switch to a downloaded code: fetch `/locales-packs/<code>/<ns>.json`
  for each namespace (via `authFetch`), call `i18n.addResourceBundle(code, ns, json,
  true, true)`, then `changeLanguage(code)`. All inside the client-only provider.
- **New state to handle** (does not exist today — `config.ts:resolveDetectedLanguage`
  assumes catalog membership ⟺ resources present): a persisted `qmanager_lang`
  pointing at a pack that is absent/failed/wiped. Add states available / downloading /
  downloaded / failed / stale and a clean fallback to `en`.
- Consider `returnEmptyString:false` if a partial pack is ever bundled; downloaded
  packs already have empties stripped at build, so fetched packs are safe as-is.

### 5. UI (management card)

Extend `components/i18n/language-settings.tsx` (`/system-settings/languages`) into
an install/remove manager: Installed vs Available (from the manifest), per-pack
completeness %, install progress (poll `install_status.sh`), remove, and the
"active language being removed → switch to en first" guard from RM551E.

---

## Security

- Trust root = own release → same as OTA. Keep `escapeValue:false` ONLY under this
  assumption. If arbitrary URLs are ever allowed, a full render-site XSS audit of
  every `t()`/`<Trans>` sink becomes mandatory first.
- sha256 verify BEFORE extraction and BEFORE load. Reject on mismatch.
- Manifest is fetched over TLS from the project repo/release only.

---

## Schema (already shipped in Increment A — consume, don't redefine)

- Pack `_pack.json` and manifest entry: see `language-packs/README.md` and
  `types/i18n.ts` (`PackMeta`, `RemoteManifest`, `RemoteManifestEntry`).
- `pack_format` / `manifest_version` / `app_min_version` are the compatibility
  gates the downloader must honor (reject packs newer than it understands; warn
  when `app_min_version` > firmware).

---

## Tier & flow

**Tier 4** (installer + `/usrdata` layout + systemd + CGI + hook + component).
Full 6-phase flow. Phase 1 gates: `modem-investigator` (re-verify device facts
above are still current) **and** `installer-safety-auditor` (BLOCKS before code).
Phase 5: `busybox-portability-checker` (tar hardening, CGI shell) + `installer-
safety-auditor` verify. Validate CGI as www-data. No in-flight reboot.

## Open questions to resolve at Phase 1

1. Symlink vs re-copy for OTA survival (verify lighttpd `follow-symlink`).
2. Exact `install_frontend` edit to preserve the pack link without regressing the
   wipe's purpose (stale-frontend cleanup).
3. Where the manifest is cached on-device and its TTL (GitHub raw caches ~5 min).
4. Whether to auto-refresh installed packs when a newer version appears in the
   manifest, or keep it manual.
