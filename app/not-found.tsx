"use client";

// =============================================================================
// 404 — Direction contract
// -----------------------------------------------------------------------------
// THESIS: A page-not-found reported in QManager's own operator language — the
//   console couldn't ACQUIRE A ROUTE, the same way it reports it can't acquire a
//   cell. Refuses the generic astronaut/"lost in space" 404 and the bare centered
//   button.
// OWN-WORLD: One self-contained console card on the calm canvas (like login/
//   splash, outside the sidebar grid). Signal-indigo touches only the single
//   primary action; the condition is carried by an outline status badge and a
//   machine-voice path readout. Ambient pulse-ring = listening, never locking.
// STORY: The operator understands they hit a dead address, sees the exact route
//   that failed, and returns to the dashboard (primary) or goes back (secondary).
// FIRST VIEWPORT: Centered card — pulsing RouteOff tile, a large tabular "404",
//   a destructive "No route acquired" badge, title + one honest line, the
//   requested path in mono, then two actions. Brand footer closes it.
// FORM: Operate-mode error surface inside an established world; no new tokens.
// =============================================================================

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import Link from "next/link";
import {
  XCircleIcon,
  LayoutDashboardIcon,
  ArrowLeftIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// Classic rising signal bars. The meter sweeps left-to-right as if reaching for
// a lock, then lets go — the delight moment, drawn straight from the product's
// own world (a modem's "searching" body language). It is an AMBIENT state motif,
// not a progress claim: the badge and copy make the terminal "no route" honest.
// Opacity-only so it stays gentle under reduced motion (transforms would snap;
// a soft sweep still reads as "listening, no signal").
const SCAN_BARS = ["h-2.5", "h-4", "h-5", "h-7"] as const;

function SignalScan() {
  return (
    <div
      role="img"
      aria-label="No signal — the console can't acquire a route for this address"
      className="bg-muted flex size-16 items-end justify-center gap-1 rounded-xl border p-3"
    >
      {SCAN_BARS.map((height, i) => (
        <motion.span
          key={height}
          aria-hidden
          className={`bg-muted-foreground w-1.5 rounded-full ${height}`}
          initial={{ opacity: 0.2 }}
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{
            duration: 1.4,
            delay: i * 0.16,
            repeat: Infinity,
            repeatDelay: 0.7,
            ease: "easeOut",
          }}
        />
      ))}
    </div>
  );
}

export default function NotFound() {
  // The requested path is real machine data, but only known client-side (a
  // static export can't prerender it). Read it on mount to avoid a hydration
  // mismatch; keep the row present either way so nothing reflows when it lands.
  const [requestedPath, setRequestedPath] = useState<string>("");

  useEffect(() => {
    setRequestedPath(window.location.pathname + window.location.search);
  }, []);

  return (
    <div className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <motion.main
        className="w-full max-w-md"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <div className="bg-card flex flex-col items-center gap-6 rounded-xl border p-8 text-center shadow-sm">
          <SignalScan />

          {/* Status code as an honest readout, not a marketing hero: solid,
              tabular, paired with the condition badge. */}
          <div className="flex flex-col items-center gap-3">
            <p
              className="text-foreground text-6xl font-bold tabular-nums tracking-tight"
              aria-label="Error 404"
            >
              404
            </p>
            <Badge variant="destructive">
              <XCircleIcon className="size-3" />
              No route acquired
            </Badge>
          </div>

          <div className="flex flex-col gap-2">
            <h1 className="text-lg font-medium tracking-tight">
              This route doesn&apos;t exist
            </h1>
            <p className="text-muted-foreground text-sm/relaxed text-balance">
              The console kept listening, but nothing&apos;s broadcasting at this
              address. It may have moved, or the link was mistyped.
            </p>
          </div>

          {/* The exact route that failed — machine-voice, so font-mono earns it
              (a real technical identifier, per the Machine-Voice Rule). */}
          <div className="bg-muted/30 flex w-full flex-col gap-1.5 rounded-lg border p-3 text-left">
            <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
              Requested route
            </span>
            <code className="text-foreground/80 font-mono text-xs break-all">
              {requestedPath || "—"}
            </code>
          </div>

          {/* Single indigo affordance on the screen; secondary stays outline. */}
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-center">
            <Button
              variant="outline"
              className="sm:w-auto"
              onClick={() => window.history.back()}
            >
              <ArrowLeftIcon className="size-4" />
              Go back
            </Button>
            <Button asChild className="sm:w-auto">
              <Link href="/dashboard/">
                <LayoutDashboardIcon className="size-4" />
                Return to Dashboard
              </Link>
            </Button>
          </div>
        </div>
      </motion.main>

      <div className="flex items-center gap-2">
        <img
          src="/qmanager-mark.svg"
          alt=""
          aria-hidden
          className="size-4 opacity-70"
        />
        <p className="text-muted-foreground text-xs">
          QManager — Quectel Modem Management
        </p>
      </div>
    </div>
  );
}
