// =============================================================================
// pre-auth-type — the type scale shared by the two unauthenticated cards
// =============================================================================
// QManager has exactly two pre-auth surfaces: the Overview splash at "/" and
// the sign-in card at "/login/". They are the same object seen twice, and until
// now they agreed about their type only by convention — which is how the splash
// came to ship a 19px card title while the login card shipped 24px, each with a
// comment reasoning from the other's number.
//
// This module is TYPE ONLY, and deliberately so. The two cards genuinely differ
// in width, in their inner spacing and in their gutter, so a shared geometry
// module would be mostly non-shared and would invite the second card to inherit
// a measurement that was only ever right for the first. What they DO share is
// the voice: how loud a title is, how quiet an eyebrow is, and the one body step
// that sits between them.
//
// Every step here is a surface-scoped exception to the app scale, documented in
// DESIGN.md > Typography > Hierarchy. They do not travel to authenticated
// routes; a card behind the login uses the app scale.
// =============================================================================

/**
 * The card's own h1 — the loudest thing on either screen, and the only h1.
 *
 * 19px, not 24px. These cards are ~400-540px wide and hold three text elements
 * total, so the title is already unmistakable at 19px; 24px reads as a marketing
 * headline on a surface whose job is to report a modem's state. The login card
 * shipped 24px and its own field-label comment reasoned "12px under a 24px
 * headline reads as fine print" — an argument that stops being needed once the
 * headline is the same size as the splash's.
 */
export const CARD_TITLE =
  "text-[1.1875rem] leading-[1.15] font-semibold tracking-[-0.01em]";

/**
 * A heading INSIDE the card — the empty-state title, a zone that earns a name.
 * One step under the card title, so the hierarchy survives even when the two
 * appear together.
 */
export const SECTION_TITLE =
  "text-[1.0625rem] leading-[1.2] font-semibold tracking-[-0.01em]";

/**
 * The reading step: a tile's value, the CTA label. Semibold because these are
 * the figures the visitor came for, and the surface has no other way to weight
 * them — there is no dense metric row here to sit them in.
 */
export const EMPHASIS =
  "text-[0.9375rem] leading-none font-semibold tracking-[-0.01em]";

/**
 * Body — a field label, a sentence of explanation.
 *
 * 13px, NOT the app's 12px Label step. It is also NOT the dense-metric-row 13px,
 * which is 13px only with a mandatory tight line box; this one is the pre-auth
 * card's own body, and it is shared by both screens. Changing it changes both.
 */
export const BODY = "text-[0.8125rem]";

/**
 * The label above every tile and section.
 *
 * The comp draws this at 10px. It ships at 11px: that is the floor already set
 * by the sidebar's surface-scoped exception, and going below it would make
 * uppercase text at 0.11em tracking the smallest type in the product. Fidelity
 * to the comp is not worth a new product-wide minimum on the least legible thing
 * on the page.
 */
export const EYEBROW =
  "text-[0.6875rem] font-semibold uppercase leading-none tracking-[0.11em]";
