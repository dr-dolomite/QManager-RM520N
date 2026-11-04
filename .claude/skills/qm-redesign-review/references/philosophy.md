# Where the layout rules came from

The rules in `PRODUCT.md` and `DESIGN.md` weren't written up front. The user adopted each one after
reacting to a real page. This file keeps the user's own reasoning, so a critique can argue from the
same place the rules did and not just cite a section number. Quotes are the user's words, lightly
trimmed.

Provenance: this skill and its reasoning were adopted from QManager-the101, 2026-09-26.

Read it once per review. Section 1 carries most of the weight.

## Contents

1. Nobody reads the screen (the Scanning Rules)
2. Whitespace is a symptom, not a fix
3. Convention over explanation
4. Full width, not stretched
5. Cards own their content; the page arranges cards
6. Symmetry, equal heights, left edges
7. Restraint: remove, don't add
8. What the user wants from the review itself

---

## 1. Nobody reads the screen

**Origin.** On 2026-09-24 the user shared the transcript of a video on why some interfaces feel
"weirdly perfect", with four sample images, and asked for its most important parts to become
permanent rules. They became `PRODUCT.md` Principle 8 and `DESIGN.md` "The Scanning Rules". The
video is third-party material: paraphrase it, don't reproduce it.

What the user took from it, in their own framing: "be less reliant on the text. Just like what the
transcript said, users doesnt completely read the whole UI especially the text. They rely on the
standardized design practices and conventions so lets rely on those elements instead."

The video's argument, paraphrased, maps one-to-one onto the rules:

| Video idea (paraphrased) | Rule it became |
|---|---|
| A receipt works with no dividers and almost no whitespace. Names sit hard left, prices hard right, and only the parts you're not meant to read are centred. | Two-Edge Rule, receipt-style rows |
| When a card has loose buttons, don't hide them in a menu. Move content to free an edge, or manufacture a new edge for them to sit on. | Manufactured-Edge Rule |
| Swapping text lines for larger icons loses the bottom edge, so add a sub-line to restore it. | Stack-Height Rule |
| The same lines stretched across the full screen keep every edge but become a chore to read. | Row-Span Rule, and the in-card half of the Full-Width Page Rule |
| The instinct is to add whitespace to counter density. It helps a little but makes everything longer. The problem is undifferentiated content, so group it and vary it. | Group-Before-You-Pad Rule |
| A stop sign needs no reading. A diagram or glyph registers instantly. A tooltip you have to wait for isn't recognition. | Recognition Rule |
| Nobody reads a screen. You arrive with a question and hunt for the answer, as in a settings panel where you want one setting. | Principle 8 itself |
| A checkbox is a thin outline when off and earns its fill when on. Nobody ships one that's blue when off. Emphasis is the difference between an element and its neighbours. | Quiet-Default Rule |
| Borders on borders with three radii stacked don't help. A column edge can do what a card edge did. | One-Nest Rule |

