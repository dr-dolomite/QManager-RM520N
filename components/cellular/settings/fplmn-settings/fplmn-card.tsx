"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { authFetch } from "@/lib/auth-fetch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Button } from "@/components/ui/button";

const CGI_ENDPOINT = "/cgi-bin/quecmanager/cellular/fplmn.sh";

const FPLMNCard = () => {
  const [hasEntries, setHasEntries] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch FPLMN status
  // ---------------------------------------------------------------------------
  const fetchStatus = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setFetchError(null);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json();
      if (!mountedRef.current) return;

      if (data.success) {
        setHasEntries(data.has_entries);
      } else {
        setFetchError(data.detail || "Failed to read blocked networks");
      }
    } catch {
      if (mountedRef.current) {
        setFetchError("Unable to connect to device");
      }
    } finally {
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // ---------------------------------------------------------------------------
  // Clear FPLMN list
  // ---------------------------------------------------------------------------
  const handleClear = async () => {
    setIsClearing(true);

    try {
      const resp = await authFetch(CGI_ENDPOINT, { method: "POST" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json();
      if (!mountedRef.current) return;

      if (data.success) {
        toast.success("Blocked networks cleared");
        await fetchStatus(true);
      } else {
        toast.error(data.detail || "Failed to clear blocked networks");
      }
    } catch {
      if (mountedRef.current) {
        toast.error("Failed to clear blocked networks");
      }
    } finally {
      if (mountedRef.current) {
        setIsClearing(false);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const cardHeader = (
    <CardHeader>
      <CardTitle>Blocked Networks</CardTitle>
      <CardDescription>
        Your SIM stores a list of networks that previously rejected your
        device. Clearing this list may restore connectivity and improve
        roaming.
        <a
          href="https://onomondo.com/blog/how-to-clear-the-fplmn-list-on-a-sim/"
          target="_blank"
          rel="noreferrer"
          className="underline ml-1 text-primary hover:text-primary/80"
        >
          Learn more
        </a>
        .
      </CardDescription>
    </CardHeader>
  );

  if (isLoading) {
    return (
      <Card className="@container/card">
        {cardHeader}
        <CardContent>
          <div className="flex flex-col items-center justify-center gap-4 py-8">
            <Skeleton className="h-12 w-12 rounded-xl" />
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-9 w-36" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (fetchError) {
    return (
      <Card className="@container/card">
        {cardHeader}
        <CardContent>
          <Empty className="bg-destructive/5 h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon" className="bg-destructive rounded-xl">
                <MaterialSymbol name="warning" size={24} className="text-destructive-foreground" />
              </EmptyMedia>
              <EmptyTitle>Unable to Check</EmptyTitle>
              <EmptyDescription className="max-w-xs text-pretty">
                {fetchError}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" onClick={() => fetchStatus()}>
                <MaterialSymbol name="refresh" size={16} />
                Retry
              </Button>
            </EmptyContent>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="@container/card">
      {cardHeader}
      <CardContent>
        <AnimatePresence mode="wait">
          {hasEntries ? (
            <motion.div
              key="detected"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <Empty className="bg-destructive/5 h-full">
                <EmptyHeader>
                  <EmptyMedia variant="icon" className="bg-destructive rounded-xl">
                    <MaterialSymbol name="warning" size={24} className="text-destructive-foreground" />
                  </EmptyMedia>
                  <EmptyTitle>Blocked Networks Found</EmptyTitle>
                  <EmptyDescription className="max-w-xs text-pretty">
                    Your SIM has blocked one or more networks, which may prevent
                    connection. Clearing the list is recommended.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    variant="destructive"
                    onClick={handleClear}
                    disabled={isClearing}
                  >
                    {isClearing ? (
                      <>
                        <MaterialSymbol name="progress_activity" size={16} className="animate-spin motion-reduce:animate-none" />
                        Clearing...
                      </>
                    ) : (
                      "Clear Blocked Networks"
                    )}
                  </Button>
                </EmptyContent>
              </Empty>
            </motion.div>
          ) : (
            <motion.div
              key="clean"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <Empty className="bg-muted/30 h-full">
                <EmptyHeader>
                  <EmptyMedia variant="icon" className="bg-primary rounded-xl">
                    <MaterialSymbol name="check_circle" size={24} className="text-primary-foreground" />
                  </EmptyMedia>
                  <EmptyTitle>No Blocked Networks</EmptyTitle>
                  <EmptyDescription className="max-w-xs text-pretty">
                    Your SIM has no blocked networks. No action needed.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button variant="outline" onClick={() => fetchStatus()}>
                    <MaterialSymbol name="refresh" size={16} />
                    Refresh Status
                  </Button>
                </EmptyContent>
              </Empty>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
};

export default FPLMNCard;
