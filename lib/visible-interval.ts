// A setInterval that runs only while the tab is visible: hiding the tab clears
// the timer, showing it runs `tick` at once and restarts the timer. Each poll is
// a CGI on the single-core modem, so a forgotten tab must cost it nothing.

export interface VisibleIntervalOptions {
  /** Called when the tab becomes hidden, after the timer is cleared. */
  onHide?: () => void;
}

/** Starts the interval (if visible) and returns its cleanup. Does not tick on start. */
export function startVisibleInterval(
  tick: () => void,
  intervalMs: number,
  options: VisibleIntervalOptions = {},
): () => void {
  let id: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    if (id !== null) {
      clearInterval(id);
      id = null;
    }
  };
  const start = () => {
    stop();
    id = setInterval(tick, intervalMs);
  };

  const handleVisibility = () => {
    if (document.hidden) {
      stop();
      options.onHide?.();
    } else {
      tick();
      start();
    }
  };

  if (!document.hidden) start();
  document.addEventListener("visibilitychange", handleVisibility);

  return () => {
    document.removeEventListener("visibilitychange", handleVisibility);
    stop();
  };
}
