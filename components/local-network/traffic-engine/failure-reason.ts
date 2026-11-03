import type { TFunction } from "i18next";

import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type { MutationResult } from "@/types/mutation-result";

/** A failure toast's description from the backend's code and detail; none when it sent neither. */
export function failureReason(t: TFunction, result: MutationResult): string | undefined {
  return resolveErrorMessage(t, result.error, result.detail, "") || undefined;
}
