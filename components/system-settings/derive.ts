// =============================================================================
// System Settings — shared derivations
// =============================================================================
// The family's non-geometry contract. `shapes.ts` owns how things look; this
// owns how a device value becomes a string. Sibling of the same split in
// `components/monitoring/alerts/derive.ts`.
// =============================================================================

/**
 * The clock offset, as the device spells it, normalised for display.
 *
 * `AT`-adjacent backends report `+0800`; the band and the Time & Units card
 * both surface it, and they must not spell one offset two ways on one page.
 * Anything that is not the four-digit form passes through untouched, so a
 * backend already sending `+08:00` — or `UTC` — is not mangled.
 */
export function formatOffset(offset: string | undefined): string | undefined {
  if (!offset) return offset;
  const match = /^([+-])(\d{2})(\d{2})$/.exec(offset.trim());
  return match ? `${match[1]}${match[2]}:${match[3]}` : offset.trim();
}
