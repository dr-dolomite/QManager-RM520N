# Toast Confirmation

> **Applies to:** RM520N-GL (SDX65) and RG501Q-EU · frontend-only, device-independent · ported from QManager-the101 2026-10-06

Every user-initiated mutation that finishes is confirmed by exactly one `sonner` toast, success or failure, and by nothing that fades (**The Toast-Confirms Rule**, user decision). A transient "Applied" / "Saved" chip or any other self-dismissing success label is retired. `SaveButton`'s own Saving.../Saved! flash is the control's state and stays, as do persistent states (Locked, Active, a failure line that stays beside its draft). The rule, its Do/Don't rows and the never-toast list live in `DESIGN.md` > Components > **Confirmation Toasts**; the one-paragraph form is in `CLAUDE.md`. This doc holds what those cannot: the implementation traps and RM520N's current status.

## Quick Reference

| Item | Value |
|---|---|
| Library | plain `sonner`: `import { toast } from "sonner"`. No wrapper. One `<Toaster />` in `app/layout.tsx` (`components/ui/sonner.tsx`) |
| Reference implementation | `components/cellular/band-locking/band-grid-card.tsx`: `markSaved()` then `toast.success(t(...))` on ok, `toast.error(t(...))` on not ok, in the handler (about lines 252-281) |
| Failure reason | the call's own returned result. for a backend error code use `resolveErrorMessage(t, code, detail, fallback)` (`lib/i18n/resolve-error.ts`, resolves in the `errors` namespace) |
| Copy to clipboard | `copyText` from `lib/clipboard.ts`; toast success only when it returns `true` |
| Copy catalog | `t()` keys in **all five** catalogs (`en id it zh-CN zh-TW`; the packs are CRLF), per [i18n.md](i18n.md). RM520N does not pause translation |

## Checklist for a new mutation

1. It is a user-initiated mutation that **finishes** (save, apply, persistent toggle, add, delete, reset, install, copy). If it is on the never-toast list below, stop.
2. Take the failure reason from **this call's returned result**. A mutator that returns a bare boolean carries no reason, so the handler shows a fixed translated title. To show a reason, change the mutator to return `{ success, error? }` and update every caller in the same commit (see the `if (await save())` trap).
3. Fire the toast in the **component handler that owns the action**, at the terminal moment: request resolved, read-back matched, or the stepper settled. Not in a presentational footer. First grep for an existing toast on the same outcome.
4. One sentence, past tense, naming the thing ("MTU applied."). Failure is a fixed translated title, plus the reason as `description` when the result carries one.
5. A multi-step or detached apply that settles later is an **effect** with a deterministic `id` and an arm guard (below).
6. `markSaved()` only on success, after the result. Never before the request resolves.
7. Partial failure is **one** error toast, never a success followed by an error.
8. A persistent failure line beside the draft is fine. Keep that same text out of an `aria-live` region so a screen reader hears it once.
9. Retiring a chip's text means deleting its key from **all five** locales, because `bun run i18n:check` fails on extra keys. Adding a toast key means adding it to all five.
10. If the mutation ends in a navigation or reload, read "The navigation exception" before adding any toast.

## The traps

**Stale closure: read the reason from the call's result, never from hook state after an `await`.** An `error` captured by a handler is the render the click happened in, so it is `null` or the previous attempt's message. The tell is `toast.error(error || t(...))` or `error ?? t(...)` straight after an `await`.

**The `if (await save())` trap.** When a mutator that returned a boolean starts returning an object, an unchanged `if (await save())` is truthy for **every** outcome and TypeScript does not flag it, so every success toast fires after a failure. Change the call sites in the same commit (grep the importers) and test `res.success`. RM520N's hooks are mostly `Promise<boolean>` today (116 such signatures under `hooks/`, not all of them mutators) and `docs/FRONTEND.md` shows both shapes, so this is the likeliest way a conversion goes wrong.

**Effect-based toasts: deterministic `id`, and only for a transition seen in this session.** An apply that settles later (profile apply, a list download, an install) is announced from an effect, which re-runs on re-render, in StrictMode and on a language switch (a new `t` identity; see `.claude/agent-memory/ui-builder/reference-t-identity-churn-kills-intervals.md`). Two guards are required together: a sonner `id` derived from the run, so a repeat replaces instead of stacking, and proof the terminal state was reached by an action this page started. A result merely loaded on mount, or a status file left in `/tmp`, never toasts.

**A toast fired from a page's mount effect is lost: `<Toaster />` renders after `{children}`.** `app/layout.tsx` renders the page before `<Toaster />`, so a `toast.*` called synchronously from a mount effect is published before sonner has subscribed. Defer it one tick with `window.setTimeout(() => toast.success(...), 0)`. Use no cleanup when a one-shot flag is consumed on the first pass, or StrictMode's second pass would cancel the only toast. Handler- and `await`-fired toasts fire long after mount and do not hit this.

