---
name: reference-t-identity-churn-kills-intervals
description: react-i18next's `t` gets a new identity on every language switch, so `t` in a polling useCallback's deps silently tears down setInterval loops and never re-arms them
metadata:
  type: reference
---

`lib/i18n/config.ts` inits react-i18next with **no `bindI18n` override**, so the default
`'languageChanged'` applies and `useTranslation` returns a **new `t` identity** every time
the user switches language.

That makes this an interval-killing bug, not a cosmetic one:

```
t churns → useCallback(pollStatus, [..., t]) rebuilds
         → useEffect([pollStatus]) re-runs
         → its cleanup calls stopPolling()
         → the new effect body only calls pollStatus() ONCE; nothing re-arms the interval
```

Net effect: **switching language mid-operation stops the UI watching a job that is still
running on the modem** — forever. The scan keeps sweeping; the page never learns the result.

**Why it hides:** `tsc`, `eslint`, and the react-hooks compiler plugin all pass. `t` in the
deps is *literally correct* dependency tracking. Nothing flags it; only a language switch
during a live poll reproduces it.

**The fix that works:** a `tRef` (`const tRef = useRef(t); tRef.current = t;`, mirroring the
established `pollStatusRef.current = pollStatus` render-assignment already in these hooks),
read as `tRef.current("key.literal")` inside callbacks, with `t` dropped from the dep arrays.
Translations stay fresh (read at raise time, never cached) while the callback becomes
identity-stable — which is the only property the interval and the mount effect need.

**The fix that does NOT work:** dropping `t` from the deps with an `eslint-disable`. That is a
stale closure (post-switch errors worded in the old language) AND the compiler-backed
`react-hooks` plugin bails at the FIRST violation per component, so the suppression hides
every later diagnostic in that same component. See [[reference_react_hooks_lint_bails_per_component]].

**How to apply:** any hook that arms a `setInterval`/`setTimeout` from a `useCallback` and also
translates — audit for `t` in the dep array. Fixed in `use-cell-scanner.ts` and
`use-neighbour-scanner.ts` (2026-08-12). `use-breadcrumbs.ts` keeps `t` in deps and is correct:
it recomputes labels on language change and arms no interval.
