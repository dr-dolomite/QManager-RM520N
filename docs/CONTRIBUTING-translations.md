# Contributing Translations to QManager

Thank you for helping people use QManager in their own language. You don't need to be a programmer to do this — if you can edit a text file and follow a checklist, you can contribute a complete translation. Every piece of text in QManager lives in a handful of small files, one folder per language, and we've built a little helper tool that tells you exactly what's left to translate, checks your work, and explains — in plain words — how to fix anything that's off. You can translate five strings or five hundred; partially finished languages are welcome, because anything you don't get to simply shows in English until someone picks it up. This guide walks you through the whole journey, from "I want to help" to seeing your name in the release credits.

## Quick Reference

| I want to... | Command |
|--------------|---------|
| See how complete a language is | `bun run lang status <code>` |
| See every string still left to translate | `bun run lang status <code> --todo` |
| Check my work for mistakes | `bun run lang check <code>` |
| Tidy my file to match English order | `bun run lang fmt <code>` |
| Start a brand-new language | `bun run lang scaffold <code> --native-name … --english-name …` |

`<code>` is a language code like `it` (Italian), `de` (German), `pt-BR` (Brazilian Portuguese), `zh-CN` (Simplified Chinese). The translation files live in `public/locales/<code>/`. English (`public/locales/en/`) is the master copy that everything else is measured against.

> ℹ️ NOTE: This is the **contributor pipeline** — it's how translations are authored, checked, and packaged. Getting a finished pack *onto a modem* over the air is a separate, still-being-built piece (see [The road ahead](#the-road-ahead)). For now, translations you contribute ship by being merged into the app.

---

## 1. What you need

Three things, and only three:

