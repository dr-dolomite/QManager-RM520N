"use client";

import React from "react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  CheckCircle2Icon,
  Loader2,
  MinusCircleIcon,
  SendIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion-presets";
import { type UseSmsForwardingReturn } from "@/hooks/use-sms-forwarding";

// =============================================================================
// DeliveryHealthCard — the status companion to SmsForwardingCard. Reports the
// live relay state, a preview of what the recipient receives, the test action
// (verifies the SAVED path — the CGI reads the target from server config), and
// the daemon's delivery-failure history. Shares the lifted useSmsForwarding
// hook.
// =============================================================================

// The preview teaches the relay FORMAT, so the "From" sender is a sample
// inbound number — not the saved target, who is the one RECEIVING this bubble.
const SAMPLE_SENDER = "+15550142";

type Health = "active" | "issue" | "off" | "unconfigured";

type Tone = "success" | "warning" | "muted";

const ICON_WRAP_CLASS: Record<Tone, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  muted: "bg-muted text-muted-foreground",
};

const DeliveryHealthCard = ({ fwd }: { fwd: UseSmsForwardingReturn }) => {
  const { data, isLoading, isSendingTest, isClearing, error, sendTest, clearFailures } =
    fwd;

  const handleSendTest = async () => {
    const success = await sendTest();
    if (success) {
      toast.success("Test message sent to the saved number");
    } else {
      toast.error(error || "Failed to send test message");
    }
  };

  const handleClear = async () => {
    const success = await clearFailures();
    if (success) {
      toast.success("Delivery failures cleared");
    } else {
      toast.error(error || "Failed to clear failures");
    }
  };

  // --- Loading skeleton ------------------------------------------------------
  // Mirrors the real content geometry (focal row → preview box → test action)
  // so the card holds its height and nothing snaps when data lands.
  if (isLoading || !data) {
    return (
      <Card className="@container/card h-full">
        <CardHeader>
          <CardTitle>Delivery Health</CardTitle>
          <CardDescription>
            Live relay status, a recipient preview, and any delivery failures.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          {/* Focal state + destination */}
          <div className="flex items-start gap-3">
            <Skeleton className="size-9 shrink-0 rounded-lg" />
            <div className="grid flex-1 gap-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-44" />
            </div>
          </div>
          {/* Recipient preview */}
          <div className="grid gap-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
          {/* Test action + hint */}
          <div className="grid gap-1.5">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-3 w-52" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const { enabled, target_phone } = data.settings;
  const failures = data.failures ?? [];
  const failureCount = data.failure_count ?? failures.length;

  // Single state machine drives the badge, the focal row, and the destination.
  const health: Health = !enabled
    ? "off"
    : !target_phone
      ? "unconfigured"
      : failureCount > 0
        ? "issue"
        : "active";

  const STATE: Record<
    Health,
    { tone: Tone; Icon: typeof CheckCircle2Icon; label: string }
  > = {
    active: {
      tone: "success",
      Icon: CheckCircle2Icon,
      label: "Forwarding active",
    },
    issue: {
      tone: "warning",
      Icon: TriangleAlertIcon,
      label: "Delivery issues",
    },
    unconfigured: {
      tone: "warning",
      Icon: TriangleAlertIcon,
      label: "No destination set",
    },
    off: {
      tone: "muted",
      Icon: MinusCircleIcon,
      label: "Forwarding off",
    },
  };

  const state = STATE[health];
  const { Icon } = state;
  const canSendTest = enabled && !!target_phone && !isSendingTest;

  // --- Render ----------------------------------------------------------------
  return (
    <Card className="@container/card h-full">
      <CardHeader>
        <CardTitle>Delivery Health</CardTitle>
        <CardDescription>
          Live relay status, a recipient preview, and any delivery failures.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <motion.div
          className="grid gap-5"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {/* Focal state + destination */}
          <motion.div variants={staggerItem} className="flex items-start gap-3">
            <span
              className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${ICON_WRAP_CLASS[state.tone]}`}
            >
              <Icon className="size-5" />
            </span>
            <div className="grid gap-0.5">
              <p className="text-sm font-semibold leading-tight">
                {state.label}
              </p>
              {target_phone ? (
                <p className="text-sm text-muted-foreground">
                  Forwarding to{" "}
                  <span className="font-mono text-foreground tabular-nums">
                    {target_phone}
                  </span>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Set a destination number to start forwarding.
                </p>
              )}
            </div>
          </motion.div>

          {/* Recipient preview */}
          <motion.div variants={staggerItem} className="grid gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Recipient sees
            </p>
            <div className="rounded-lg border bg-muted/40 px-3 py-2">
              <p className="text-sm leading-snug">
                <span className="font-mono text-muted-foreground">
                  From {SAMPLE_SENDER}:
                </span>{" "}
                <span className="text-foreground">
                  Your verification code is 123456.
                </span>
              </p>
            </div>
          </motion.div>

          {/* Test the saved relay path */}
          <motion.div variants={staggerItem} className="grid gap-1.5">
            <Button
              type="button"
              variant="secondary"
              className="w-fit"
              disabled={!canSendTest}
              onClick={handleSendTest}
            >
              {isSendingTest ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <SendIcon className="size-4" />
                  Send test
                </>
              )}
            </Button>
            <p className="text-xs text-muted-foreground">
              {canSendTest
                ? "Sends a test message to the saved number to confirm the relay works."
                : "Enable forwarding and save a destination number to send a test."}
            </p>
          </motion.div>

          {/* Delivery failures */}
          <motion.div variants={staggerItem}>
            <AnimatePresence initial={false} mode="wait">
              {failures.length > 0 ? (
                <motion.div
                  key="failures"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  style={{ overflow: "hidden" }}
                >
                  <Alert variant="destructive">
                    <TriangleAlertIcon className="size-4" />
                    <AlertTitle>
                      {failures.length} delivery{" "}
                      {failures.length === 1 ? "failure" : "failures"}
                    </AlertTitle>
                    <AlertDescription className="grid gap-2">
                      <p>
                        The daemon gave up relaying these after repeated failed
                        sends.
                      </p>
                      <ul className="grid gap-1 text-xs">
                        {failures.slice(0, 5).map((f, i) => (
                          <li
                            key={`${f.sender}-${f.timestamp}-${i}`}
                            className="flex flex-wrap items-baseline gap-x-2"
                          >
                            <span className="font-mono font-medium">
                              {f.sender || "Unknown sender"}
                            </span>
                            <span className="text-muted-foreground">
                              {f.timestamp}
                            </span>
                            {f.last_error && (
                              <span className="text-muted-foreground">
                                — {f.last_error}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-1 w-fit"
                        disabled={isClearing}
                        onClick={handleClear}
                      >
                        {isClearing ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <XIcon className="size-3.5" />
                        )}
                        Clear failures
                      </Button>
                    </AlertDescription>
                  </Alert>
                </motion.div>
              ) : (
                <motion.p
                  key="no-failures"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground"
                >
                  <CheckCircle2Icon className="size-3.5 text-success" />
                  No delivery failures
                </motion.p>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      </CardContent>
    </Card>
  );
};

export default DeliveryHealthCard;
