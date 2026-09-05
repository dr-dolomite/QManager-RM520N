---
name: reference-eyebrow-casing-lives-in-content
description: No EYEBROW/tile-label class in this repo applies `uppercase`, so a caps eyebrow is a styling decision smuggled into a JSON leaf — write sentence case and let locales choose their own form
metadata:
  type: reference
---

Every `EYEBROW` constant in the shapes modules is weight + tracking + colour only
(`components/system-settings/shapes.ts` and siblings) — **none of them carries
`uppercase`**. What the locale file says is exactly what renders.

So a value like `"DEVICE CLOCK"` in `public/locales/en/*.json` is a *styling*
decision living in content, and it does not survive translation: Chinese has no
case at all, and a shouted Latin string is a different typographic register in
`it` / `id` than in English.

**Precedent in the shipped packs (checked 2026-09-05):** eyebrow values are
sentence case almost everywhere — `cellular.json` `"Lock posture"`, `"Rate
ceiling granted by the network"`, `dashboard.json` `"Average RTT"`, `"Packet
loss"`. There is exactly **one** caps outlier, `cellular.json:1128`
`hero.eyebrow = "IN FORCE NOW"`, and the two locale families split on it: `it`
mirrored the caps (`"ATTIVO ORA"`) while `zh-CN` quietly normalised it
(`"當前生效"` / `"当前生效"`). That split is the cost of putting casing in the leaf.

**How to apply:** write eyebrows in sentence case in `en`, translate naturally in
the other four packs, and if a surface genuinely wants all-caps eyebrows, add
`uppercase` to its `EYEBROW` constant so the four non-English packs are not
dragged along. Related: [[reference-locale-parity-baseline-is-100]].
