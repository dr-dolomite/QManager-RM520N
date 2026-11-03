import type { TFunction } from "i18next";

import { resolveErrorMessage } from "@/lib/i18n/resolve-error";

const CODE = /^[a-z][a-z0-9_]*$/;

/** A failure toast's description: a known code in locale text, anything else quoted as the device's words. */
export function failureReason(t: TFunction, error: string | null | undefined): string | undefined {
  const raw = error?.trim();
  if (!raw) return undefined;
  if (CODE.test(raw)) return resolveErrorMessage(t, raw, raw, raw);
  return t("unknown_with_detail", { ns: "errors", detail: raw });
}