**Use in a critique.** Name the question a visitor brings to the page ("what frequency is channel
150?", "is my band lock in force?") and measure how far the eye travels to answer it. Each finding
should read as a delay in that hunt, not as "looks off".

## 2. Whitespace is a symptom, not a fix

The user's complaints keep coming back to *awkward* whitespace, and in every case the fix was
structure, not padding:

- "the Full Network Sweep card looks rough with uneven card widgets and awkward whitespaces", on
  the Cell Scanner, and again on the Frequency Calculator (2026-09-26).
- "my personal pain point is the white space on the right side of the OVERALL card", followed by
  "Maybe its better to just remove the OVERALL card at all? Its redundant" (design-language
  adoption, 2026-08-30).
- Radio Information once locked a static reference card and a live telemetry card to one height,
  stranding about 200px of dead space in whichever had less to say (`DESIGN.md` > Layout: "Split a
  page by cadence, not by symmetry").
- Antenna Alignment's work column ran 929px against the console's 403px while a diagnostic card
  sat inside it; below the split the columns closed to within about 20px (`DESIGN.md` > The pinned
  console).
- The Frequency Calculator's form column shows about 90px of nothing under the field, because
  `FORM.NOTE` carries `mt-auto` in a column stretched to the readout's 13rem (the exemplar).

So when a region looks empty, find **what sets its size**. It's usually one of these:

- a `min-h` on a sibling column
- `mt-auto` pinning a note to the bottom
- `h-full` stretching a column to match a taller neighbour
- an equal-height row where one card has little content
- a control drawn for a phone column running across a 1,500px card

Then fix the cause. Regroup, move the floating element onto an edge (a footer, `CardAction`), give
the space to the content that wants it, or delete the redundant block. Adding or removing padding is
the last resort, never the first proposal.

## 3. Convention over explanation

**Origin.** The user asked to "amend our design rules … to avoid over-explaining and hand-holding
users through walls or long text descriptions. Prioritize conventions, patterns, and UX standards
that majority of the users already know. Infobadge here and there is also helpful if one thing is
indeed quite complex or technical especially for regular users." This became `PRODUCT.md`
Principle 7 and `DESIGN.md` "Copy & Help".

The follow-up set the tip budget: "the ui builders might also overuse the hinticons … I just want it
to be another convention that every options / settings doesnt need a hint icon." That became the
No-Default-Tip Rule.

The same instinct shows up as trims:

- "remove these ' — 412 ms average'. It makes the event log looks too much information is shown",
  and "not use any emdashes at all" (2026-09-04)
- "we can remove this: 'LTE · 3 bands · 2 carriers'" (Cell Scanner, 2026-09-26)

**Use in a critique.** Count sentences against the budgets in `DESIGN.md` > Copy & Help. Flag copy
that restates a label or teaches a convention. Also flag the same message said twice: the Frequency
Calculator shows one failure three times (the strip under the field, the readout, the bands card).
Proposed copy must come in under budget. Don't use dashes as sentence glue in the mock.

## 4. Full width, not stretched

**Origin.** The rule was adopted after a settings page shipped inside `max-w-[880px]`. Uncapped, it
stretched: "the layout was not planned to have full width in mind unlike the other feature pages
that they all look good on full desktop view". The user first suggested two columns of identical
height, then rejected their own idea within the hour: "its actually better to have it use 1 col.
Maybe just add polishing to make it look optimized and not stretched even with full width on
desktop?" The fix that stuck recomposed *inside* the cards, and the user's verdict was "Love the
layout! This one is the one Im looking for."

The lesson that became the rule: **never cap the page, and never just widen a phone layout.** Cap
readability inside a card (`max-w-[44ch]` on a paragraph). When a card is wide, put side by side what
was stacked and show at once what was hidden. A column count is a proposal to show the user, not a
reflex.

**In this repo.** `BAND_TILE.LIST` in `components/cellular/cell-scanner/shapes.ts` is a real attempt at
in-card recomposition: its comment calls "seven rows down the left half of a 70rem tile … a column of
facts with a column of nothing beside it", and steps to four columns at `@3xl/tile`. It fixed the
empty half and created a new fault: a row-major four-column grid pairs Duplex with DL frequency and
Uplink range with EARFCN range. Recomposing has to pair *related* things (downlink against uplink),
not merely fill the width.

## 5. Cards own their content; the page arranges cards

This rule comes from this repo's design-language adoption (2026-08-30 to 09-07). The Traffic Engine
settings-in-a-card became the reference. Full-page Custom Profiles compositions and a UniFi-style hero
mosaic were rejected (`PRODUCT.md` Anti-references). The user's pain points from that period:

- "Its hero is the biggest offender for me … it looks confusing, bloated, and 'too much'."
  (Cellular Basic Settings, 2026-08-30)
- Traffic Engine's Optimizer targets card was "taking A LOT of vertical and horizontal spaces", and
  the user asked to "make Bypass Mode and Test Bypass cards side by side on desktop mode" with equal
  heights (2026-08-31)
- "fix this double wrapped card for Manual Upload". A card inside a card is the One-Nest failure.

Always ask whether two cards are really one settings group, and whether one card is really two.

## 6. Symmetry, equal heights, left edges

- "Our design consistency makes feature pages justified to the left and nothing are centered"
- "Put IPV4 and IPV6 side by side since when on desktop view, a properly 'shortened' IPv6 will fit
  the space … put APN Configuration Settings card and MBN card side by side when in desktop view with
  the same height." (2026-08-30)
- "the heights of the cards should be the same when side by side on desktop view … MIMO 3 and 4 have
  border lines on top while main and diversity doesnt so for consistency remove the top border"
- "resize the sim icon and its circled background to have the same height now of the adjusted …
  column" (2026-09-10). This is the Stack-Height Rule, before it had a name.
- "I feel like we can also make Possible operating bands and Calculation history share the same row
  as 2 cols?" (Frequency Calculator, 2026-09-26). Two short cards each stretched full width are a
  pair waiting to happen, and `DESIGN.md`'s Symmetric-Pair Rule says how to pair them.

## 7. Restraint: remove, don't add

The user's instinct, over and over, is to take things away:

- a redundant card (the OVERALL card above)
- a dot or a caption that says what's obvious
- a colour that repeats a badge: "Dont colorize the PCI and EARFCN also since we already have the
  badges above for the color differences." That is the Neutral-Default Rule in the user's words.
- an ellipsis on a button that opens no dialog: "let Reset Usage use the regular button size and
  remove the ellipses."

Two related instincts:

- **Consistency with the sibling page wins over invention.** A family restates geometry from its
  siblings rather than inventing it: the Frequency Calculator's answer rail should take the scanner
  hero's `RAIL` shape, not a third centred stack (`shapes.ts` records how three hand-authored stacks
  drifted 8px apart).
- **Taste guardrails.** Oversized corners read as cheap; the reference proportions are Apple's
  Fitness and System Settings (`DESIGN.md` > Shapes, "Why the scale was retuned down").

**Use in a critique.** Every proposal should delete or merge at least as readily as it adds. When
you do add something (a new track, a new behaviour), mark it `new` and put it under "Your call
before build". Don't slip it in.

## 8. What the user wants from the review itself

- **Diagnosis before design.** "I love this analyzation with whitespace and stuff before showing the
  recommended redesign." The measured findings are the part they value most.
- **The design is the artifact, not the prose.** "No need for much explanation inside the artifact.
  All that matters is the design." Keep the doc chrome terse: one lede line per section.
- **Phone view is judged too.** "Love the idea … However, phone / mobile view looks rough. We should
  improve its layout and spacing." The Phone toggle is not decoration.
- **Don't redesign for its own sake.** "If a re-authoring is needed, recommend it; if the current
  layout is already fine, don't re-think it for the sake of it." (2026-09-07). A "Kept as is" list
  that names what already works is part of the answer.
- **Motion is part of the design.** The user repeatedly asks the artifact to "properly take in mind
  the transitions and animations". The mock should demonstrate state changes with the house curves
  and respect reduced motion.
- **Arguable, not preferred.** The 2026-08-21 Custom Profiles proposal set the standard this skill
  keeps: every decision cites a file, a value and a rule, so approval settles a question instead of
  starting a debate.
- **Approval, then build.** The user approves or amends, then the change is built on
  the normal change flow. The artifact never implies the code already changed.