**One owner per outcome.** A toast in an effect and another in the handler announce the same outcome twice. Pick the surface that sees the terminal moment and delete the other.

**The toast says what is true at that moment.** "Updated" is not "enabled" and "Lock sent" is not "Camped on". A change the device has accepted but not yet confirmed is announced as accepted.

**Copy through `copyText`, never `navigator.clipboard`.** `navigator.clipboard` exists only in a secure context. The modem's lighttpd serves port 80 (plain HTTP, `scripts/usrdata/qmanager/lighttpd.conf`) as well as 443 with a self-signed certificate, and on the plain-HTTP origin it is `undefined`, so every raw call throws. `copyText` falls back to a hidden textarea and `execCommand`. A grep for `navigator.clipboard` outside `lib/clipboard.ts` should return only comments.

## The navigation exception

A mutation that ends in a page navigation or reload destroys any toast fired before it, so the transition is the success signal and only failures toast.

- **The `/reboot/` hand-off** (IMEI, IP Passthrough, Tailscale resync, manual reboot, Software Update, and **Reboot now** in the MBN dialog): the navigation is the success signal, see [FRONTEND.md](../FRONTEND.md) > Reboot Navigation Pattern. No success toast. A failed save or a refused reboot toasts. The MBN **apply** itself is not a hand-off: it toasts success (`toast.auto_enabled` / `auto_disabled` / `profile_applied`), then opens the reboot dialog.
- **Change Password** (`changePassword()` in `hooks/use-auth.ts`) clears the indicator cookie and hard-redirects to `/login/`, so nothing fired before the redirect survives. In `change-password-dialog.tsx`, client-side validation (weak password, mismatch) stays an inline error; a server failure toasts through `resolveErrorMessage` on the returned `error` / `detail`. The confirmation belongs on the page the redirect lands on, through a one-shot `sessionStorage` flag consumed on mount and toasted after a deferred tick (see the mount-effect trap). RM520N does not have that hand-off yet, so a successful change shows nothing.
- **`/setup` wizard steps** (`components/onboarding/steps/*`): a successful step advances, and the advance is the confirmation. A failed write toasts. No per-step success toast.

## Never toast

Polling and background or automatic work; draft-only edits (a pill, an input, a select); Discard; tab and filter state; and diagnostics whose result is a persistent inline panel.

## RM520N status (measured at `0fbd9ee5`, before the design-parity port)

The rule is partly met by habit. These gaps are tracked in `DESIGN.md` > Migration Deltas; sweep a surface when you next touch it.

- **Handler-level toasts are pervasive:** 88 `toast.success(` and 98 `toast.error(` sites (`git grep -E 'toast\.(success|error)\('` over `app components hooks lib`).
- **Stale-closure sites: fixed (2026-10-06).** The seven sites now toast `result.error` from `MutationResult` (`types/mutation-result.ts`, `{ ok, error }`), returned by `deleteProfile`, the SMS forwarding `saveSettings`/`sendTest`/`clearFailures`, `saveTtlHl`, `saveMtu` and `disableMtu`. Use the same shape for any new mutator and test `res.ok`. The alerts card's `handleSave` and `handleTest` were the last two; `useAlerts.saveSettings` and `sendTest` now return `MutationResult` too.
- **Raw `navigator.clipboard`: migrated (2026-10-06).** All nine callers now use `copyText`; only `lib/clipboard.ts` touches the API. `copyable-command.tsx` is unused and still has two hard-coded English toasts.
- **Hard-coded English toasts, 10:** 8 in `components/nav-user.tsx` and 2 in `components/ui/copyable-command.tsx` (pattern `toast.(error|success)("`). Every toast string goes through `t()`.
- **Transient Saved chips:** `useSaveFlash` appears in 26 files and `markSaved()` in 27 (67 sites). Most are `SaveButton`'s own flash, which stays. Status text that fades beside a toast is retired. **Landed 2026-10-06:** all five faded after 1800 ms (`alerts-settings-card.tsx`, the Watchdog save bar — retired later the same day, its commit now lives in `watchdog/watchdog-foot.tsx` — `scheduled-operations-card.tsx` and `speed-limit-card.tsx` already toasted, so the label was deleted; `cellular-settings.tsx`'s own `setTimeout` only drove `SaveButton`'s flash and it had **no** toast, so it now uses `useSaveFlash` and toasts success or failure from `handleSave`).
- **Effect toasts with an `id`:** a single-line grep for a sonner `id:` finds none, and no async apply was audited for the arm pattern. Audit one before touching it.

## Related

- `DESIGN.md` > Components > Confirmation Toasts, and The Toast-Confirms Rule under Named Rules.
- `PRODUCT.md` Principle 3 (interfaces that never lie).
- [dashboard-state-motion.md](dashboard-state-motion.md) Part 3: `SaveButton`'s own Saved flash and why it carries no `aria-live`.
- [i18n.md](i18n.md): the five-catalog parity gate every toast key lands in.
