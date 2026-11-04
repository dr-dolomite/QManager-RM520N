"use client";

// =============================================================================
// copyText — the one clipboard helper for the whole app
// =============================================================================
// QManager is served BY the modem and is often reached over plain `http://` — not a
// secure context — so `navigator.clipboard` is `undefined` in every browser
// on that origin, not merely unreliable. `window.isSecureContext` is the correct gate
// (never a `typeof navigator.clipboard` check, which can pass and then throw
// on `writeText` under stricter permission policies): when it is false, or the
// Clipboard API call itself rejects, this falls back to a hidden textarea +
// the deprecated but still-functional `document.execCommand("copy")`, which is
// the only copy path an insecure origin has.
// =============================================================================

/** Copy `text` to the clipboard. Resolves `true` on success, `false` otherwise. */
export async function copyText(text: string): Promise<boolean> {
  if (typeof window === "undefined") return false;

  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the execCommand fallback below.
    }
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
