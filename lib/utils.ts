import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * `rounded-*` spans two scales in this repo: the legacy t-shirt chain
 * (`sm`/`md`/`lg`/`xl`, still live on 240+ call sites) and the shape scale
 * from DESIGN.md > Shapes (`inline`/`field`/`tile`/`card`/`hero`/`pill`).
 *
 * Stock `twMerge` only knows the first — its `radius` theme key defaults to a
 * t-shirt-size matcher — so it cannot tell that `rounded-card` and
 * `rounded-md` set the same property, and emits BOTH. Raw CSS source order
 * then picks the winner, and Tailwind v4 emits `rounded-*` alphabetically, so
 * a primitive's own default silently beat its call sites: `rounded-xl` on
 * `Card` sorts last and won against every shape name, while `rounded-md` on
 * `Skeleton` beat `card`/`field`/`hero`/`inline` and lost to `pill`/`tile`
 * purely by spelling. 174 overrides across the repo were losing that way.
 *
 * Registering the six names into the same group restores normal dedupe: the
 * last class wins, which is what every call site already assumed. Verify a
 * change here by CALLING twMerge, never by reasoning about it —
 * `node -e "..."` against the installed lib is the only real evidence.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ["inline", "field", "tile", "card", "hero", "pill"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
