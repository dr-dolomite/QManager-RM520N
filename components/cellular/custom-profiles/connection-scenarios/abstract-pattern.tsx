import React from "react";

// =============================================================================
// AbstractPattern — the texture layer behind a scenario tile
// =============================================================================
// Every shape draws in `currentColor` and carries its own `opacity`, so the
// pattern inherits the tile's ink instead of assuming one. These used to be
// hard-coded `rgba(255,255,255,0.05)`, which only worked because the tile was a
// saturated gradient with white content. On the tonal `surface-container` the
// tile now uses, white-on-light is invisible, and the texture vanished
// entirely — so the caller sets a text colour and the pattern follows it into
// both themes.
//
// The opacities are deliberately tiny (0.03-0.10). This is texture, not
// content: it should register as surface character at a glance and never
// compete with the scenario name sitting on top of it.
// =============================================================================

interface AbstractPatternProps {
  type: string;
  className?: string;
}

export const AbstractPattern = ({ type, className }: AbstractPatternProps) => {
  if (type === "gaming") {
    return (
      <svg
        className={className}
        viewBox="0 0 400 200"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <polygon points="0,200 80,120 160,200" fill="currentColor" opacity="0.05" />
        <polygon points="100,200 180,80 260,200" fill="currentColor" opacity="0.08" />
        <polygon points="200,200 320,60 400,200" fill="currentColor" opacity="0.04" />
        <circle cx="350" cy="50" r="80" fill="currentColor" opacity="0.03" />
        <circle cx="50" cy="30" r="40" fill="currentColor" opacity="0.05" />
        <line
          x1="0"
          y1="150"
          x2="400"
          y2="150"
          stroke="currentColor"
          strokeWidth="1"
          opacity="0.05"
        />
        <line
          x1="0"
          y1="100"
          x2="400"
          y2="100"
          stroke="currentColor"
          strokeWidth="1"
          opacity="0.03"
        />
        <line
          x1="200"
          y1="0"
          x2="200"
          y2="200"
          stroke="currentColor"
          strokeWidth="1"
          opacity="0.03"
        />
      </svg>
    );
  }
  if (type === "streaming") {
    return (
      <svg
        className={className}
        viewBox="0 0 400 200"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <path
          d="M0,100 Q100,50 200,100 T400,100"
          fill="none"
          stroke="currentColor"
          strokeWidth="60"
          opacity="0.10"
        />
        <path
          d="M0,140 Q100,90 200,140 T400,140"
          fill="none"
          stroke="currentColor"
          strokeWidth="40"
          opacity="0.05"
        />
        <circle cx="320" cy="60" r="100" fill="currentColor" opacity="0.04" />
        <circle cx="80" cy="160" r="60" fill="currentColor" opacity="0.06" />
        <ellipse cx="200" cy="40" rx="120" ry="40" fill="currentColor" opacity="0.03" />
      </svg>
    );
  }
  if (type === "balanced") {
    return (
      <svg
        className={className}
        viewBox="0 0 400 200"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <circle
          cx="100"
          cy="100"
          r="80"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          opacity="0.08"
        />
        <circle
          cx="100"
          cy="100"
          r="60"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          opacity="0.06"
        />
        <circle
          cx="100"
          cy="100"
          r="40"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          opacity="0.04"
        />
        <circle cx="320" cy="80" r="100" fill="currentColor" opacity="0.03" />
        <rect
          x="250"
          y="140"
          width="120"
          height="60"
          rx="8"
          fill="currentColor"
          opacity="0.04"
        />
        <rect
          x="280"
          y="20"
          width="80"
          height="40"
          rx="4"
          fill="currentColor"
          opacity="0.05"
        />
      </svg>
    );
  }
  // Custom/default pattern
  return (
    <svg
      className={className}
      viewBox="0 0 400 200"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <circle cx="350" cy="50" r="120" fill="currentColor" opacity="0.05" />
      <circle cx="50" cy="150" r="80" fill="currentColor" opacity="0.04" />
      <rect
        x="150"
        y="80"
        width="100"
        height="100"
        rx="12"
        fill="currentColor"
        opacity="0.03"
        transform="rotate(15 200 130)"
      />
    </svg>
  );
};