1. **A GitHub account** — free, so you can fork the project and open a pull request (a "PR" — your proposed change, submitted for review).
2. **Git** — to copy the project to your computer and send your changes back. GitHub's own [Git guide](https://docs.github.com/en/get-started/quickstart/set-up-git) covers install.
3. **[Bun](https://bun.sh/)** — the little runtime that powers the translation helper tool. One line installs it:

   ```sh
   # macOS / Linux
   curl -fsSL https://bun.sh/install | bash
   # Windows (PowerShell)
   powershell -c "irm bun.sh/install.ps1 | iex"
   ```

**You do NOT need** Node.js, Next.js, React, or any knowledge of how the app is built. You do **not** even need to run `bun install` — the translation tool has zero dependencies and runs straight from a fresh clone. If you can open a `.json` file in a text editor, you have everything you need.

---

## 2. Improving an existing language

The five languages QManager already ships are English (`en`), Simplified Chinese (`zh-CN`), Traditional Chinese (`zh-TW`), Italian (`it`), and Indonesian (`id`). Filling gaps in one of these is the easiest way to start.

1. **Fork and clone** the repository (the GitHub "Fork" button, then `git clone` your fork). Make a branch for your work:

   ```sh
   git checkout -b translate-it
   ```

2. **See what's left.** Ask the helper tool where the gaps are:

   ```sh
   bun run lang status it
   ```

   ```text
   it — 100% translated (412/412)
     ✓ common          231/231
     ✓ sidebar          38/38
     ✓ dashboard       143/143
   ```

   Add `--todo` to get a work queue — every untranslated key with the English text beside it, so you can translate straight down the list:

   ```sh
   bun run lang status it --todo
   ```

   ```text
   it — 96% translated (396/412)
     ✓ common          231/231
     ⚠ sidebar          34/38
     ✓ dashboard       143/143

     Untranslated (4):
       sidebar/monitoring.title  = "Monitoring"
       sidebar/monitoring.ping   = "Latency"
       ...
   ```

3. **Edit the files.** Open `public/locales/it/<namespace>.json` (e.g. `public/locales/it/sidebar.json`) in any text editor. Each file sits right next to its English twin in `public/locales/en/` — keep both open side by side and translate the right-hand value, never the left-hand key:

   ```json
   {
     "monitoring": {
       "title": "Monitoraggio",
       "ping": "Latenza"
     }
   }
   ```

   Leave anything you don't finish as an empty string (`""`) — the app shows the English text until someone fills it in. Partial is genuinely fine.

4. **Check your work.** The tool validates against English and explains any problem in plain words — the file, the line, the English value, your value, and how to fix it:

   ```sh
   bun run lang check it
   ```

   ```text
   Checking it against en (3 namespaces, 412 keys)
     ✓ common          231/231
     ✓ sidebar          38/38
     ✓ dashboard       143/143

     PASS — it is 100% translated and structurally valid.
   ```

   A partial translation still **passes** — only structural mistakes (see [section 6](#6-things-that-look-like-code--dont-translate-them)) fail. Optionally run `bun run lang fmt it` to reorder your keys to match English so the reviewer sees a clean, line-for-line diff.

5. **Open a pull request.** Commit and push your branch, then open a PR on GitHub. A friendly bot will check it and post a summary — see [section 8](#8-opening-your-pr).

---

## 3. Adding a new language

Starting a language QManager doesn't have yet takes one command. Pick the [BCP-47 code](https://www.w3.org/International/articles/language-tags/) for your language (`de`, `fr`, `pt-BR`, `ja`, `ar`, …) and scaffold it:

```sh
bun run lang scaffold de --native-name "Deutsch" --english-name "German"
```

```text
✓ Scaffolded de (3 namespaces, 412 strings to translate)
  Files: public/locales/de/{common,sidebar,dashboard,_pack}.json
  Every value starts empty ("") — fill them in, English shows until you do.
  Add your name to the "contributors" list in _pack.json.
  Track progress:  bun run lang status de --todo
```

This creates `public/locales/de/` with one JSON file per namespace, shaped exactly like English but with **every value blank** (`""`). An empty string is the tool's way of saying "not translated yet" — the app quietly falls back to English for anything still blank, and when a pack is built those blanks are stripped out entirely. Add `--rtl` if your language is right-to-left (Arabic, Hebrew) — though note RTL layout support in the app itself is still being finished.

Now translate. Fill in the values, run `bun run lang status de --todo` to track what's left, and `bun run lang check de` to check your work. **You do not have to finish everything** — translate what you can and open a PR; someone else can carry it on later.

Finally, **add yourself to the credits.** Open `public/locales/de/_pack.json` and put your name (or handle) in the `contributors` list:

```json
{
  "code": "de",
  "native_name": "Deutsch",
  "english_name": "German",
  "rtl": false,
  "contributors": ["Your Name"]
}
```

> ℹ️ NOTE: Scaffolding a new language does **not** switch it on in the app automatically. A maintainer registers a language into the shipped bundle as a deliberate, separate step — this keeps the app's build predictable. Your job is to get the translation to a good state; wiring it in is on us.

---

## 4. The commands reference card

All commands are `bun run lang <verb>`. The four a contributor needs:

| Command | What it does |
|---------|--------------|
| `bun run lang status [<code>]` | Completeness table per namespace and overall. No code = every language. |
| `bun run lang status <code> --todo` | Above, plus a list of every untranslated key and its English text — your work queue. |
| `bun run lang status <code> --ns <namespace>` | Narrow status/todo to one namespace (`common`, `sidebar`, `dashboard`). |
| `bun run lang check [<code>]` | Validate against English with teaching errors (file, line, the fix, and a "did you mean?" hint for typo'd keys). Partial passes; only structural problems fail. |
| `bun run lang check --all` | Check every language at once. |
| `bun run lang fmt <code>` | Reorder your keys to match English order with canonical 2-space / LF formatting, so English and your file diff line-for-line. Nothing is dropped — any extra keys are moved to the end. |

Run any of them with no arguments (or `bun run lang help`) to see the full usage.

---

## 5. What "completeness" means

The tool counts a key as **translated** when its value is a non-empty string. Missing keys and empty values are *warnings*, not errors — a language at 60% ships perfectly happily, with the other 40% showing in English. There is no pressure to reach 100% before contributing. The only things that actually **fail** a check are structural mistakes, which is what the next section is about.

---

## 6. Things that look like code — don't translate them

A few things inside the text are machine parts, not words. Translate the words around them, but copy these through **exactly** as they appear in English. Getting one wrong is the one kind of mistake that fails a check — but the tool will point at the exact spot and tell you how to fix it.

### Placeholders: `{{...}}`

Double curly braces are slots the app fills in at runtime (a number, a name, a count). Keep the name inside untouched — you may move it to wherever it reads naturally in your language.

Real example, `common.json` → `login.locked`:

```json
"locked": "Locked ({{seconds}}s)"
```

German: `"Gesperrt ({{seconds}}s)"` — `{{seconds}}` is copied verbatim; only "Locked" is translated. Writing `{{Sekunden}}` would break it — the app has no `Sekunden` value to put there.

### HTML tags: `<strong>`, `<code>`, …

Angle-bracket tags style a piece of text. Keep the tags exactly and translate only the words between them. Every opening tag needs its matching closing tag.

Real example, `common.json` → `profile_override.banner`:

```json
"banner": "{{controls}} is managed by the <strong>{{profile_name}}</strong> Custom SIM Profile."
```

Here you have both a placeholder *and* a tag pair: translate the sentence, keep `{{controls}}`, `{{profile_name}}`, and the `<strong>…</strong>` wrapper intact. Dropping the closing `</strong>` is a structural error and will fail the check.

### Plural key names: `_one` / `_other`

Some keys come in pairs whose **names** end in `_one` and `_other`. These suffixes are how the app picks the right form for a number — they are part of the key, not the text. Translate the *values*; never rename the keys.

Real example, `dashboard.json`:

```json
"active_carriers_one": "{{count}} active carrier",
"active_carriers_other": "{{count}} active carriers"
```

Italian: keep both keys exactly, translate each value (`"{{count}} vettore attivo"` / `"{{count}} vettori attivi"`). If your language has more plural forms than English (Polish, Russian, Arabic, …), you may *add* extra `_few` / `_many` keys — the tool understands your language's plural rules and won't complain. If your language has fewer, translating `_one` and `_other` is enough.

---

## 7. Terminology guide

QManager is a cellular-modem tool, and a lot of its vocabulary is standardized technical shorthand that engineers read in the Latin alphabet regardless of language. Keep these **untranslated** (or transliterated only if that's the genuine convention in your language), so the terms stay recognizable:

- **Signal & radio metrics, kept in Latin:** RSRP, RSRQ, SINR, ARFCN (and EARFCN/NR-ARFCN), PCI, EN-DC.
- **Network / config acronyms:** APN, IMEI, FPLMN, PDP, TTL, MTU. Concepts like *band locking* and *carrier aggregation* may be translated if your language has a settled term, but keep the acronyms.
- **Brand and product names, never translated:** QManager, Discord Bot, Tailscale.

This mirrors the anchor list in the i18n reference — see [`reference/i18n.md`](reference/i18n.md#translations--rm551e-reuse) for the full rationale. When in doubt, match how the existing `it` / `zh-CN` files handled the same term.

---

## 8. Opening your PR

When you push your branch and open a pull request:

1. **Use the translation template.** GitHub offers a translation PR template (`.github/PULL_REQUEST_TEMPLATE/translations.md`) — a short checklist so you and the reviewer are on the same page (which language, whether you ran `check`, new vs. existing).
2. **The CI bot checks it automatically.** A workflow runs `bun run lang check --all` on every PR that touches translations (about 20–30 seconds, no install needed) and posts a **sticky comment** with a per-language completeness table and inline notes on anything structural. It only *fails* on hard structural errors — an incomplete translation is reported, not rejected.
3. **Partial is mergeable.** You do not need 100% to be merged. If the structure is sound, a reviewer can merge a partial translation and the app fills the gaps with English.
4. **How it becomes a shipped/downloadable pack.** Once merged, a maintainer runs `bun run lang build <code>` to package your translation and `bun run lang publish <code>` to upload it — with your name carried through to the credits. That's a maintainer step; you don't need to do it.

---

## 9. FAQ / getting unstuck

**`check` says "not valid JSON" / "Unexpected token".**
A JSON syntax slip — usually a missing comma between lines, a trailing comma after the last item, or a `"` that should be `\"` inside a value. The error names the file; open it and look near the reported spot. Running `bun run lang fmt <code>` won't fix broken JSON, but most code editors underline the exact character.

**`check` fails on a key I didn't touch.**
You may have an *extra* key (one that isn't in English) or a *renamed* key. The tool prints a "did you mean?" hint when a key looks like a typo of a real one — follow it. If you genuinely added a key the app doesn't use, remove it; English defines the full key set.

**My translation is only half done — is that OK to submit?**
Yes. Leave the rest as empty strings (`""`), open the PR, and note it's partial. English fills the gaps.

**A placeholder or tag "won't validate."**
Re-read [section 6](#6-things-that-look-like-code--dont-translate-them). The usual causes: a translated placeholder name, a dropped `</strong>`, or a renamed `_one`/`_other` key. Copy the English value's machine parts through verbatim.

**Where do I ask for help?**
Open a [GitHub Issue](https://github.com/dr-dolomite/QManager-RM520N/issues) or ask right in your pull request — maintainers and other translators are happy to help.

---

## The road ahead

What's described above — authoring, checking, packaging, and publishing translation packs — is **Increment A**, and it's live now. A later **Increment B** will add the device-side downloader: fetching a published pack directly onto a running modem, verifying it, and loading it into the interface without a full app update. Until then, contributed translations reach users by being merged and shipped in the app. Either way, your part is the same: translate, check, and open a PR.

For the technical details of the pipeline, see [`reference/i18n.md`](reference/i18n.md).
