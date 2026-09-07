// =============================================================================
// Web Console — the terminal's colours and face, read from the live theme
// =============================================================================
// xterm.js parses CSS colour STRINGS itself, and its parser predates `oklch()`
// — every token in this product is oklch, so handing one over is silently
// rejected and the terminal keeps whatever it had. So the browser does the
// conversion: paint the token onto a 1x1 canvas and read the pixel back.
// =============================================================================

import type { ITheme } from "@xterm/xterm";

/**
 * The pre-canon hardcoded palette, kept as the floor. If the canvas is
 * unavailable or a token does not resolve, the terminal is still readable —
 * dark in both themes, which is the defect this module exists to fix, but never
 * ink on its own colour.
 */
const FALLBACK = {
  foreground: "#e4e4e7",
  background: "#09090b",
  cursor: "#e4e4e7",
} as const;

/** Selection alpha, as the two hex digits xterm's #rrggbbaa form wants. */
const SELECTION_ALPHA = "40";

/** A colour no token is, so a rejected assignment is distinguishable. */
const SENTINEL = "#123456";

function channel(value: number): string {
  return value.toString(16).padStart(2, "0");
}

/**
 * One token, resolved to sRGB by the browser. Returns null when the value is
 * missing or the context rejects it, so every call site can fall back.
 */
function toHex(
  ctx: CanvasRenderingContext2D | null,
  value: string,
): string | null {
  if (!ctx || !value) return null;
  ctx.fillStyle = SENTINEL;
  const before = ctx.fillStyle;
  ctx.fillStyle = value;
  if (ctx.fillStyle === before) return null;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function context(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  try {
    return canvas.getContext("2d", { willReadFrequently: true });
  } catch {
    return null;
  }
}

/**
 * The terminal's theme for the CURRENT mode.
 *
 * Read from the host element rather than from `:root`: the colour tokens
 * inherit down from `<html>`, and this way one `getComputedStyle` also sees the
 * font variable, which is set on `<body>`.
 *
 * The pane's own fill is `bg-surface-container`, so the terminal's background
 * is that same token — the machine surface and the box around it are one plane.
 */
export function readTerminalTheme(host: HTMLElement | null): ITheme {
  if (typeof window === "undefined" || !host) {
    return { ...FALLBACK, selectionBackground: `${FALLBACK.foreground}${SELECTION_ALPHA}` };
  }

  const style = window.getComputedStyle(host);
  const ctx = context();
  const read = (token: string): string | null =>
    toHex(ctx, style.getPropertyValue(token).trim());

  const foreground = read("--on-surface") ?? FALLBACK.foreground;
  const background = read("--surface-container") ?? FALLBACK.background;
  const cursor = read("--primary") ?? FALLBACK.cursor;

  return {
    foreground,
    background,
    cursor,
    // The block cursor's own ink: the ground it is drawn over, so the character
    // under it stays readable.
    cursorAccent: background,
    selectionBackground: `${foreground}${SELECTION_ALPHA}`,
    // A shell's "white" is invisible on a light ground, so both white rungs
    // take the theme's ink instead of xterm's near-#fff defaults.
    white: foreground,
    brightWhite: foreground,
  };
}

/**
 * The machine face. Resolved to a real family list rather than left as
 * `var(--font-jetbrains-mono)`: xterm measures glyph widths through a canvas,
 * and canvas `font` does not substitute custom properties.
 */
export function readTerminalFont(host: HTMLElement | null): string {
  if (typeof window === "undefined" || !host) return "monospace";
  const family = window
    .getComputedStyle(host)
    .getPropertyValue("--font-jetbrains-mono")
    .trim();
  return family ? `${family}, monospace` : "monospace";
}
