import { Skeleton } from "@/components/ui/skeleton";

import { PAGER, SKELETON_SHAPE, TOOLBAR } from "./shapes";

// =============================================================================
// The results card's loading state
// =============================================================================
// MIRRORS THE LOADED GEOMETRY BY IMPORT. The incumbent restated it by estimate —
// `h-9 w-64` for a filter that renders at 42px tall and 288px wide, `h-4` bars
// for 40px rows, `rounded-md` and `rounded-lg` for a card built from the role
// scale — so the skeleton and the table it stood in for disagreed about every
// dimension they shared, and the swap reflowed the whole card.
//
// Every number below now comes from `SKELETON_SHAPE`, which is derived from the
// same constants the loaded table uses. A retune of the row height moves both.
// =============================================================================

export interface ScannerSkeletonProps {
  /**
   * How many row placeholders to draw. Five is the honest default: it is what a
   * neighbour read typically returns, and over-drawing rows makes the card
   * shrink when the real, shorter result lands — pulling the page up under a
   * reader who has already started on it.
   */
  rows?: number;
}

export function ScannerSkeleton({ rows = 5 }: ScannerSkeletonProps) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className={TOOLBAR.ROOT}>
        <Skeleton className={SKELETON_SHAPE.FILTER} />
        <div className={TOOLBAR.ACTIONS}>
          <Skeleton className={SKELETON_SHAPE.CHIP} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className={SKELETON_SHAPE.ROW} />
        ))}
      </div>

      <div className={PAGER.ROOT}>
        <Skeleton className={SKELETON_SHAPE.DESC} />
      </div>
    </div>
  );
}

export default ScannerSkeleton;
