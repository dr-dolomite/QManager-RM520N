"use client";

import * as React from "react";

import { TICK_STAGGER_STEP } from "@/lib/motion";

/**
 * The cascade half of the live value tick (DESIGN.md > Motion, "Live value
 * tick"; Motion Guide recipe 06).
 *
 * `useValueTick` knows when *one* figure moved. It cannot know that five others
 * moved in the same poll, so every dip fired on the same frame and a card full
 * of live values read as the whole card flashing rather than as its individual
 * figures ticking. Recipe 06's own demo stages its three values apart for
 * exactly this reason. This is the piece that gives the group an order.
 *
 * **Rank among CHANGED, not ordinal position.** The obvious implementation —
 * delay by a value's fixed position in the card — is wrong here, and measurably
 * so. Device Information holds nine identity rows (manufacturer, firmware,
 * IMEI, ICCID…) that change approximately never, above two live uptime tiles.
 * Under ordinal indexing a typical poll would sit silent through nine slots and
 * then dip at 540ms and 600ms: not a cascade, just unexplained latency. Device
 * Metrics would cascade with holes where the values that happened not to move
 * were, which reads as rows failing to render rather than as choreography.
 *
 * So rank is assigned over only the values that actually moved this commit. A
 * poll that moves four figures produces a four-step cascade with no gaps and a
 * 600ms tail, whichever four they were. The cost is that one row's absolute
 * delay shifts between polls; what never shifts is its position relative to its
 * neighbours, which is the thing the eye is actually reading.
 *
 * **Order comes from the DOM, not from an index prop.** Members are sorted with
 * `compareDocumentPosition`, so document order *is* reading order — and in this
 * dashboard that holds for every group without a direction flag: vertical
 * stacks read top-to-bottom, the Data Used rx/tx pair reads left-to-right, and
 * Carrier Aggregation's `grid-cols-1 → 2 → 4` responsive grid places row-major,
 * so index order survives all three breakpoints. Sorting the live nodes also
 * means a value that renders conditionally is simply absent from the set rather
 * than leaving a dead beat: Signal Status' band row takes an identity-pill
 * branch that mounts no tick at all, and a naive map index would have opened the
 * cascade with a silent slot.
 *
 * **The drain is a microtask, not a parent layout effect.** A parent effect
 * would also see every child (React runs child layout effects first), but only
 * if the parent re-rendered in that commit — a memoized subtree updating alone
 * would strand its registrations. A single shared microtask flushes after the
 * whole commit's layout effects regardless of which components rendered, so the
 * group sees the true set of values that moved together.
 *
 * The step is `TICK_STAGGER_STEP` (200ms, lib/motion.ts), which is neither of
 * the two entrance steps. This shipped first at the 40ms row step, on the
 * reading that these are rows inside one card's border — true, but the entrance
 * steps are tuned against a different failure. An entrance cascade is racing the
 * user's patience, so it stays dense; a tick cascade is racing nothing, because
 * the card is already on screen. At 40ms four dips spanned 120ms against a dip
 * lasting several times that, so they overlapped almost entirely and the group
 * still read as one flash — the exact symptom the cascade was built to fix. See
 * `TICK_STAGGER_STEP` for why 200ms rather than the demo's 350ms — and note
 * that the step rode the 2x scale retune, so any figure quoted here in
 * milliseconds is a derived number, never the source of truth.
 *
 * Rank is clamped at `MAX_RANK` so a group larger than the guide's ~8-item
 * cascade ceiling shares the tail slot instead of growing an ever-longer tail.
 */

/** Registration handed to the group by each member that moved this commit. */
interface PendingTick {
  node: HTMLElement;
  /** Starts the member's dip, `delayMs` into the future. */
  start: (delayMs: number) => void;
}

interface TickGroupApi {
  /**
   * Called by a member whose value changed. The member is queued, not started —
   * the group starts it once it knows how many siblings moved alongside it and
   * where this one sits among them.
   */
  enqueue: (pending: PendingTick) => void;
}

/**
 * Absent by default, and that is the contract: a `TickingValue` mounted outside
 * a group is not broken, it simply dips immediately. Ungrouped figures are the
 * common case on cards that carry a single live value.
 */
export const TickGroupContext = React.createContext<TickGroupApi | null>(null);

/**
 * The guide caps a cascade at "about eight items". Past that the delay stops
 * growing: item 9 and beyond ride the same tail slot as item 8, so an oversized
 * group degrades into a cascade with a slightly thick end rather than into a
 * gesture that outlives its own poll.
 */
const MAX_RANK = 7;

/**
 * Groups the live figures a user perceives as one cascade.
 *
 * Scope it to a set of values sharing an axis and a visual container — the four
 * metric meters, the rx/tx pair, one card's identity rows. Do **not** wrap a
 * whole page or several cards: rank is bounded by how many values moved, so a
 * group spanning the dashboard would let a single poll cascade past the poll
 * interval itself, which is the drift the Motion Guide's anti-queue rule exists
 * to prevent.
 *
 * Renders no DOM of its own. The group is a coordination scope, not a layout
 * box, so dropping one into a flex row cannot disturb the row.
 */
export function TickGroup({ children }: { children: React.ReactNode }) {
  const pending = React.useRef<PendingTick[]>([]);
  const scheduled = React.useRef(false);

  const api = React.useMemo<TickGroupApi>(
    () => ({
      enqueue(member) {
        pending.current.push(member);
        if (scheduled.current) return;
        scheduled.current = true;

        queueMicrotask(() => {
          scheduled.current = false;
          const members = pending.current;
          pending.current = [];
          if (members.length === 0) return;

          // Document order is reading order for every group in this dashboard;
          // see the note above on why no axis flag is needed.
          members.sort((a, b) => {
            const rel = a.node.compareDocumentPosition(b.node);
            if (rel & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
            if (rel & Node.DOCUMENT_POSITION_PRECEDING) return 1;
            return 0;
          });

          members.forEach((member, rank) => {
            member.start(Math.min(rank, MAX_RANK) * TICK_STAGGER_STEP * 1000);
          });
        });
      },
    }),
    [],
  );

  return (
    <TickGroupContext.Provider value={api}>{children}</TickGroupContext.Provider>
  );
}

export default TickGroup;
