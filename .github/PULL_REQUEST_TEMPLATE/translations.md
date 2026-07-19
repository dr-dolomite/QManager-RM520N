<!--
  Translation PR template. Contributors reach it via:
    https://github.com/<owner>/<repo>/compare/...?template=translations.md
  Fill in the sections below, then delete these HTML comments before submitting.
-->

Thanks for improving QManager's translations! 🌐 Every string you localize makes the modem easier to use for someone in their own language. This template is just for translation PRs — walk through it and you're good to go.

## What language?

<!-- e.g. "Italian (it)" or "Bahasa Indonesia (id)" -->
Language + code:

## Checklist

- [ ] I ran `bun run lang check <code>` locally and it **passed** (or is partial with no ❌ hard errors).
- [ ] I only touched files under `public/locales/`.
- [ ] I did **not** change `{{placeholders}}` — they must stay identical to the English source (the app substitutes real values into them).
- [ ] I did **not** change HTML tags like `<strong>` or `<code>` inside strings.
- [ ] I did **not** rename plural keys (`_one` / `_other` suffixes) — those are how the app picks singular vs. plural.
- [ ] (New language only) I added myself to the `contributors` list in `_pack.json`.

## A couple of quick questions

1. Are you a native speaker of this language? **(yes / no / partially)**
2. Did you use machine translation to assist? **(yes / no)**

<!-- Honest answers here help maintainers know how much review a PR needs — machine-assisted PRs are still welcome, they just get a closer read. -->

## Notes

Partial translations are **welcome** — you don't have to translate everything at once. Any string you leave untranslated automatically falls back to English until someone (maybe future you!) fills it in. A partial PR with no hard errors is fully mergeable.

New to this? See **[`docs/CONTRIBUTING-translations.md`](../../docs/CONTRIBUTING-translations.md)** for the full walkthrough.
