import * as React from "react";

// =============================================================================
// interpolation-slot — styling one value inside a translated sentence
// =============================================================================
// i18next interpolation returns a flat string, so a sentence like
// "Locked for 28 s" or "Enter your password to manage sdxlemur." cannot give
// its VALUE a different treatment (mono digits, a bolder hostname) from the
// prose around it. The three ways out, and why this is the one:
//
//   Split into two keys      "Enter your password to manage" + "." — breaks
//                            immediately in zh-CN/zh-TW and it, where the
//                            hostname does not sit at that position in the
//                            sentence. The translator loses word order, which
//                            is the one thing a translator must keep.
//   <Trans> with markup      puts `<0>` tags in the JSON. Every translator now
//                            has to preserve markup they cannot see rendered,
//                            and a dropped tag is a runtime error rather than a
//                            typo.
//   Interpolate a sentinel   ONE key, ordinary `{{value}}` syntax, translator
//                            keeps full control of word order, and the slice
//                            happens after i18next has already done its job.
//
// The sentinel is U+0000. It cannot occur in real copy, it is not a character
// any keyboard or CAT tool emits, and unlike a visible marker (`%%`, `{0}`) a
// translator will never "correct" it.
// =============================================================================

/** The placeholder passed INTO `t()`, then sliced back out. */
export const SLOT = "\u0000";

/**
 * Splits an already-interpolated string around {@link SLOT} and drops `value`
 * into the gap.
 *
 * The caller supplies the styled node, so this helper stays presentation-free
 * and the two call sites keep their own treatments — mono tabular digits for a
 * countdown, semibold foreground ink for a hostname.
 *
 * Degrades to the template as written if the placeholder is missing, which is
 * what a locale that dropped `{{hostname}}` will produce. A sentence missing
 * its device name still reads; a crash does not.
 */
export function withSlot(
  template: string,
  value: React.ReactNode,
): React.ReactNode {
  const index = template.indexOf(SLOT);
  if (index === -1) return template;
  return (
    <>
      {template.slice(0, index)}
      {value}
      {template.slice(index + SLOT.length)}
    </>
  );
}
