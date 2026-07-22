# `language-packs/`

This directory holds the **canonical language-pack manifest** (`manifest.json`) — the index of downloadable translation packs for QManager.

## Why this lives outside `public/`

This directory is **intentionally outside the web root (`public/`)**. Two consequences we depend on:

- It is **never served to the browser** — the static export only publishes `public/`.
- It is **never wiped by the on-device OTA installer**, which replaces the web root wholesale on every firmware/app update. Keeping the manifest here means it survives an update.

## How packs are distributed

The manifest here is the source-of-truth copy in git. It is **also published as a release asset** on a persistent GitHub release tagged **`language-packs`**. That release is created with `--latest=false` so it stays **out of the OTA / firmware update feed** (the device's updater only follows the "latest" release) — it is a stable content bucket, not a firmware drop.

Language packs themselves are **`.tar.gz`** files. A maintainer publishes a pack (uploads the tarball, refreshes `manifest.json`, and pushes both to the `language-packs` release) via:

```
bun run lang publish <code>
```

The **future device-side downloader** (a later increment) will fetch this manifest, let the user pick a pack, download the tarball, verify its `sha256`, and unpack the namespace JSONs into the running app's locale directory.

## JSON schema

### Pack tarball

Each `.tar.gz` contains a `_pack.json` metadata file plus one JSON file per namespace (`common.json`, `sidebar.json`, …).

`_pack.json` fields:

| Field | Type | Purpose |
| --- | --- | --- |
| `pack_format` | int | Pack format version — lets the downloader reject packs it can't parse. |
| `code` | string (BCP-47) | Language code, e.g. `it`, `zh-CN`. |
| `native_name` | string | Language name in its own script, e.g. `Italiano`. |
| `english_name` | string | Language name in English, e.g. `Italian`. |
| `rtl` | bool | Whether the language is right-to-left. |
| `version` | string (`YYYY.MM.DD`) | Date-based pack version. |
| `app_min_version` | string | Minimum QManager app version this pack supports. |
| `namespaces` | string[] | Namespace names included in the pack. |
| `completeness` | object | `{ overall: number, per_namespace: { <ns>: number } }` — 0..1 translated ratios. |
| `key_count` | object | `{ translated: int, total: int }` — raw key tallies. |
| `generated_at` | string (ISO 8601) | When the pack was built. |
| `contributors` | string[] | Credited translators. |

### Manifest entry

Each object in `manifest.json`'s `packs[]` array summarizes one published pack so the downloader can list and fetch it without opening the tarball:

| Field | Type | Purpose |
| --- | --- | --- |
| `code` | string (BCP-47) | Language code. |
| `native_name` | string | Language name in its own script. |
| `english_name` | string | Language name in English. |
| `rtl` | bool | Right-to-left flag. |
| `version` | string (`YYYY.MM.DD`) | Pack version. |
| `app_min_version` | string | Minimum app version supported. |
| `completeness` | number | Overall translated ratio (0..1). |
| `size_bytes` | int | Tarball size, for the download UI. |
| `sha256` | string (hex) | Tarball checksum — verified after download. |
| `url` | string | Download URL of the `.tar.gz` asset. |
| `contributors` | string[] | Credited translators. |
